import { describe, expect, it, vi } from 'vitest'
import { EMPTY_BETS, createSeededRandomInt, createShoe } from '../game/baccarat'
import { prepareRoundState } from '../game/tableEngine'
import type { TableCoordinator } from '../game/tableCoordinator'
import type { TableLeaseRelease } from '../game/tableLease'
import type { PersistedTableEnvelopeV2 } from '../game/tableState'
import type { PersistedGameState } from '../types'
import { TableLeaseArbiter } from './tableLeaseArbiter'
import { startTableRestoreLoop } from './useTableRestoreLoop'

function pendingEnvelope(): PersistedTableEnvelopeV2 {
  const game: PersistedGameState = {
    version: 1,
    balance: 10_000,
    shoe: createShoe(createSeededRandomInt(91), 'RESTORE-LOOP-SHOE'),
    history: [],
    lastBets: { ...EMPTY_BETS },
    sessionStartedAt: '2026-08-02T00:00:00.000Z',
  }
  const prepared = prepareRoundState(
    { game, pending: null },
    {
      bets: { ...EMPTY_BETS, player: 100 },
      playMode: 'bet',
      revealControl: 'dealer-reveal',
      roundId: 'RESTORE-LOOP-ROUND',
    },
  )
  return {
    schemaVersion: 2,
    revision: 1,
    commitId: 'RESTORE-LOOP-COMMIT',
    updatedAt: '2026-08-02T00:00:00.000Z',
    lastWriterId: 'RESTORE-LOOP-WRITER',
    lastMutation: 'prepare-round',
    game: prepared.game,
    pending: prepared.pending,
  }
}

