import { describe, expect, it, vi } from 'vitest'
import type { TableLeaseRelease } from '../game/tableLease'
import { TableLeaseArbiter } from './tableLeaseArbiter'

function deferredLease() {
  let resolve!: (release: TableLeaseRelease | null) => void
  const promise = new Promise<TableLeaseRelease | null>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('TableLeaseArbiter', () => {
  it('serializes different owners before Web Locks', async () => {
    const pending = deferredLease()
    const acquireRaw = vi.fn(() => pending.promise)
    const release = vi.fn()
    const arbiter = new TableLeaseArbiter(acquireRaw)

    const restoring = arbiter.acquire('restore')
    await expect(arbiter.acquire('action')).resolves.toBe('busy')
    expect(acquireRaw).toHaveBeenCalledTimes(1)
    pending.resolve(release)
    await expect(restoring).resolves.toBe('acquired')
    expect(arbiter.owns('restore')).toBe(true)
    expect(arbiter.release('restore')).toBe(true)
    expect(release).toHaveBeenCalledOnce()
  })

  it('releases a late lease when its request was invalidated', async () => {
    const pending = deferredLease()
    const lateRelease = vi.fn()
    const arbiter = new TableLeaseArbiter(() => pending.promise)

    const restoring = arbiter.acquire('restore')
    expect(arbiter.release('restore')).toBe(true)
    pending.resolve(lateRelease)

    await expect(restoring).resolves.toBe('unavailable')
    expect(lateRelease).toHaveBeenCalledOnce()
    expect(arbiter.isBusy()).toBe(false)
  })

  it('shares one in-flight acquisition between repeated requests by one owner', async () => {
    const pending = deferredLease()
    const release = vi.fn()
    const acquireRaw = vi.fn(() => pending.promise)
    const arbiter = new TableLeaseArbiter(acquireRaw)

    const first = arbiter.acquire('restore')
    const second = arbiter.acquire('restore')
    expect(second).toBe(first)
    expect(acquireRaw).toHaveBeenCalledOnce()

    pending.resolve(release)
    await expect(first).resolves.toBe('acquired')
    await expect(second).resolves.toBe('acquired')
    expect(arbiter.release('restore')).toBe(true)
    expect(release).toHaveBeenCalledOnce()
  })

  it('lets a restore retry acquire only after an action releases', async () => {
    const actionRelease = vi.fn()
    const restoreRelease = vi.fn()
    const acquireRaw = vi
      .fn<() => Promise<TableLeaseRelease | null>>()
      .mockResolvedValueOnce(actionRelease)
      .mockResolvedValueOnce(restoreRelease)
    const arbiter = new TableLeaseArbiter(acquireRaw)

    await expect(arbiter.acquire('action')).resolves.toBe('acquired')
    await expect(arbiter.acquire('restore')).resolves.toBe('busy')
    expect(arbiter.release('action')).toBe(true)
    await expect(arbiter.acquire('restore')).resolves.toBe('acquired')

    expect(acquireRaw).toHaveBeenCalledTimes(2)
    expect(actionRelease).toHaveBeenCalledOnce()
    expect(arbiter.owns('restore')).toBe(true)
  })
})
