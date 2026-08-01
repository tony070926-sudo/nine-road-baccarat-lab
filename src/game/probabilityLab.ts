import type { RandomInt } from './baccarat'
import {
  DECK_COUNT,
  HOUSE_EDGES,
  PAIR_PROBABILITY,
  RULESET_VERSION,
  THEORETICAL_PROBABILITIES,
  createSeededRandomInt,
  createShoe,
  dealRound,
} from './baccarat'

export const PROBABILITY_LAB_ROUND_OPTIONS = [100, 1_000, 10_000] as const
export type ProbabilityLabRoundCount =
  (typeof PROBABILITY_LAB_ROUND_OPTIONS)[number]

export const DEFAULT_PROBABILITY_LAB_SEED = 0x5a17cafe

export type ProbabilityMetricName =
  | 'banker'
  | 'player'
  | 'tie'
  | 'playerPair'
  | 'bankerPair'

export interface ConfidenceInterval {
  lower: number
  upper: number
  method: 'wilson-95'
}

export interface ProbabilityMetricResult {
  count: number
  observed: number
  theoretical: number
  absoluteDeviation: number
  confidence95: ConfidenceInterval
}

export type HouseEdgeBet = 'banker' | 'player' | 'tie' | 'pair'

export interface HouseEdgeExplanation {
  value: number
  explanation: string
}

export interface ProbabilityLabReport {
  rounds: ProbabilityLabRoundCount
  shoes: number
  deckCount: typeof DECK_COUNT
  rulesetVersion: string
  seed: number | null
  randomSource: 'seeded' | 'injected'
  metrics: Record<ProbabilityMetricName, ProbabilityMetricResult>
  houseEdges: Record<HouseEdgeBet, HouseEdgeExplanation>
  houseEdgeSummary: string
}

export interface ProbabilityLabOptions {
  rounds: ProbabilityLabRoundCount
  seed?: number
  randomInt?: RandomInt
}

export type ProbabilityWorkerRequest = {
  type: 'run'
  requestId: string
  rounds: ProbabilityLabRoundCount
  seed: number
}

export type ProbabilityWorkerResponse =
  | {
      type: 'result'
      requestId: string
      report: ProbabilityLabReport
    }
  | {
      type: 'error'
      requestId: string
      message: string
    }

function isSupportedRoundCount(value: number): value is ProbabilityLabRoundCount {
  return PROBABILITY_LAB_ROUND_OPTIONS.some((option) => option === value)
}

export function wilson95Interval(
  successes: number,
  trials: number,
): ConfidenceInterval {
  if (
    !Number.isSafeInteger(successes) ||
    !Number.isSafeInteger(trials) ||
    trials <= 0 ||
    successes < 0 ||
    successes > trials
  ) {
    throw new RangeError('successes and trials must describe a valid sample')
  }

  const z = 1.959963984540054
  const zSquared = z * z
  const observed = successes / trials
  const denominator = 1 + zSquared / trials
  const center = (observed + zSquared / (2 * trials)) / denominator
  const margin =
    (z / denominator) *
    Math.sqrt(
      (observed * (1 - observed)) / trials +
        zSquared / (4 * trials * trials),
    )

  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
    method: 'wilson-95',
  }
}

function houseEdge(value: number, label: string): HouseEdgeExplanation {
  const percentage = (value * 100).toFixed(4)
  return {
    value,
    explanation: `${label}庄家优势为 ${percentage}%；长期每下注 100 分，理论平均损失约 ${percentage} 分，不代表单局必然结果。`,
  }
}

function metric(
  count: number,
  rounds: ProbabilityLabRoundCount,
  theoretical: number,
): ProbabilityMetricResult {
  const observed = count / rounds
  return {
    count,
    observed,
    theoretical,
    absoluteDeviation: Math.abs(observed - theoretical),
    confidence95: wilson95Interval(count, rounds),
  }
}

/**
 * Runs a disposable educational experiment. It creates ordinary eight-deck
 * shoes and calls dealRound for every sample; it has no storage dependency and
 * does not mutate the authoritative game session.
 */
export function runProbabilityLab(
  options: ProbabilityLabOptions,
): ProbabilityLabReport {
  if (!isSupportedRoundCount(options.rounds)) {
    throw new RangeError('Probability lab supports exactly 100, 1000, or 10000 rounds')
  }

  const usesInjectedRandom = options.randomInt !== undefined
  const normalizedSeed =
    options.seed === undefined
      ? DEFAULT_PROBABILITY_LAB_SEED
      : options.seed >>> 0
  const randomInt =
    options.randomInt ?? createSeededRandomInt(normalizedSeed)
  const counts: Record<ProbabilityMetricName, number> = {
    banker: 0,
    player: 0,
    tie: 0,
    playerPair: 0,
    bankerPair: 0,
  }

  let shoeNumber = 0
  let shoe = createShoe(randomInt, `LAB-${shoeNumber}`)

  for (let roundIndex = 0; roundIndex < options.rounds; roundIndex += 1) {
    const dealt = dealRound(shoe)
    shoe = dealt.shoe
    counts[dealt.result.winner] += 1
    if (dealt.result.playerPair) counts.playerPair += 1
    if (dealt.result.bankerPair) counts.bankerPair += 1

    if (shoe.needsShuffle && roundIndex + 1 < options.rounds) {
      shoeNumber += 1
      shoe = createShoe(randomInt, `LAB-${shoeNumber}`)
    }
  }

  return {
    rounds: options.rounds,
    shoes: shoeNumber + 1,
    deckCount: DECK_COUNT,
    rulesetVersion: RULESET_VERSION,
    seed: usesInjectedRandom && options.seed === undefined ? null : normalizedSeed,
    randomSource: usesInjectedRandom ? 'injected' : 'seeded',
    metrics: {
      banker: metric(
        counts.banker,
        options.rounds,
        THEORETICAL_PROBABILITIES.banker,
      ),
      player: metric(
        counts.player,
        options.rounds,
        THEORETICAL_PROBABILITIES.player,
      ),
      tie: metric(
        counts.tie,
        options.rounds,
        THEORETICAL_PROBABILITIES.tie,
      ),
      playerPair: metric(counts.playerPair, options.rounds, PAIR_PROBABILITY),
      bankerPair: metric(counts.bankerPair, options.rounds, PAIR_PROBABILITY),
    },
    houseEdges: {
      banker: houseEdge(HOUSE_EDGES.banker, '庄注'),
      player: houseEdge(HOUSE_EDGES.player, '闲注'),
      tie: houseEdge(HOUSE_EDGES.tie, '和注'),
      pair: houseEdge(HOUSE_EDGES.pair, '对子注'),
    },
    houseEdgeSummary:
      '庄家优势是按规则与赔率计算的长期理论期望，不会改变牌靴，也不能预测下一局。',
  }
}
