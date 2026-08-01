import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PersistedGameState,
  PersistedPendingRound,
} from '../types'
import {
  EMPTY_BETS,
  createSeededRandomInt,
  createShoe,
  dealRound,
} from './baccarat'
import {
  advanceRevealJournal,
  loadMatchingRoundJournal,
} from './roundJournal'
import {
  loadPendingRound,
  saveGameState,
  savePendingRound,
} from './storage'

function createLocalStorageHarness() {
  const values = new Map<string, string>()
  let writesFail = false
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => {
      if (writesFail) throw new Error('quota exceeded')
      values.set(key, value)
    }),
  })
  return {
    failWrites() {
      writesFail = true
    },
  }
}

function fixture(): {
  game: PersistedGameState
  pending: PersistedPendingRound
} {
  const shoe = createShoe(
    createSeededRandomInt(20260731),
    'S-ROUND-JOURNAL',
  )
  const dealt = dealRound(shoe)
  const game: PersistedGameState = {
    version: 1,
    balance: 10_000,
    shoe,
    history: [],
    lastBets: { ...EMPTY_BETS },
    sessionStartedAt: '2026-07-31T00:00:00.000Z',
  }
  const pending: PersistedPendingRound = {
    version: 1,
    id: 'round-journal-1',
    playMode: 'bet',
    bets: { ...EMPTY_BETS, player: 100 },
    balanceBefore: game.balance,
    sourceShoeId: shoe.id,
    sourceCursor: shoe.cursor,
    shoeAfter: dealt.shoe,
    result: dealt.result,
    revealedCount: 0,
  }

  return { game, pending }
}

let storageHarness: ReturnType<typeof createLocalStorageHarness>

beforeEach(() => {
  storageHarness = createLocalStorageHarness()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function persistFixture() {
  const current = fixture()
  expect(saveGameState(current.game)).toBe(true)
  expect(savePendingRound(current.pending)).toBe(true)
  return current
}

describe('round journal', () => {
  it('advances and reads back reveal progress before UI state changes', () => {
    const { game, pending } = persistFixture()

    const result = advanceRevealJournal({
      game,
      round: pending,
      currentRevealedCount: 0,
      nextRevealedCount: 1,
    })

    expect(result.status).toBe('advanced')
    expect(loadPendingRound()?.revealedCount).toBe(1)
    expect(loadMatchingRoundJournal(pending, 1)).not.toBeNull()
  })

  it('rejects a stale writer instead of rolling progress backward', () => {
    const { game, pending } = persistFixture()
    expect(
      advanceRevealJournal({
        game,
        round: pending,
        currentRevealedCount: 0,
        nextRevealedCount: 1,
      }).status,
    ).toBe('advanced')

    expect(
      advanceRevealJournal({
        game,
        round: pending,
        currentRevealedCount: 0,
        nextRevealedCount: 1,
      }).status,
    ).toBe('conflict')
    expect(loadPendingRound()?.revealedCount).toBe(1)
  })

  it('does not advance when durable storage rejects the write', () => {
    const { game, pending } = persistFixture()
    storageHarness.failWrites()

    expect(
      advanceRevealJournal({
        game,
        round: pending,
        currentRevealedCount: 0,
        nextRevealedCount: 1,
      }).status,
    ).toBe('write-failed')
    expect(loadPendingRound()?.revealedCount).toBe(0)
  })

  it('persists the fully revealed state for crash-safe settlement recovery', () => {
    const { game, pending } = persistFixture()
    const finalCount = pending.result.dealOrder.length
    const beforeFinal = {
      ...pending,
      revealedCount: finalCount - 1,
    }
    expect(savePendingRound(beforeFinal)).toBe(true)

    expect(
      advanceRevealJournal({
        game,
        round: pending,
        currentRevealedCount: finalCount - 1,
        nextRevealedCount: finalCount,
      }).status,
    ).toBe('advanced')
    expect(loadPendingRound()?.revealedCount).toBe(finalCount)
  })
})