function deferredLease() {
  let resolve!: (release: TableLeaseRelease | null) => void
  const promise = new Promise<TableLeaseRelease | null>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function timerHarness() {
  let sequence = 0
  const callbacks = new Map<number, () => void>()
  return {
    setTimer: (callback: () => void) => {
      sequence += 1
      callbacks.set(sequence, callback)
      return sequence
    },
    clearTimer: (handle: number) => callbacks.delete(handle),
    runNext: () => {
      const next = callbacks.entries().next().value as
        [number, () => void] | undefined
      if (!next) throw new Error('No retry timer is armed')
      callbacks.delete(next[0])
      next[1]()
    },
    count: () => callbacks.size,
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function coordinatorHarness(snapshot: PersistedTableEnvelopeV2) {
  let listener: ((value: PersistedTableEnvelopeV2) => void) | null = null
  const coordinator = {
    start: vi.fn(),
    dispose: vi.fn(),
    subscribe: vi.fn((next: (value: PersistedTableEnvelopeV2) => void) => {
      listener = next
      return vi.fn()
    }),
    read: vi.fn(() => ({ status: 'ok' as const, snapshot })),
    bootstrap: vi.fn(() => ({ status: 'ready' as const, snapshot })),
  } as unknown as TableCoordinator
  return {
    coordinator,
    publish: () => {
      if (!listener) throw new Error('Restore loop has not subscribed')
      listener(snapshot)
    },
  }
}

describe('startTableRestoreLoop', () => {
  it('invalidates a stale acquisition and coalesces repeated snapshot retries', async () => {
    const snapshot = pendingEnvelope()
    const first = deferredLease()
    const second = deferredLease()
    const acquireRaw = vi
      .fn<() => Promise<TableLeaseRelease | null>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const firstRelease = vi.fn()
    const secondRelease = vi.fn()
    const tableLease = new TableLeaseArbiter(acquireRaw)
    const timers = timerHarness()
    const table = coordinatorHarness(snapshot)
    const applySnapshot = vi.fn()

    const cleanup = startTableRestoreLoop({
      initialGame: snapshot.game,
      tableCoordinator: table.coordinator,
      tableLease,
      applySnapshot,
      cancelProcedure: vi.fn(),
      releaseLease: () => tableLease.release(),
      updateUi: vi.fn(),
      leaseSupported: () => true,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
    table.publish()
    table.publish()
    first.resolve(firstRelease)
    await flushPromises()

    expect(firstRelease).toHaveBeenCalledOnce()
    expect(table.coordinator.bootstrap).not.toHaveBeenCalled()
    expect(timers.count()).toBe(1)
    timers.runNext()
    expect(acquireRaw).toHaveBeenCalledTimes(2)
    second.resolve(secondRelease)
    await flushPromises()

    expect(table.coordinator.bootstrap).toHaveBeenCalledOnce()
    expect(
      applySnapshot.mock.calls.filter((call) => call[1] === true),
    ).toHaveLength(1)
    expect(tableLease.owns('restore')).toBe(true)
    cleanup()
    expect(secondRelease).toHaveBeenCalledOnce()
  })

  it('keeps retry intent while an action owns the local lease', async () => {
    const snapshot = pendingEnvelope()
    const actionRelease = vi.fn()
    const restoreRelease = vi.fn()
    const acquireRaw = vi
      .fn<() => Promise<TableLeaseRelease | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(actionRelease)
      .mockResolvedValueOnce(restoreRelease)
    const tableLease = new TableLeaseArbiter(acquireRaw)
    const timers = timerHarness()
    const table = coordinatorHarness(snapshot)
    const applySnapshot = vi.fn()
    const cleanup = startTableRestoreLoop({
      initialGame: snapshot.game,
      tableCoordinator: table.coordinator,
      tableLease,
      applySnapshot,
      cancelProcedure: vi.fn(),
      releaseLease: () => tableLease.release(),
      updateUi: vi.fn(),
      leaseSupported: () => true,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
    await flushPromises()
    expect(timers.count()).toBe(1)
    await expect(tableLease.acquire('action')).resolves.toBe('acquired')

    timers.runNext()
    await flushPromises()
    expect(
      applySnapshot.mock.calls.filter((call) => call[1] === false),
    ).toHaveLength(1)
    expect(timers.count()).toBe(1)
    expect(tableLease.release('action')).toBe(true)
    timers.runNext()
    await flushPromises()

    expect(tableLease.owns('restore')).toBe(true)
    expect(
      applySnapshot.mock.calls.filter((call) => call[1] === true),
    ).toHaveLength(1)
    cleanup()
  })

  it('does not passive-apply while an action acquisition is in flight', async () => {
    const snapshot = pendingEnvelope()
    const action = deferredLease()
    const actionRelease = vi.fn()
    const restoreRelease = vi.fn()
    const acquireRaw = vi
      .fn<() => Promise<TableLeaseRelease | null>>()
      .mockResolvedValueOnce(null)
      .mockReturnValueOnce(action.promise)
      .mockResolvedValueOnce(restoreRelease)
    const tableLease = new TableLeaseArbiter(acquireRaw)
    const timers = timerHarness()
    const table = coordinatorHarness(snapshot)
    const applySnapshot = vi.fn()
    const cleanup = startTableRestoreLoop({
      initialGame: snapshot.game,
      tableCoordinator: table.coordinator,
      tableLease,
      applySnapshot,
      cancelProcedure: vi.fn(),
      releaseLease: () => tableLease.release(),
      updateUi: vi.fn(),
      leaseSupported: () => true,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
    await flushPromises()
    const acquiringAction = tableLease.acquire('action')
    timers.runNext()
    await flushPromises()

    expect(
      applySnapshot.mock.calls.filter((call) => call[1] === false),
    ).toHaveLength(1)
    expect(timers.count()).toBe(1)
    action.resolve(actionRelease)
    await expect(acquiringAction).resolves.toBe('acquired')
    expect(tableLease.release('action')).toBe(true)
    timers.runNext()
    await flushPromises()

    expect(tableLease.owns('restore')).toBe(true)
    expect(
      applySnapshot.mock.calls.filter((call) => call[1] === true),
    ).toHaveLength(1)
    cleanup()
  })

  it('invalidates an in-flight action acquisition when a coordinator hint arrives', async () => {
    const snapshot = pendingEnvelope()
    const action = deferredLease()
    const actionRelease = vi.fn()
    const restoreRelease = vi.fn()
    const acquireRaw = vi
      .fn<() => Promise<TableLeaseRelease | null>>()
      .mockResolvedValueOnce(null)
      .mockReturnValueOnce(action.promise)
      .mockResolvedValueOnce(restoreRelease)
    const tableLease = new TableLeaseArbiter(acquireRaw)
    const timers = timerHarness()
    const table = coordinatorHarness(snapshot)
    const applySnapshot = vi.fn()
    const cleanup = startTableRestoreLoop({
      initialGame: snapshot.game,
      tableCoordinator: table.coordinator,
      tableLease,
      applySnapshot,
      cancelProcedure: vi.fn(),
      releaseLease: () => tableLease.release(),
      updateUi: vi.fn(),
      leaseSupported: () => true,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
    await flushPromises()
    expect(timers.count()).toBe(1)

    const acquiringAction = tableLease.acquire('action')
    table.publish()
    expect(timers.count()).toBe(1)
    action.resolve(actionRelease)
    await expect(acquiringAction).resolves.toBe('unavailable')
    expect(actionRelease).toHaveBeenCalledOnce()

    timers.runNext()
    await flushPromises()

    expect(acquireRaw).toHaveBeenCalledTimes(3)
    expect(tableLease.owns('restore')).toBe(true)
    expect(
      applySnapshot.mock.calls.filter((call) => call[1] === true),
    ).toHaveLength(1)
    cleanup()
    expect(restoreRelease).toHaveBeenCalledOnce()
  })

  it('replaces an armed retry timer with one timer across repeated hints', async () => {
    const snapshot = pendingEnvelope()
    const restoreRelease = vi.fn()
    const acquireRaw = vi
      .fn<() => Promise<TableLeaseRelease | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(restoreRelease)
    const tableLease = new TableLeaseArbiter(acquireRaw)
    const timers = timerHarness()
    const table = coordinatorHarness(snapshot)
    const applySnapshot = vi.fn()
    const cleanup = startTableRestoreLoop({
      initialGame: snapshot.game,
      tableCoordinator: table.coordinator,
      tableLease,
      applySnapshot,
      cancelProcedure: vi.fn(),
      releaseLease: () => tableLease.release(),
      updateUi: vi.fn(),
      leaseSupported: () => true,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
    await flushPromises()
    expect(timers.count()).toBe(1)

    table.publish()
    table.publish()
    expect(timers.count()).toBe(1)
    timers.runNext()
    await flushPromises()

    expect(timers.count()).toBe(0)
    expect(acquireRaw).toHaveBeenCalledTimes(2)
    expect(tableLease.owns('restore')).toBe(true)
    expect(
      applySnapshot.mock.calls.filter((call) => call[1] === true),
    ).toHaveLength(1)
    cleanup()
    expect(restoreRelease).toHaveBeenCalledOnce()
  })

  it('releases a lease that arrives after cleanup without updating the UI', async () => {
    const snapshot = pendingEnvelope()
    const pending = deferredLease()
    const lateRelease = vi.fn()
    const tableLease = new TableLeaseArbiter(() => pending.promise)
    const table = coordinatorHarness(snapshot)
    const applySnapshot = vi.fn()
    const updateUi = vi.fn()
    const cleanup = startTableRestoreLoop({
      initialGame: snapshot.game,
      tableCoordinator: table.coordinator,
      tableLease,
      applySnapshot,
      cancelProcedure: vi.fn(),
      releaseLease: () => tableLease.release(),
      updateUi,
      leaseSupported: () => true,
      setTimer: () => 1,
      clearTimer: vi.fn(),
    })

    cleanup()
    pending.resolve(lateRelease)
    await flushPromises()

    expect(lateRelease).toHaveBeenCalledOnce()
    expect(applySnapshot).not.toHaveBeenCalled()
    expect(updateUi).not.toHaveBeenCalled()
  })
})
