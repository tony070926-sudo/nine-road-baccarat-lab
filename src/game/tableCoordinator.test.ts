import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersistedGameState } from '../types'
import { EMPTY_BETS, createSeededRandomInt, createShoe } from './baccarat'
import { TableCoordinator } from './tableCoordinator'
import {
  LEGACY_GAME_STORAGE_KEY,
  TABLE_STORAGE_KEY,
  commitTableEnvelope,
} from './tableStorage'
import { tableVersionOf } from './tableState'

const TEST_TIME = '2026-08-01T12:00:00.000Z'

function createGame(seed = 20260801): PersistedGameState {
  return {
    version: 1,
    balance: 10_000,
    shoe: createShoe(createSeededRandomInt(seed), `S-COORD-${seed}`),
    history: [],
    lastBets: { ...EMPTY_BETS },
    sessionStartedAt: TEST_TIME,
  }
}

function installLocalStorage() {
  const values = new Map<string, string>()
  const getItem = vi.fn((key: string) => values.get(key) ?? null)
  const setItem = vi.fn((key: string, value: string) => {
    values.set(key, value)
  })
  const removeItem = vi.fn((key: string) => {
    values.delete(key)
  })
  vi.stubGlobal('localStorage', { getItem, setItem, removeItem })
  return { values, setItem }
}

interface ListenerMap {
  message?: (event: MessageEvent<unknown>) => void
  storage?: (event: StorageEvent) => void
}

function installMessagingHarness() {
  const listeners: ListenerMap = {}
  const posted: unknown[] = []

  class FakeBroadcastChannel {
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      if (type === 'message') {
        listeners.message = listener as (event: MessageEvent<unknown>) => void
      }
    }

    removeEventListener() {
      listeners.message = undefined
    }

    postMessage(value: unknown) {
      posted.push(value)
    }

    close() {}
  }

  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  vi.stubGlobal('window', {
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      if (type === 'storage') {
        listeners.storage = listener as (event: StorageEvent) => void
      }
    },
    removeEventListener: () => {
      listeners.storage = undefined
    },
  })

  return { listeners, posted }
}

