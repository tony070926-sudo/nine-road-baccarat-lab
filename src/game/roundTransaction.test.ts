import { describe, expect, it } from 'vitest'
import type { PersistedGameState } from '../types'
import {
  EMPTY_BETS,
  createSeededRandomInt,
  createShoe,
} from './baccarat'
import { preparePendingRound } from './roundTransaction'

function game(): PersistedGameState {
  return {
    version: 1,
    balance: 10_000,
    shoe: createShoe(createSeededRandomInt(20260731), 'ROUND-JOURNAL-SHOE'),
    history: [],
    lastBets: { ...EMPTY_BETS },
    sessionStartedAt: '2026-07-31T00:00:00.000Z',
  }
}

describe('preparePendingRound', () => {
  it('locks a complete immutable outcome before any reveal animation', () => {
    const current = game()
    const pending = preparePendingRound({
      game: current,
      bets: { ...EMPTY_BETS, player: 100 },
      playMode: 'bet',
      roundId: 'round-locked',
    })

    expect(pending.id).toBe('round-locked')
    expect(pending.sourceCursor).toBe(current.shoe.cursor)
    expect(pending.shoeAfter.cursor).toBe(
      current.shoe.cursor + pending.result.cardsUsed,
    )
    expect(pending.shoeAfter.handNumber).toBe(current.shoe.handNumber + 1)
    expect(pending.revealedCount).toBe(0)
    expect(current.shoe.cursor).toBe(pending.sourceCursor)
  })

  it('rejects invalid wagers and wagered fly rounds before dealing', () => {
    const current = game()
    expect(() =>
      preparePendingRound({
        game: current,
        bets: { ...EMPTY_BETS, tie: 1_010 },
        playMode: 'bet',
        roundId: 'round-over-limit',
      }),
    ).toThrow(/上限/)
    expect(() =>
      preparePendingRound({
        game: current,
        bets: { ...EMPTY_BETS, player: 10 },
        playMode: 'fly',
        roundId: 'round-invalid-fly',
      }),
    ).toThrow(/fly mode/)
  })
})
