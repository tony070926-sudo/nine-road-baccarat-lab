import { describe, expect, it } from 'vitest'
import type { Card, RoundRecord, Winner } from '../types'
import {
  buildBeadPlate,
  buildBigRoad,
  buildDerivedRoad,
  deriveRoadSequence,
} from './roads'

const sampleCard: Card = { id: 'test', suit: 'spades', rank: 'A', deck: 1 }

function records(sequence: Winner[]): RoundRecord[] {
  return sequence.map((winner, index) => ({
    id: `round-${index + 1}`,
    shoeId: 'shoe-1',
    handNumber: index + 1,
    timestamp: new Date(2026, 6, 27, 12, 0, index).toISOString(),
    playerCards: [sampleCard, { ...sampleCard, id: `p-${index}` }],
    bankerCards: [sampleCard, { ...sampleCard, id: `b-${index}` }],
    dealOrder: [],
    playerTotal: winner === 'player' ? 8 : 6,
    bankerTotal: winner === 'banker' ? 8 : 6,
    winner,
    natural: false,
    playerPair: false,
    bankerPair: false,
    cardsUsed: 4,
    bets: { player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 },
    settlement: { totalStake: 0, totalReturned: 0, net: 0, breakdown: {} },
    balanceBefore: 10_000,
    balanceAfter: 10_000,
    cardsRemaining: 400 - index * 4,
    rulesetVersion: 'test',
    shuffleVersion: 'test',
  }))
}

describe('bead plate and Big Road', () => {
  it('fills the bead plate down six rows before moving right', () => {
    const cells = buildBeadPlate(records(['banker', 'player', 'tie', 'banker', 'player', 'tie', 'banker']))
    expect(cells.map(({ row, col }) => [row, col])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
      [0, 1],
    ])
  })

  it('stacks streaks vertically and starts switches at the next logical column', () => {
    const cells = buildBigRoad(records(['banker', 'banker', 'banker', 'player', 'player', 'banker']))
    expect(cells.map(({ row, col, value }) => [row, col, value])).toEqual([
      [0, 0, 'banker'],
      [1, 0, 'banker'],
      [2, 0, 'banker'],
      [0, 1, 'player'],
      [1, 1, 'player'],
      [0, 2, 'banker'],
    ])
  })

  it('turns a streak right after the sixth row', () => {
    const cells = buildBigRoad(records(Array.from({ length: 8 }, () => 'banker')))
    expect(cells.slice(-3).map(({ row, col }) => [row, col])).toEqual([
      [5, 0],
      [5, 1],
      [5, 2],
    ])
  })

  it('overlays ties on the latest decision, including leading ties', () => {
    const cells = buildBigRoad(records(['tie', 'tie', 'banker', 'tie', 'player']))
    expect(cells).toHaveLength(2)
    expect(cells[0].tieCount).toBe(3)
    expect(cells[0].roundIds).toHaveLength(4)
  })
})

describe('derived roads', () => {
  it('matches canonical Big Eye Boy boundary fixtures', () => {
    expect(deriveRoadSequence(records(['banker', 'player', 'banker']), 1)).toEqual(['red'])
    expect(deriveRoadSequence(records(['banker', 'banker', 'player', 'player']), 1)).toEqual([
      'red',
    ])
    expect(
      deriveRoadSequence(records(['banker', 'banker', 'player', 'player', 'player']), 1),
    ).toEqual(['red', 'blue'])
    expect(
      deriveRoadSequence(
        records(['banker', 'banker', 'player', 'player', 'player', 'player']),
        1,
      ),
    ).toEqual(['red', 'blue', 'red'])
  })

  it('ignores ties when calculating derived roads', () => {
    const withoutTie = deriveRoadSequence(records(['banker', 'player', 'banker']), 1)
    const withTie = deriveRoadSequence(records(['banker', 'tie', 'player', 'tie', 'banker']), 1)
    expect(withTie).toEqual(withoutTie)
  })

  it('lays derived colors out with the same six-row road geometry', () => {
    const longPattern = records([
      'banker',
      'player',
      'banker',
      'player',
      'banker',
      'player',
      'banker',
      'player',
      'banker',
    ])
    const cells = buildDerivedRoad(longPattern, 1)
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every((cell) => cell.row >= 0 && cell.row < 6)).toBe(true)
  })
})
