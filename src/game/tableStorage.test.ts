import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersistedGameState, PersistedPendingRound } from '../types'
import {
  EMPTY_BETS,
  createSeededRandomInt,
  createShoe,
  dealRound,
} from './baccarat'
import { settleRoundState } from './tableEngine'
import {
  LEGACY_GAME_STORAGE_KEY,
  LEGACY_PENDING_STORAGE_KEY,
  TABLE_STORAGE_KEY,
  commitTableEnvelope,
  isPersistedTableEnvelopeV2,
  migrateLegacyTable,
  readTableEnvelope,
  readLegacyTableState,
} from './tableStorage'
import type { PersistedTableEnvelopeV2, TableCoreState } from './tableState'
import { tableVersionOf } from './tableState'

const TEST_TIME = '2026-08-01T12:00:00.000Z'

function createLocalStorageHarness() {
  const values = new Map<string, string>()
  const getItem = vi.fn((key: string) => values.get(key) ?? null)
  const setItem = vi.fn((key: string, value: string) => {
    values.set(key, value)
  })
  const removeItem = vi.fn((key: string) => {
    values.delete(key)
  })
  vi.stubGlobal('localStorage', { getItem, setItem, removeItem })
  return { values, getItem, setItem, removeItem }
}

function fixture(
  seed = 20260801,
  shoeId = 'S-TABLE-V2',
): {
  game: PersistedGameState
  pending: PersistedPendingRound
} {
  const shoe = createShoe(createSeededRandomInt(seed), shoeId)
  const dealt = dealRound(shoe)
  const game: PersistedGameState = {
    version: 1,
    balance: 10_000,
    shoe,
    history: [],
    lastBets: { ...EMPTY_BETS },
    sessionStartedAt: TEST_TIME,
  }
  const pending: PersistedPendingRound = {
    version: 1,
    id: `round-${shoeId}`,
    playMode: 'bet',
    revealControl: 'player-squeeze',
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

function envelope(
  core: TableCoreState,
  overrides: Partial<PersistedTableEnvelopeV2> = {},
): PersistedTableEnvelopeV2 {
  return {
    schemaVersion: 2,
    revision: 1,
    commitId: 'commit-1',
    updatedAt: TEST_TIME,
    lastWriterId: 'tab-a',
    lastMutation: 'bootstrap',
    ...core,
    ...overrides,
  }
}

function settledCore(): TableCoreState {
  const { game, pending } = fixture()
  return settleRoundState(
    {
      game,
      pending: {
        ...pending,
        revealedCount: pending.result.dealOrder.length,
      },
    },
    { roundId: pending.id, settledAt: TEST_TIME },
  ).state
}

let storage: ReturnType<typeof createLocalStorageHarness>

beforeEach(() => {
  storage = createLocalStorageHarness()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('v2 envelope validation and reads', () => {
  it('distinguishes a missing envelope from a corrupt envelope', () => {
    expect(readTableEnvelope()).toEqual({ status: 'missing' })

    storage.values.set(TABLE_STORAGE_KEY, '{not-json')
    expect(readTableEnvelope()).toEqual({
      status: 'corrupt',
      raw: '{not-json',
    })
  })

  it('requires exact metadata keys and a matching pending/game relationship', () => {
    const { game, pending } = fixture()
    const valid = envelope({ game, pending })
    expect(isPersistedTableEnvelopeV2(valid)).toBe(true)
    expect(isPersistedTableEnvelopeV2({ ...valid, unexpected: true })).toBe(
      false,
    )

    const otherPending = fixture(20260802, 'S-OTHER').pending
    expect(
      isPersistedTableEnvelopeV2({ ...valid, pending: otherPending }),
    ).toBe(false)
  })

  it('reads legacy envelopes without a marker and validates new marker invariants', () => {
    const { game } = fixture()
    const legacyEnvelope = envelope({ game, pending: null })
    expect(Object.hasOwn(legacyEnvelope, 'presentationPending')).toBe(false)
    expect(isPersistedTableEnvelopeV2(legacyEnvelope)).toBe(true)

    const settled = settledCore()
    const valid = envelope(settled)
    expect(isPersistedTableEnvelopeV2(valid)).toBe(true)
    expect(
      isPersistedTableEnvelopeV2({
        ...valid,
        presentationPending: {
          type: 'settlement',
          roundId: 'not-the-latest-round',
        },
      }),
    ).toBe(false)
    expect(
      isPersistedTableEnvelopeV2({
        ...valid,
        presentationPending: {
          type: 'settlement',
          roundId: settled.game.history.at(-1)?.id,
          extra: true,
        },
      }),
    ).toBe(false)

    const { pending } = fixture()
    expect(
      isPersistedTableEnvelopeV2({
        ...valid,
        game,
        pending,
        presentationPending: {
          type: 'settlement',
          roundId: pending.id,
        },
      }),
    ).toBe(false)
  })

  it('reports storage access failures without treating them as missing', () => {
    storage.getItem.mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(readTableEnvelope()).toEqual({ status: 'unavailable' })
  })
})

describe('legacy v1 migration', () => {
  it('atomically preserves a valid in-progress round and then removes v1 keys', () => {
    const { game, pending } = fixture()
    const revealedPending = { ...pending, revealedCount: 2 }
    storage.values.set(LEGACY_GAME_STORAGE_KEY, JSON.stringify(game))
    storage.values.set(
      LEGACY_PENDING_STORAGE_KEY,
      JSON.stringify(revealedPending),
    )

    const result = migrateLegacyTable({
      writerId: 'tab-migrator',
      commitId: 'commit-migrated',
      updatedAt: TEST_TIME,
    })

    expect(result.status).toBe('migrated')
    if (result.status !== 'migrated') return
    expect(result.snapshot.revision).toBe(1)
    expect(result.snapshot.lastMutation).toBe('migrate-v1')
    expect(result.snapshot.pending?.revealedCount).toBe(2)
    expect(result.snapshot.presentationPending).toBeNull()
    expect(result.legacyCleanupComplete).toBe(true)
    expect(storage.values.has(LEGACY_GAME_STORAGE_KEY)).toBe(false)
    expect(storage.values.has(LEGACY_PENDING_STORAGE_KEY)).toBe(false)
    expect(readTableEnvelope()).toEqual({
      status: 'ok',
      snapshot: result.snapshot,
    })
  })

  it('migrates a valid game without inventing a pending round', () => {
    const { game } = fixture()
    storage.values.set(LEGACY_GAME_STORAGE_KEY, JSON.stringify(game))

    const result = migrateLegacyTable({
      writerId: 'tab-migrator',
      commitId: 'commit-game-only',
      updatedAt: TEST_TIME,
    })

    expect(result.status).toBe('migrated')
    if (result.status === 'migrated') {
      expect(result.snapshot.pending).toBeNull()
      expect(result.snapshot.presentationPending).toBeNull()
      expect(result.warning).toBeUndefined()
    }
  })

  it('discards a stale pending round but preserves the valid game', () => {
    const { game } = fixture()
    const stalePending = fixture(20260802, 'S-STALE').pending
    storage.values.set(LEGACY_GAME_STORAGE_KEY, JSON.stringify(game))
    storage.values.set(LEGACY_PENDING_STORAGE_KEY, JSON.stringify(stalePending))

    const legacy = readLegacyTableState()

    expect(legacy.status).toBe('ok')
    if (legacy.status === 'ok') {
      expect(legacy.core.game).toEqual(game)
      expect(legacy.core.pending).toBeNull()
      expect(legacy.warning).toBe('stale-pending-discarded')
    }
  })

  it('discards malformed pending data with an explicit warning', () => {
    const { game } = fixture()
    storage.values.set(LEGACY_GAME_STORAGE_KEY, JSON.stringify(game))
    storage.values.set(LEGACY_PENDING_STORAGE_KEY, '{broken')

    const result = migrateLegacyTable({
      writerId: 'tab-migrator',
      commitId: 'commit-invalid-pending',
      updatedAt: TEST_TIME,
    })

    expect(result.status).toBe('migrated')
    if (result.status === 'migrated') {
      expect(result.snapshot.pending).toBeNull()
      expect(result.warning).toBe('invalid-pending-discarded')
    }
  })

  it('treats a valid v2 envelope as authoritative and only cleans legacy keys', () => {
    const { game } = fixture()
    const current = envelope({ game, pending: null })
    storage.values.set(TABLE_STORAGE_KEY, JSON.stringify(current))
    storage.values.set(LEGACY_GAME_STORAGE_KEY, '{stale')
    storage.values.set(LEGACY_PENDING_STORAGE_KEY, '{stale')

    const result = migrateLegacyTable({ writerId: 'tab-b' })

    expect(result).toEqual({
      status: 'already-v2',
      snapshot: current,
      legacyCleanupComplete: true,
    })
    expect(storage.values.has(LEGACY_GAME_STORAGE_KEY)).toBe(false)
    expect(storage.values.has(LEGACY_PENDING_STORAGE_KEY)).toBe(false)
  })

  it('fails closed on corrupt v2 instead of falling back to valid v1', () => {
    const { game } = fixture()
    storage.values.set(TABLE_STORAGE_KEY, '{"schemaVersion":2}')
    storage.values.set(LEGACY_GAME_STORAGE_KEY, JSON.stringify(game))

    const result = migrateLegacyTable({ writerId: 'tab-migrator' })

    expect(result).toEqual({
      status: 'corrupt',
      source: 'v2',
      raw: '{"schemaVersion":2}',
    })
    expect(storage.values.has(LEGACY_GAME_STORAGE_KEY)).toBe(true)
  })

  it('distinguishes no legacy data from a corrupt legacy game', () => {
    expect(migrateLegacyTable({ writerId: 'tab-migrator' })).toEqual({
      status: 'missing',
    })

    storage.values.set(LEGACY_GAME_STORAGE_KEY, '{broken')
    expect(migrateLegacyTable({ writerId: 'tab-migrator' })).toEqual({
      status: 'corrupt',
      source: 'legacy',
      key: LEGACY_GAME_STORAGE_KEY,
      raw: '{broken',
    })
  })
})

describe('revision and commitId compare-write-read transactions', () => {
  it('creates revision one and rejects an expected version for missing state', () => {
    const { game } = fixture()
    const core = { game, pending: null }

    expect(
      commitTableEnvelope({
        expectedVersion: { revision: 1, commitId: 'missing' },
        next: core,
        writerId: 'tab-a',
        mutation: 'bootstrap',
        commitId: 'unused',
        updatedAt: TEST_TIME,
      }),
    ).toEqual({ status: 'conflict', current: null })

    const committed = commitTableEnvelope({
      expectedVersion: null,
      next: core,
      writerId: 'tab-a',
      mutation: 'bootstrap',
      commitId: 'commit-created',
      updatedAt: TEST_TIME,
    })
    expect(committed.status).toBe('committed')
    if (committed.status === 'committed') {
      expect(committed.snapshot.revision).toBe(1)
      expect(committed.snapshot.presentationPending).toBeNull()
      expect(Object.hasOwn(committed.snapshot, 'presentationPending')).toBe(
        true,
      )
    }
  })

  it('persists and clears a settlement marker through revisioned commits', () => {
    const { game } = fixture()
    const initial = envelope({ game, pending: null })
    storage.values.set(TABLE_STORAGE_KEY, JSON.stringify(initial))
    const settled = settledCore()

    const settlementCommit = commitTableEnvelope({
      expectedVersion: tableVersionOf(initial),
      next: settled,
      writerId: 'tab-a',
      mutation: 'settle-round',
      commitId: 'commit-settlement',
      updatedAt: TEST_TIME,
    })
    expect(settlementCommit.status).toBe('committed')
    if (settlementCommit.status !== 'committed') return
    expect(settlementCommit.snapshot.presentationPending).toEqual(
      settled.presentationPending,
    )

    const completed = commitTableEnvelope({
      expectedVersion: tableVersionOf(settlementCommit.snapshot),
      next: {
        game: settlementCommit.snapshot.game,
        pending: null,
        presentationPending: null,
      },
      writerId: 'tab-a',
      mutation: 'complete-presentation',
      commitId: 'commit-presentation-complete',
      updatedAt: TEST_TIME,
    })
    expect(completed.status).toBe('committed')
    if (completed.status === 'committed') {
      expect(completed.snapshot.revision).toBe(initial.revision + 2)
      expect(completed.snapshot.lastMutation).toBe('complete-presentation')
      expect(completed.snapshot.presentationPending).toBeNull()
    }
  })

  it('increments revision and rejects a stale writer without overwriting', () => {
    const { game } = fixture()
    const initial = envelope({ game, pending: null }, { revision: 7 })
    storage.values.set(TABLE_STORAGE_KEY, JSON.stringify(initial))

    const committed = commitTableEnvelope({
      expectedVersion: tableVersionOf(initial),
      next: { game, pending: null },
      writerId: 'tab-a',
      mutation: 'replace-shoe',
      commitId: 'commit-8',
      updatedAt: TEST_TIME,
    })
    expect(committed.status).toBe('committed')
    if (committed.status !== 'committed') return
    expect(committed.snapshot.revision).toBe(8)

    const durableBeforeStaleWrite = storage.values.get(TABLE_STORAGE_KEY)
    const stale = commitTableEnvelope({
      expectedVersion: tableVersionOf(initial),
      next: { game, pending: null },
      writerId: 'tab-stale',
      mutation: 'reset',
      commitId: 'commit-stale',
      updatedAt: TEST_TIME,
    })

    expect(stale).toEqual({
      status: 'conflict',
      current: committed.snapshot,
    })
    expect(storage.values.get(TABLE_STORAGE_KEY)).toBe(durableBeforeStaleWrite)
  })

  it('reports not-written and preserves the previous envelope when setItem throws', () => {
    const { game } = fixture()
    const initial = envelope({ game, pending: null })
    const initialRaw = JSON.stringify(initial)
    storage.values.set(TABLE_STORAGE_KEY, initialRaw)
    storage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    const result = commitTableEnvelope({
      expectedVersion: tableVersionOf(initial),
      next: { game, pending: null },
      writerId: 'tab-a',
      mutation: 'reset',
      commitId: 'commit-failed',
      updatedAt: TEST_TIME,
    })

    expect(result).toEqual({ status: 'not-written' })
    expect(storage.values.get(TABLE_STORAGE_KEY)).toBe(initialRaw)
  })

  it('returns indeterminate when readback is valid but not the candidate just written', () => {
    const { game } = fixture()
    storage.setItem.mockImplementation((key: string, value: string) => {
      const parsed = JSON.parse(value) as PersistedTableEnvelopeV2
      storage.values.set(
        key,
        JSON.stringify({ ...parsed, commitId: 'commit-from-other-writer' }),
      )
    })

    const result = commitTableEnvelope({
      expectedVersion: null,
      next: { game, pending: null },
      writerId: 'tab-a',
      mutation: 'bootstrap',
      commitId: 'commit-ours',
      updatedAt: TEST_TIME,
    })

    expect(result.status).toBe('indeterminate')
    if (result.status === 'indeterminate') {
      expect(result.readback.status).toBe('ok')
    }
  })

  it('does not remove v1 until the v2 migration write is verified', () => {
    const { game } = fixture()
    storage.values.set(LEGACY_GAME_STORAGE_KEY, JSON.stringify(game))
    storage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    const result = migrateLegacyTable({
      writerId: 'tab-migrator',
      commitId: 'commit-failed-migration',
      updatedAt: TEST_TIME,
    })

    expect(result).toEqual({ status: 'not-written' })
    expect(storage.values.has(LEGACY_GAME_STORAGE_KEY)).toBe(true)
    expect(storage.removeItem).not.toHaveBeenCalled()
  })
})