beforeEach(() => {
  installLocalStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TableCoordinator', () => {
  it('bootstraps once and then treats v2 as canonical', () => {
    const first = new TableCoordinator('tab-a').bootstrap(() => createGame())
    expect(first.status).toBe('ready')
    if (first.status !== 'ready') return
    expect(first.snapshot.revision).toBe(1)
    expect(first.snapshot.lastMutation).toBe('bootstrap')

    const second = new TableCoordinator('tab-b').bootstrap(() =>
      createGame(20260802),
    )
    expect(second.status).toBe('ready')
    if (second.status === 'ready') {
      expect(second.snapshot.commitId).toBe(first.snapshot.commitId)
      expect(second.snapshot.game).toEqual(first.snapshot.game)
    }
  })

  it('migrates legacy state and fails closed on corrupt v2', () => {
    const storage = installLocalStorage()
    const legacyGame = createGame()
    storage.values.set(LEGACY_GAME_STORAGE_KEY, JSON.stringify(legacyGame))

    const migrated = new TableCoordinator('tab-migrator').bootstrap(() =>
      createGame(20260802),
    )
    expect(migrated.status).toBe('ready')
    if (migrated.status === 'ready') {
      expect(migrated.snapshot.lastMutation).toBe('migrate-v1')
      expect(migrated.snapshot.game).toEqual(legacyGame)
    }

    storage.values.set(TABLE_STORAGE_KEY, '{broken')
    expect(
      new TableCoordinator('tab-corrupt').bootstrap(() => createGame()),
    ).toEqual({ status: 'corrupt', source: 'v2' })
  })

  it('rejects stale commits without changing the canonical revision', () => {
    const coordinator = new TableCoordinator('tab-a')
    const ready = coordinator.bootstrap(() => createGame())
    expect(ready.status).toBe('ready')
    if (ready.status !== 'ready') return

    const first = coordinator.commit(
      tableVersionOf(ready.snapshot),
      { game: ready.snapshot.game, pending: null },
      'reset',
    )
    expect(first.status).toBe('committed')

    const stale = coordinator.commit(
      tableVersionOf(ready.snapshot),
      { game: createGame(20260803), pending: null },
      'reset',
    )
    expect(stale.status).toBe('conflict')
    if (stale.status === 'conflict') {
      expect(stale.current?.revision).toBe(2)
    }
  })

  it('broadcasts local commits and only syncs reread canonical remote state', () => {
    const messaging = installMessagingHarness()
    const coordinator = new TableCoordinator('tab-a')
    coordinator.start()
    const ready = coordinator.bootstrap(() => createGame())
    expect(ready.status).toBe('ready')
    if (ready.status !== 'ready') return

    const snapshots: number[] = []
    coordinator.subscribe((snapshot) => snapshots.push(snapshot.revision))
    const remote = commitTableEnvelope({
      expectedVersion: tableVersionOf(ready.snapshot),
      next: { game: ready.snapshot.game, pending: null },
      writerId: 'tab-b',
      mutation: 'reset',
    })
    expect(remote.status).toBe('committed')
    if (remote.status !== 'committed') return

    messaging.listeners.message?.(
      new MessageEvent('message', {
        data: {
          type: 'table-commit',
          schemaVersion: 2,
          revision: remote.snapshot.revision,
          commitId: 'untrusted-hint-id',
          writerId: 'tab-b',
        },
      }),
    )
    expect(snapshots).toEqual([2])

    messaging.listeners.message?.(
      new MessageEvent('message', {
        data: {
          type: 'table-commit',
          schemaVersion: 2,
          revision: 999,
          commitId: 'forged',
          writerId: 'tab-c',
        },
      }),
    )
    expect(snapshots).toEqual([2])
    expect(messaging.posted.length).toBeGreaterThan(0)
    coordinator.dispose()
  })

  it('does not replay a delayed hint for an independently adopted snapshot', () => {
    const messaging = installMessagingHarness()
    const coordinator = new TableCoordinator('tab-a')
    coordinator.start()
    const ready = coordinator.bootstrap(() => createGame())
    expect(ready.status).toBe('ready')
    if (ready.status !== 'ready') return
    const remote = commitTableEnvelope({
      expectedVersion: tableVersionOf(ready.snapshot),
      next: { game: ready.snapshot.game, pending: null },
      writerId: 'tab-b',
      mutation: 'reset',
    })
    expect(remote.status).toBe('committed')
    if (remote.status !== 'committed') return

    const revisions: number[] = []
    coordinator.subscribe((snapshot) => revisions.push(snapshot.revision))
    coordinator.adopt(remote.snapshot)
    messaging.listeners.message?.(
      new MessageEvent('message', {
        data: {
          type: 'table-commit',
          schemaVersion: 2,
          revision: remote.snapshot.revision,
          commitId: remote.snapshot.commitId,
          writerId: 'tab-b',
        },
      }),
    )
    expect(revisions).toEqual([])
    coordinator.dispose()
  })

  it('uses storage events as revision hints and ignores malformed payloads', () => {
    const messaging = installMessagingHarness()
    const coordinator = new TableCoordinator('tab-a')
    coordinator.start()
    const ready = coordinator.bootstrap(() => createGame())
    expect(ready.status).toBe('ready')
    if (ready.status !== 'ready') return

    const revisions: number[] = []
    coordinator.subscribe((snapshot) => revisions.push(snapshot.revision))
    const remote = commitTableEnvelope({
      expectedVersion: tableVersionOf(ready.snapshot),
      next: { game: ready.snapshot.game, pending: null },
      writerId: 'tab-b',
      mutation: 'replace-shoe',
    })
    expect(remote.status).toBe('committed')
    if (remote.status !== 'committed') return

    messaging.listeners.storage?.({
      key: TABLE_STORAGE_KEY,
      newValue: JSON.stringify({ revision: remote.snapshot.revision }),
    } as StorageEvent)
    messaging.listeners.storage?.({
      key: TABLE_STORAGE_KEY,
      newValue: '{bad',
    } as StorageEvent)
    expect(revisions).toEqual([2])
  })
})
