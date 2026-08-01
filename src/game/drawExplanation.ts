import type { DealResult } from '../types'
import { bankerShouldDraw, cardPoint, handTotal } from './baccarat'
import { revealOrder } from './reveal'

export type RuleTraceStage = 'opening' | 'natural' | 'player' | 'banker'
export type RuleTraceDecision =
  | 'waiting'
  | 'continue'
  | 'natural'
  | 'draw'
  | 'stand'

export interface RuleTraceStep {
  id: string
  stage: RuleTraceStage
  decision: RuleTraceDecision
  title: string
  explanation: string
}

function exposedCardIds(result: DealResult, revealedCount: number): Set<string> {
  const order = revealOrder(result)
  const safeCount = Number.isFinite(revealedCount)
    ? Math.min(order.length, Math.max(0, Math.trunc(revealedCount)))
    : 0
  return new Set(order.slice(0, safeCount).map((card) => card.id))
}

function cardsAreExposed(
  exposedIds: ReadonlySet<string>,
  cards: DealResult['playerCards'],
): boolean {
  return cards.every((card) => exposedIds.has(card.id))
}

function bankerMatrixExplanation(
  bankerTotal: number,
  playerThirdPoint: number,
  shouldDraw: boolean,
): string {
  const outcome = shouldDraw ? '补牌' : '停牌'

  if (bankerTotal <= 2) {
    return `庄家前两张为 ${bankerTotal} 点，不论闲家第三张点数均须补牌。`
  }
  if (bankerTotal === 3) {
    return `庄家前两张为 3 点，遇闲家第三张 ${playerThirdPoint} 点；只有遇 8 停牌，本局${outcome}。`
  }
  if (bankerTotal === 4) {
    return `庄家前两张为 4 点，遇闲家第三张 ${playerThirdPoint} 点；仅遇 2–7 补牌，本局${outcome}。`
  }
  if (bankerTotal === 5) {
    return `庄家前两张为 5 点，遇闲家第三张 ${playerThirdPoint} 点；仅遇 4–7 补牌，本局${outcome}。`
  }
  if (bankerTotal === 6) {
    return `庄家前两张为 6 点，遇闲家第三张 ${playerThirdPoint} 点；仅遇 6 或 7 补牌，本局${outcome}。`
  }
  return '庄家前两张为 7 点，按规则停牌。'
}

/**
 * Builds an educational trace using exposed cards only. The complete result is
 * accepted because it is already locked by the game engine, but no decision or
 * point value is emitted until the cards needed for that decision are present
 * in revealOrder().slice(0, revealedCount).
 */
export function buildDrawExplanation(
  result: DealResult,
  revealedCount: number,
): RuleTraceStep[] {
  const exposedIds = exposedCardIds(result, revealedCount)
  const playerOpening = result.playerCards.slice(0, 2)
  const bankerOpening = result.bankerCards.slice(0, 2)
  const openingComplete =
    playerOpening.length === 2 &&
    bankerOpening.length === 2 &&
    cardsAreExposed(exposedIds, playerOpening) &&
    cardsAreExposed(exposedIds, bankerOpening)

  if (!openingComplete) {
    const exposedOpeningCount = [...playerOpening, ...bankerOpening].filter(
      (card) => exposedIds.has(card.id),
    ).length
    return [
      {
        id: 'opening-wait',
        stage: 'opening',
        decision: 'waiting',
        title: '等待首牌全部公开',
        explanation: `首四张已公开 ${exposedOpeningCount}/4；自然牌与补牌判断暂不显示。`,
      },
    ]
  }

  const playerOpeningTotal = handTotal(playerOpening)
  const bankerOpeningTotal = handTotal(bankerOpening)
  const natural = playerOpeningTotal >= 8 || bankerOpeningTotal >= 8
  const steps: RuleTraceStep[] = [
    {
      id: 'natural-check',
      stage: 'natural',
      decision: natural ? 'natural' : 'continue',
      title: natural ? '自然牌成立' : '没有自然牌',
      explanation: natural
        ? `闲家 ${playerOpeningTotal} 点、庄家 ${bankerOpeningTotal} 点；任一方首两张为 8 或 9，双方均不再补牌。`
        : `闲家 ${playerOpeningTotal} 点、庄家 ${bankerOpeningTotal} 点；双方首两张均非 8 或 9，继续判断补牌。`,
    },
  ]

  if (natural) return steps

  const playerDraws = playerOpeningTotal <= 5
  steps.push({
    id: 'player-rule',
    stage: 'player',
    decision: playerDraws ? 'draw' : 'stand',
    title: playerDraws ? '闲家补牌' : '闲家停牌',
    explanation: playerDraws
      ? `闲家前两张为 ${playerOpeningTotal} 点；0–5 点必须补一张。`
      : `闲家前两张为 ${playerOpeningTotal} 点；6–7 点必须停牌。`,
  })

  if (!playerDraws) {
    const bankerDraws = bankerOpeningTotal <= 5
    steps.push({
      id: 'banker-rule-player-stands',
      stage: 'banker',
      decision: bankerDraws ? 'draw' : 'stand',
      title: bankerDraws ? '庄家补牌' : '庄家停牌',
      explanation: bankerDraws
        ? `闲家停牌时，庄家前两张为 ${bankerOpeningTotal} 点；0–5 点必须补牌。`
        : `闲家停牌时，庄家前两张为 ${bankerOpeningTotal} 点；6–7 点必须停牌。`,
    })
    return steps
  }

  const playerThirdCard = result.playerCards[2]
  if (!playerThirdCard || !exposedIds.has(playerThirdCard.id)) {
    steps.push({
      id: 'banker-rule-wait',
      stage: 'banker',
      decision: 'waiting',
      title: '等待闲家第三张',
      explanation: '庄家是否补牌取决于闲家第三张；该牌公开前不显示矩阵结论。',
    })
    return steps
  }

  const playerThirdPoint = cardPoint(playerThirdCard)
  const bankerDraws = bankerShouldDraw(bankerOpeningTotal, playerThirdPoint)
  steps.push({
    id: 'banker-rule-matrix',
    stage: 'banker',
    decision: bankerDraws ? 'draw' : 'stand',
    title: bankerDraws ? '庄家补牌' : '庄家停牌',
    explanation: bankerMatrixExplanation(
      bankerOpeningTotal,
      playerThirdPoint,
      bankerDraws,
    ),
  })

  return steps
}
