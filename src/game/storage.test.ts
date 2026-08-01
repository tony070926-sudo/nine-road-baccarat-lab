import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, RoundRecord } from '../types'
import {
  clearPendingRound,
  historyToCsv,
  loadGameState,
  loadPendingRound,
} from './storage'

const GAME_STORAGE_KEY = 'nine-road-baccarat:v1'
const PENDING_STORAGE_KEY = 'nine-road-baccarat:pending:v1'

function createLocalStorageHarness() {
  const values = new Map<string, string>()
  const localStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  }
  vi.stubGlobal('localStorage', localStorage)
  return { localStorage, values }
}

beforeEach(() => {
  createLocalStorageHarness()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('clearPendingRound', () => {
  it('only clears the pending round owned by the caller', () => {
    localStorage.setItem(
      PENDING_STORAGE_KEY,
      JSON.stringify({ id: 'round-owned-by-other-tab' }),
    )

    clearPendingRound('round-owned-by-this-tab')

    expect(localStorage.getItem(PENDING_STORAGE_KEY)).not.toBeNull()
  })

  it('clears the matching pending round', () => {
    localStorage.setItem(
      PENDING_STORAGE_KEY,
      JSON.stringify({ id: 'round-owned-by-this-tab' }),
    )

    clearPendingRound('round-owned-by-this-tab')

    expect(localStorage.getItem(PENDING_STORAGE_KEY)).toBeNull()
  })

  it('supports unconditional stale-state cleanup during startup', () => {
    localStorage.setItem(
      PENDING_STORAGE_KEY,
      JSON.stringify({ id: 'stale-round' }),
    )

    clearPendingRound()

    expect(localStorage.getItem(PENDING_STORAGE_KEY)).toBeNull()
  })
})

describe('validated storage reads', () => {
  it('rejects a superficially versioned game with no physical shoe', () => {
    localStorage.setItem(
      GAME_STORAGE_KEY,
      JSON.stringify({ version: 1, shoe: {}, history: [] }),
    )

    expect(loadGameState()).toBeNull()
  })

  it('rejects a malformed or over-limit pending journal', () => {
    localStorage.setItem(
      PENDING_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        id: 'tampered',
        playMode: 'bet',
        bets: {
          player: 0,
          banker: 0,
          tie: 1_000_000_000,
          playerPair: 0,
          bankerPair: 0,
        },
        revealedCount: 0,
      }),
    )

    expect(loadPendingRound()).toBeNull()
  })
})

function card(id: string, rank: Card['rank'], suit: Card['suit']): Card {
  return { id, rank, suit, deck: 1 }
}

describe('historyToCsv', () => {
  it('exports enough wager and balance fields to independently audit settlement', () => {
    const playerCards = [
      card('p1', '2', 'spades'),
      card('p2', '3', 'hearts'),
    ]
    const bankerCards = [
      card('b1', '4', 'clubs'),
      card('b2', '4', 'diamonds'),
    ]
    const record: RoundRecord = {
      id: 'round-audit-1',
      shoeId: 'shoe-audit-1',
      handNumber: 1,
      timestamp: '2026-07-31T00:00:00.000Z',
      playMode: 'bet',
      bets: {
        player: 0,
        banker: 100,
        tie: 0,
        playerPair: 0,
        bankerPair: 10,
      },
      playerCards,
      bankerCards,
      dealOrder: [
        playerCards[0],
        bankerCards[0],
        playerCards[1],
        bankerCards[1],
      ],
      playerTotal: 5,
      bankerTotal: 8,
      winner: 'banker',
      natural: true,
      playerPair: false,
      bankerPair: true,
      cardsUsed: 4,
      settlement: {
        totalStake: 110,
        totalReturned: 315,
        net: 205,
        commissionCharged: 5,
        breakdown: { banker: 195, bankerPair: 120 },
      },
      balanceBefore: 10_000,
      balanceAfter: 10_205,
      cardsRemaining: 400,
      rulesetVersion: 'test-rules',
      shuffleVersion: 'test-shuffle',
    }

    const [header, row] = historyToCsv([record]).split('\n')
    expect(header).toContain('round_id')
    expect(header).toContain('bet_banker')
    expect(header).toContain('total_returned')
    expect(header).toContain('commission_charged')
    expect(header).toContain('balance_before')
    expect(row).toContain('round-audit-1')
    expect(row).toContain(',100,0,0,10,110,315,5,205,10000,10205,')
  })
})
