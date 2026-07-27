import { describe, expect, it } from 'vitest'
import type { Card, RoundRecord } from '../types'
import { resolvePlayMode } from './records'

const card: Card = { id: 'test-card', suit: 'spades', rank: 'A', deck: 1 }

function record(overrides: Partial<RoundRecord> = {}): RoundRecord {
  return {
    id: 'round-1',
    shoeId: 'shoe-1',
    handNumber: 1,
    timestamp: '2026-07-27T12:00:00.000Z',
    playerCards: [card, { ...card, id: 'player-2' }],
    bankerCards: [{ ...card, id: 'banker-1' }, { ...card, id: 'banker-2' }],
    dealOrder: [],
    playerTotal: 2,
    bankerTotal: 2,
    winner: 'tie',
    natural: false,
    playerPair: true,
    bankerPair: true,
    cardsUsed: 4,
    bets: { player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 },
    settlement: { totalStake: 0, totalReturned: 0, net: 0, breakdown: {} },
    balanceBefore: 10_000,
    balanceAfter: 10_000,
    cardsRemaining: 400,
    rulesetVersion: 'test',
    shuffleVersion: 'test',
    ...overrides,
  }
}

describe('round play mode', () => {
  it('keeps explicit bet and fly modes', () => {
    expect(resolvePlayMode(record({ playMode: 'fly' }))).toBe('fly')
    expect(
      resolvePlayMode(
        record({
          playMode: 'bet',
          settlement: { totalStake: 100, totalReturned: 195, net: 95, breakdown: {} },
        }),
      ),
    ).toBe('bet')
  })

  it('treats legacy zero-stake records as fly rounds', () => {
    expect(resolvePlayMode(record())).toBe('fly')
  })
})
