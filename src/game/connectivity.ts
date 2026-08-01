export const CONNECTIVITY_RETRY_MS = 600_000
export const CONNECTIVITY_PROBE_TIMEOUT_MS = 15_000

export type ConnectivityStatus = 'checking' | 'online' | 'offline'
export type ConnectivityOfflineReason = 'navigator' | 'probe'

export interface ConnectivitySnapshot {
  status: ConnectivityStatus
  reason: ConnectivityOfflineReason | null
  checkedAt: number | null
  nextRetryAt: number | null
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout> | number

interface OnlineSource {
  readonly onLine: boolean
}

interface ConnectivityEventTarget {
  addEventListener(type: 'online' | 'offline', listener: () => void): void
  removeEventListener(type: 'online' | 'offline', listener: () => void): void
}

export interface ConnectivityMonitorOptions {
  onChange?: (snapshot: ConnectivitySnapshot) => void
  retryIntervalMs?: number
  probeTimeoutMs?: number
  probeUrl?: string
  probe?: (signal: AbortSignal) => Promise<unknown>
  fetchFn?: typeof fetch
  onlineSource?: OnlineSource
  eventTarget?: ConnectivityEventTarget
  now?: () => number
  setTimeoutFn?: (callback: () => void, delayMs: number) => TimerHandle
  clearTimeoutFn?: (handle: TimerHandle) => void
}

export interface ConnectivityMonitor {
  start(): void
  checkNow(): Promise<boolean>
  stop(): void
  getSnapshot(): ConnectivitySnapshot
}

function browserProbeUrl(): string {
  if (typeof window === 'undefined') {
    throw new Error('A probeUrl is required outside a browser.')
  }
  return new URL('/', window.location.href).toString()
}

function browserEventTarget(): ConnectivityEventTarget {
  if (typeof window === 'undefined') {
    throw new Error('An eventTarget is required outside a browser.')
  }
  return window
}

function browserOnlineSource(): OnlineSource {
  if (typeof navigator === 'undefined') {
    throw new Error('An onlineSource is required outside a browser.')
  }
  return navigator
}

/**
 * Creates a framework-independent browser connectivity monitor.
 *
 * The default probe is a cache-bypassing HEAD request to the current origin.
 * A completed HTTP response proves connectivity even when its status is not 2xx;
 * only a transport failure or timeout is treated as offline.
 */
export function createConnectivityMonitor(
  options: ConnectivityMonitorOptions = {},
): ConnectivityMonitor {
  const retryIntervalMs =
    options.retryIntervalMs ?? CONNECTIVITY_RETRY_MS
  const probeTimeoutMs =
    options.probeTimeoutMs ?? CONNECTIVITY_PROBE_TIMEOUT_MS
  const onlineSource = options.onlineSource ?? browserOnlineSource()
  const eventTarget = options.eventTarget ?? browserEventTarget()
  const now = options.now ?? Date.now
  const setTimer = options.setTimeoutFn ?? globalThis.setTimeout.bind(globalThis)
  const clearTimer =
    options.clearTimeoutFn ?? globalThis.clearTimeout.bind(globalThis)

  const probe =
    options.probe ??
    (async (signal: AbortSignal) => {
      const fetchFn = options.fetchFn ?? globalThis.fetch
      await fetchFn(options.probeUrl ?? browserProbeUrl(), {
        method: 'HEAD',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'follow',
        signal,
      })
    })

  let active = false
  let retryTimer: TimerHandle | null = null
  let activeProbe: Promise<boolean> | null = null
  let activeProbeController: AbortController | null = null
  let snapshot: ConnectivitySnapshot = {
    status: 'checking',
    reason: null,
    checkedAt: null,
    nextRetryAt: null,
  }

  const publish = (nextSnapshot: ConnectivitySnapshot) => {
    snapshot = nextSnapshot
    if (active) options.onChange?.({ ...nextSnapshot })
  }

  const clearRetry = () => {
    if (retryTimer === null) return
    clearTimer(retryTimer)
    retryTimer = null
  }

  const scheduleRetry = (
    reason: ConnectivityOfflineReason,
    checkedAt: number,
  ) => {
    clearRetry()
    const nextRetryAt = now() + retryIntervalMs
    retryTimer = setTimer(() => {
      retryTimer = null
      if (!active) return
      void checkNow()
    }, retryIntervalMs)
    publish({
      status: 'offline',
      reason,
      checkedAt,
      nextRetryAt,
    })
  }

  const checkNow = (): Promise<boolean> => {
    if (!active) return Promise.resolve(false)

    if (!onlineSource.onLine) {
      scheduleRetry('navigator', now())
      return Promise.resolve(false)
    }

    if (activeProbe) return activeProbe

    clearRetry()
    publish({
      status: 'checking',
      reason: null,
      checkedAt: snapshot.checkedAt,
      nextRetryAt: null,
    })

    const controller = new AbortController()
    activeProbeController = controller

    const currentProbe = (async () => {
      let timeoutTimer: TimerHandle | null = null
      try {
        const timeout = new Promise<never>((_, reject) => {
          timeoutTimer = setTimer(() => {
            controller.abort()
            reject(new Error('Connectivity probe timed out.'))
          }, probeTimeoutMs)
        })

        await Promise.race([
          Promise.resolve().then(() => probe(controller.signal)),
          timeout,
        ])

        if (!active || activeProbeController !== controller) return false
        if (!onlineSource.onLine) {
          scheduleRetry('navigator', now())
          return false
        }

        clearRetry()
        publish({
          status: 'online',
          reason: null,
          checkedAt: now(),
          nextRetryAt: null,
        })
        return true
      } catch {
        if (!active || activeProbeController !== controller) return false
        scheduleRetry(onlineSource.onLine ? 'probe' : 'navigator', now())
        return false
      } finally {
        if (timeoutTimer !== null) clearTimer(timeoutTimer)
        if (activeProbeController === controller) {
          activeProbeController = null
          activeProbe = null
        }
      }
    })()

    activeProbe = currentProbe
    return currentProbe
  }

  const handleOffline = () => {
    if (!active) return
    scheduleRetry('navigator', now())
  }

  const handleOnline = () => {
    if (!active) return
    void checkNow()
  }

  const start = () => {
    if (active) return
    active = true
    eventTarget.addEventListener('online', handleOnline)
    eventTarget.addEventListener('offline', handleOffline)
    if (!onlineSource.onLine) {
      scheduleRetry('navigator', now())
      return
    }
    void checkNow()
  }

  const stop = () => {
    if (!active) return
    active = false
    clearRetry()
    eventTarget.removeEventListener('online', handleOnline)
    eventTarget.removeEventListener('offline', handleOffline)
    activeProbeController?.abort()
    activeProbeController = null
    activeProbe = null
  }

  return {
    start,
    checkNow,
    stop,
    getSnapshot: () => ({ ...snapshot }),
  }
}
