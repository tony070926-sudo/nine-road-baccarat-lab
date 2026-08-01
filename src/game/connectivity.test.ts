import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTIVITY_PROBE_TIMEOUT_MS,
  CONNECTIVITY_RETRY_MS,
  createConnectivityMonitor,
  type ConnectivitySnapshot,
} from './connectivity'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function createHarness(onLine = true) {
  const events = new EventTarget()
  const onlineSource = { onLine }
  const snapshots: ConnectivitySnapshot[] = []
  return {
    events,
    onlineSource,
    snapshots,
    dispatch(type: 'online' | 'offline') {
      events.dispatchEvent(new Event(type))
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('createConnectivityMonitor', () => {
  it('treats navigator.onLine=false as offline without issuing a probe', async () => {
    const harness = createHarness(false)
    const probe = vi.fn(async () => undefined)
    const monitor = createConnectivityMonitor({
      eventTarget: harness.events,
      onlineSource: harness.onlineSource,
      probe,
      onChange: (snapshot) => harness.snapshots.push(snapshot),
    })

    monitor.start()

    expect(probe).not.toHaveBeenCalled()
    expect(monitor.getSnapshot()).toEqual({
      status: 'offline',
      reason: 'navigator',
      checkedAt: 1_000,
      nextRetryAt: 1_000 + CONNECTIVITY_RETRY_MS,
    })

    await vi.advanceTimersByTimeAsync(CONNECTIVITY_RETRY_MS)
    expect(probe).not.toHaveBeenCalled()
    expect(monitor.getSnapshot().nextRetryAt).toBe(
      1_000 + CONNECTIVITY_RETRY_MS * 2,
    )
  })

  it('waits a full ten minutes after a failed probe, then stops retrying on success', async () => {
    const harness = createHarness()
    const probe = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(undefined)
    const monitor = createConnectivityMonitor({
      eventTarget: harness.events,
      onlineSource: harness.onlineSource,
      probe,
      onChange: (snapshot) => harness.snapshots.push(snapshot),
    })

    monitor.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(monitor.getSnapshot().status).toBe('offline')
    expect(monitor.getSnapshot().reason).toBe('probe')

    await vi.advanceTimersByTimeAsync(CONNECTIVITY_RETRY_MS - 1)
    expect(probe).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(probe).toHaveBeenCalledTimes(2)
    expect(monitor.getSnapshot().status).toBe('online')
    expect(monitor.getSnapshot().nextRetryAt).toBeNull()

    await vi.advanceTimersByTimeAsync(CONNECTIVITY_RETRY_MS)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('uses the online event to probe immediately instead of waiting ten minutes', async () => {
    const harness = createHarness(false)
    const probe = vi.fn(async () => undefined)
    const monitor = createConnectivityMonitor({
      eventTarget: harness.events,
      onlineSource: harness.onlineSource,
      probe,
    })

    monitor.start()
    await vi.advanceTimersByTimeAsync(CONNECTIVITY_RETRY_MS / 2)
    harness.onlineSource.onLine = true
    harness.dispatch('online')
    await vi.advanceTimersByTimeAsync(0)

    expect(probe).toHaveBeenCalledTimes(1)
    expect(monitor.getSnapshot().status).toBe('online')

    await vi.advanceTimersByTimeAsync(CONNECTIVITY_RETRY_MS)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('moves offline on the browser event and probes immediately when it returns', async () => {
    const harness = createHarness()
    const probe = vi.fn(async () => undefined)
    const monitor = createConnectivityMonitor({
      eventTarget: harness.events,
      onlineSource: harness.onlineSource,
      probe,
    })

    monitor.start()
    await vi.advanceTimersByTimeAsync(0)
    harness.onlineSource.onLine = false
    harness.dispatch('offline')

    expect(monitor.getSnapshot().status).toBe('offline')
    expect(monitor.getSnapshot().reason).toBe('navigator')

    harness.onlineSource.onLine = true
    harness.dispatch('online')
    await vi.advanceTimersByTimeAsync(0)

    expect(probe).toHaveBeenCalledTimes(2)
    expect(monitor.getSnapshot().status).toBe('online')
  })

  it('shares one in-flight probe across overlapping checks and online events', async () => {
    const harness = createHarness()
    const pending = deferred<void>()
    const probe = vi.fn(() => pending.promise)
    const monitor = createConnectivityMonitor({
      eventTarget: harness.events,
      onlineSource: harness.onlineSource,
      probe,
    })

    monitor.start()
    const repeatedCheck = monitor.checkNow()
    harness.dispatch('online')
    await vi.advanceTimersByTimeAsync(0)

    expect(probe).toHaveBeenCalledTimes(1)
    pending.resolve()
    await expect(repeatedCheck).resolves.toBe(true)
    expect(monitor.getSnapshot().status).toBe('online')
  })

  it('times out a hung request before scheduling the ten-minute retry', async () => {
    const harness = createHarness()
    const probe = vi.fn(() => new Promise<void>(() => undefined))
    const monitor = createConnectivityMonitor({
      eventTarget: harness.events,
      onlineSource: harness.onlineSource,
      probe,
    })

    monitor.start()
    await vi.advanceTimersByTimeAsync(CONNECTIVITY_PROBE_TIMEOUT_MS)

    expect(probe).toHaveBeenCalledTimes(1)
    expect(monitor.getSnapshot().status).toBe('offline')
    expect(monitor.getSnapshot().reason).toBe('probe')

    await vi.advanceTimersByTimeAsync(CONNECTIVITY_RETRY_MS)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('does not report a probe success when the browser became offline in flight', async () => {
    const harness = createHarness()
    const pending = deferred<void>()
    const monitor = createConnectivityMonitor({
      eventTarget: harness.events,
      onlineSource: harness.onlineSource,
      probe: () => pending.promise,
    })

    monitor.start()
    await vi.advanceTimersByTimeAsync(0)
    harness.onlineSource.onLine = false
    pending.resolve()
    await vi.advanceTimersByTimeAsync(0)

    expect(monitor.getSnapshot().status).toBe('offline')
    expect(monitor.getSnapshot().reason).toBe('navigator')
    expect(monitor.getSnapshot().nextRetryAt).not.toBeNull()
  })

  it('removes listeners, timers, and post-unmount updates on stop', async () => {
    const harness = createHarness()
    const pending = deferred<void>()
    const probe = vi.fn(() => pending.promise)
    const monitor = createConnectivityMonitor({
      eventTarget: harness.events,
      onlineSource: harness.onlineSource,
      probe,
      onChange: (snapshot) => harness.snapshots.push(snapshot),
    })

    monitor.start()
    monitor.start()
    await vi.advanceTimersByTimeAsync(0)
    const updateCountBeforeStop = harness.snapshots.length
    monitor.stop()
    monitor.stop()

    await expect(monitor.checkNow()).resolves.toBe(false)

    pending.resolve()
    harness.dispatch('online')
    await vi.advanceTimersByTimeAsync(CONNECTIVITY_RETRY_MS)

    expect(harness.snapshots).toHaveLength(updateCountBeforeStop)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('performs a cache-bypassing same-origin HEAD request by default', async () => {
    const harness = createHarness()
    const fetchFn = vi.fn(async () => ({ status: 503 }) as Response)
    const monitor = createConnectivityMonitor({
      eventTarget: harness.events,
      onlineSource: harness.onlineSource,
      probeUrl: 'https://casino.example/',
      fetchFn,
    })

    monitor.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchFn).toHaveBeenCalledWith(
      'https://casino.example/',
      expect.objectContaining({
        method: 'HEAD',
        cache: 'no-store',
        credentials: 'same-origin',
      }),
    )
    expect(monitor.getSnapshot().status).toBe('online')
  })

  it('derives the default probe from the current browser origin', async () => {
    const fakeWindow = Object.assign(new EventTarget(), {
      location: { href: 'https://casino.example/table/08' },
    })
    const fetchFn = vi.fn(async () => ({ status: 204 }) as Response)
    vi.stubGlobal('window', fakeWindow)
    vi.stubGlobal('navigator', { onLine: true })

    const monitor = createConnectivityMonitor({ fetchFn })
    monitor.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchFn).toHaveBeenCalledWith(
      'https://casino.example/',
      expect.objectContaining({ method: 'HEAD' }),
    )
    monitor.stop()
  })
})
