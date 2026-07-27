import {
  PAIR_PROBABILITY,
  THEORETICAL_PROBABILITIES,
  createSeededRandomInt,
  createShoe,
  dealRound,
} from '../src/game/baccarat'
import type { Winner } from '../src/types'

const targetRounds = Number(process.env.AUDIT_ROUNDS ?? 1_000_000)
const tolerance = Number(process.env.AUDIT_TOLERANCE ?? 0.001)
const randomInt = createSeededRandomInt(0x5a17cafe)
const counts: Record<Winner, number> = { banker: 0, player: 0, tie: 0 }
let playerPairs = 0
let bankerPairs = 0
let rounds = 0
let shoeNumber = 0
let shoe = createShoe(randomInt, `AUDIT-${shoeNumber}`)

while (rounds < targetRounds) {
  const dealt = dealRound(shoe)
  shoe = dealt.shoe
  counts[dealt.result.winner] += 1
  if (dealt.result.playerPair) playerPairs += 1
  if (dealt.result.bankerPair) bankerPairs += 1
  rounds += 1

  if (shoe.needsShuffle) {
    shoeNumber += 1
    shoe = createShoe(randomInt, `AUDIT-${shoeNumber}`)
  }
}

const observed = {
  banker: counts.banker / rounds,
  player: counts.player / rounds,
  tie: counts.tie / rounds,
  playerPair: playerPairs / rounds,
  bankerPair: bankerPairs / rounds,
}

const checks = [
  ['banker', observed.banker, THEORETICAL_PROBABILITIES.banker],
  ['player', observed.player, THEORETICAL_PROBABILITIES.player],
  ['tie', observed.tie, THEORETICAL_PROBABILITIES.tie],
  ['playerPair', observed.playerPair, PAIR_PROBABILITY],
  ['bankerPair', observed.bankerPair, PAIR_PROBABILITY],
] as const

const report = {
  rounds,
  shoes: shoeNumber + 1,
  seed: '0x5a17cafe',
  tolerance,
  observed,
  expected: {
    ...THEORETICAL_PROBABILITIES,
    playerPair: PAIR_PROBABILITY,
    bankerPair: PAIR_PROBABILITY,
  },
  absoluteDeviation: Object.fromEntries(
    checks.map(([name, actual, expected]) => [name, Math.abs(actual - expected)]),
  ),
}

console.log(JSON.stringify(report, null, 2))

const failures = checks.filter(([, actual, expected]) => Math.abs(actual - expected) > tolerance)
if (failures.length > 0) {
  console.error(
    `Probability audit failed: ${failures.map(([name]) => name).join(', ')} exceeded tolerance.`,
  )
  process.exitCode = 1
}
