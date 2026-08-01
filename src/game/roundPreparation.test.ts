import { describe, expect, it } from 'vitest'
import type { PersistedGameState } from '../types'
import {
  EMPTY_BETS,
  createSeededRandomInt,
  createShoe,
} from './baccarat'
import { preparePendingRound } from './roundPreparation'

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
      revealControl: 'player-squeeze',
      roundId: 'round-locked',
    })

    expect(pending.id).toBe('round-locked')
    expect(pending.revealControl).toBe('player-squeeze')
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
        revealControl: 'dealer-reveal',
        roundId: 'round-over-limit',
      }),
    ).toThrow(/上限/)
    expect(() =>
      preparePendingRound({
        game: current,
        bets: { ...EMPTY_BETS, player: 10 },
        playMode: 'fly',
        revealControl: 'dealer-reveal',
        roundId: 'round-invalid-fly',
      }),
    ).toThrow(/fly mode/)
  })

  it('rejects player squeeze control for a fly round', () => {
    expect(() =>
      preparePendingRound({
        game: game(),
        bets: { ...EMPTY_BETS },
        playMode: 'fly',
        revealControl: 'player-squeeze',
        roundId: 'round-invalid-control',
      }),
    ).toThrow(/requires dealer reveal/)
  })

  it('rejects unknown reveal controls at the runtime boundary', () => {
    expect(() =>
      preparePendingRound({
        game: game(),
        bets: { ...EMPTY_BETS, player: 100 },
        playMode: 'bet',
        revealControl: 'future-mode' as never,
        roundId: 'round-invalid-unknown-control',
      }),
    ).toThrow(/invalid reveal control/)
  })

  it('persists legacy-compatible defaults even when the caller omits control', () => {
    const wagered = preparePendingRound({
      game: game(),
      bets: { ...EMPTY_BETS, banker: 100 },
      playMode: 'bet',
      roundId: 'round-default-player-control',
    })
    const fly = preparePendingRound({
      game: game(),
      bets: { ...EMPTY_BETS },
      playMode: 'fly',
      roundId: 'round-default-dealer-control',
    })

    expect(wagered.revealControl).toBe('player-squeeze')
    expect(fly.revealControl).toBe('dealer-reveal')
    expect(Object.hasOwn(wagered, 'revealControl')).toBe(true)
    expect(Object.hasOwn(fly, 'revealControl')).toBe(true)
  })
})
