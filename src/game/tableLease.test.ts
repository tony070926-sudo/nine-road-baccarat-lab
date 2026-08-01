import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  tableLeaseIsSupported,
  tryAcquireTableLease,
} from './tableLease'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('tryAcquireTableLease', () => {
  it('fails closed when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {})

    const release = await tryAcquireTableLease()

    expect(tableLeaseIsSupported()).toBe(false)
    expect(release).toBeNull()
  })

  it('fails closed when the Web Locks request is rejected', async () => {
    const request = vi.fn(async () => {
      throw new Error('blocked by policy')
    })
    vi.stubGlobal('navigator', { locks: { request } })

    expect(tableLeaseIsSupported()).toBe(true)
    await expect(tryAcquireTableLease()).resolves.toBeNull()
  })

  it('returns null when another tab owns the table', async () => {
    const request = vi.fn(
      async (
        _name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => Promise<void> | void,
      ) => callback(null),
    )
    vi.stubGlobal('navigator', { locks: { request } })

    const release = await tryAcquireTableLease()

    expect(release).toBeNull()
    expect(request).toHaveBeenCalledWith(
      'nine-road-baccarat:active-table:v1',
      { mode: 'exclusive', ifAvailable: true },
      expect.any(Function),
    )
  })

  it('holds the exclusive lock until its idempotent release is called', async () => {
    let lockFinished = false
    const request = vi.fn(
      async (
        _name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => Promise<void> | void,
      ) => {
        await callback({ name: 'table', mode: 'exclusive' } as Lock)
        lockFinished = true
      },
    )
    vi.stubGlobal('navigator', { locks: { request } })

    const release = await tryAcquireTableLease()
    expect(release).toBeTypeOf('function')
    expect(lockFinished).toBe(false)

    release?.()
    release?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(lockFinished).toBe(true)
  })
})
