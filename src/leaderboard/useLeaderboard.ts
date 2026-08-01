import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isRetryableLeaderboardError,
  LeaderboardApiError,
  leaderboardApi,
} from './client'
import {
  getOrCreateLeaderboardProfile,
  initialLeaderboardBalance,
  isHalfPointBalance,
  isLeaderboardBalance,
  normalizeDisplayName,
  saveLeaderboardProfile,
  type LeaderboardCrypto,
  type LeaderboardStorage,
} from './profile'
import {
  ensureInitialLeaderboardOutbox,
  pendingSubmissionFor,
  readLeaderboardSyncState,
  samePendingSubmission,
  saveLeaderboardSyncState,
  type LeaderboardLocalSyncState,
  type LeaderboardPendingSubmission,
} from './syncState'
import {
  DEFAULT_LEADERBOARD_PAGE_SIZE,
  type LeaderboardApi,
  type LeaderboardEntry,
  type LeaderboardLoadStatus,
  type LeaderboardProfile,
  type LeaderboardScore,
  type LeaderboardSyncStatus,
} from './types'

export interface UseLeaderboardOptions {
  active: boolean
  currentBalance: number
  recordedHighestBalance: number
  scoreEventId: string | null
  pageSize?: number
  api?: LeaderboardApi
  profileStorage?: LeaderboardStorage
  profileCrypto?: LeaderboardCrypto
}

export interface UseLeaderboardResult {
  profile: LeaderboardProfile | null
  profileError: string | null
  syncStatus: LeaderboardSyncStatus
  syncError: string | null
  syncCanRetry: boolean
  loadStatus: LeaderboardLoadStatus
  loadError: string | null
  entries: LeaderboardEntry[]
  self: LeaderboardScore | null
  total: number
  page: number
  pageSize: number
  totalPages: number
  saveDisplayName: (displayName: string) => string | null
  goToPage: (page: number) => void
  refresh: () => void
  retrySync: () => void
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function pendingFingerprint(pending: LeaderboardPendingSubmission): string {
  return `${pending.displayName}\u0000${pending.highestBalance}`
}

export function useLeaderboard({
  active,
  currentBalance,
  recordedHighestBalance,
  scoreEventId,
  pageSize: requestedPageSize = DEFAULT_LEADERBOARD_PAGE_SIZE,
  api = leaderboardApi,
  profileStorage,
  profileCrypto,
}: UseLeaderboardOptions): UseLeaderboardResult {
  const pageSize = Math.min(100, Math.max(1, Math.trunc(requestedPageSize)))
  const [profile, setProfile] = useState<LeaderboardProfile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<LeaderboardSyncStatus>('idle')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncCanRetry, setSyncCanRetry] = useState(false)
  const [loadStatus, setLoadStatus] = useState<LeaderboardLoadStatus>('idle')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [self, setSelf] = useState<LeaderboardScore | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)

  const initialBalanceRef = useRef(recordedHighestBalance)
  const activeRef = useRef(active)
  const pageRef = useRef(page)
  const initializedRef = useRef(false)
  const mountedRef = useRef(true)
  const profileRef = useRef<LeaderboardProfile | null>(null)
  const localPersistenceWarningRef = useRef<string | null>(null)
  const syncStateRef = useRef<LeaderboardLocalSyncState | null>(null)
  const syncInFlightRef = useRef(false)
  const syncQueuedRef = useRef(false)
  const syncDrainRef = useRef<(force?: boolean) => void>(() => undefined)
  const syncRetryTimerRef = useRef<ReturnType<
    typeof globalThis.setTimeout
  > | null>(null)
  const retryNotBeforeRef = useRef(0)
  const syncAutoRetryCountRef = useRef(0)
  const syncAutoRetryFingerprintRef = useRef<string | null>(null)
  const loadAbortRef = useRef<AbortController | null>(null)
  const loadSequenceRef = useRef(0)

  useEffect(() => {
    activeRef.current = active
  }, [active])

  const persistSyncState = useCallback(
    (next: LeaderboardLocalSyncState) => {
      saveLeaderboardSyncState(next, profileStorage)
      syncStateRef.current = next
      if (mountedRef.current) setSelf(next.self)
    },
    [profileStorage],
  )

  const loadPage = useCallback(
    async (targetPage: number) => {
      loadAbortRef.current?.abort()
      const controller = new AbortController()
      loadAbortRef.current = controller
      loadSequenceRef.current += 1
      const sequence = loadSequenceRef.current
      setLoadStatus('loading')
      setLoadError(null)
      // A requested page must never be labelled with rows committed for a
      // different page while the request is loading or after it fails.
      setEntries([])
      try {
        const result = await api.getPage({
          page: targetPage,
          pageSize,
          signal: controller.signal,
        })
        if (!mountedRef.current || sequence !== loadSequenceRef.current) return
        setEntries(result.entries)
        setTotal(result.total)
        pageRef.current = result.page
        setPage(result.page)
        setLoadStatus('ready')
      } catch (error) {
        if (
          !mountedRef.current ||
          sequence !== loadSequenceRef.current ||
          isAbortError(error)
        ) {
          return
        }
        setLoadStatus('error')
        setLoadError(errorMessage(error, '排行榜加载失败，请稍后重试。'))
      }
    },
    [api, pageSize],
  )

  const drainSyncQueue = useCallback(
    (force = false) => {
      if (!force && Date.now() < retryNotBeforeRef.current) return
      const currentProfile = profileRef.current
      const currentState = syncStateRef.current
      const pending = currentState?.pending
      if (!currentProfile || !currentState || !pending) return
      if (syncInFlightRef.current) {
        syncQueuedRef.current = true
        return
      }

      const target = { ...pending }
      const targetFingerprint = pendingFingerprint(target)
      if (syncAutoRetryFingerprintRef.current !== targetFingerprint) {
        if (syncRetryTimerRef.current !== null) {
          globalThis.clearTimeout(syncRetryTimerRef.current)
          syncRetryTimerRef.current = null
        }
        syncAutoRetryFingerprintRef.current = targetFingerprint
        syncAutoRetryCountRef.current = 0
      } else if (force) {
        if (syncRetryTimerRef.current !== null) {
          globalThis.clearTimeout(syncRetryTimerRef.current)
          syncRetryTimerRef.current = null
        }
        syncAutoRetryCountRef.current = 0
      }
      syncInFlightRef.current = true
      syncQueuedRef.current = false
      if (mountedRef.current) {
        setSyncStatus('syncing')
        setSyncError(null)
        setSyncCanRetry(false)
      }

      const submission: LeaderboardProfile = {
        ...currentProfile,
        displayName: target.displayName,
        highestBalance: target.highestBalance,
      }

      void api
        .submit(submission)
        .then((entry) => {
          if (syncRetryTimerRef.current !== null) {
            globalThis.clearTimeout(syncRetryTimerRef.current)
            syncRetryTimerRef.current = null
          }
          retryNotBeforeRef.current = 0
          syncAutoRetryCountRef.current = 0
          syncAutoRetryFingerprintRef.current = null
          const latest = syncStateRef.current
          if (!latest) return
          const stillCurrent = samePendingSubmission(latest.pending, target)
          const next: LeaderboardLocalSyncState = {
            ...latest,
            pending: stillCurrent ? null : latest.pending,
            self: entry,
          }
          persistSyncState(next)
          if (mountedRef.current) {
            setSyncStatus('synced')
            setSyncError(null)
            setSyncCanRetry(false)
            setEntries((currentEntries) =>
              currentEntries.map((currentEntry) =>
                latest.self !== null &&
                currentEntry.displayName === latest.self.displayName &&
                currentEntry.highestBalance === latest.self.highestBalance
                  ? { ...currentEntry, ...entry }
                  : currentEntry,
              ),
            )
          }
          if (activeRef.current) void loadPage(pageRef.current)
        })
        .catch((error: unknown) => {
          if (isAbortError(error)) return
          const retryable = isRetryableLeaderboardError(error)
          if (error instanceof LeaderboardApiError && error.status === 429) {
            retryNotBeforeRef.current =
              Date.now() + Math.max(0, error.retryAfterMs ?? 0)
          }
          const latest = syncStateRef.current
          if (
            !retryable &&
            latest &&
            samePendingSubmission(latest.pending, target)
          ) {
            try {
              persistSyncState({ ...latest, pending: null })
            } catch {
              // Keep the original API error visible. A later initialization
              // can safely inspect the still-persisted outbox again.
            }
          }
          if (mountedRef.current) {
            setSyncStatus('error')
            setSyncCanRetry(retryable)
            setSyncError(
              retryable
                ? errorMessage(
                    error,
                    '成绩仍保存在本机，将在联网或手动刷新时重试。',
                  )
                : errorMessage(error, '成绩未被服务端接受，请检查昵称后重试。'),
            )
          }
          if (
            retryable &&
            error instanceof LeaderboardApiError &&
            error.status >= 500 &&
            syncRetryTimerRef.current === null &&
            syncAutoRetryCountRef.current < 3
          ) {
            const retryDelay = Math.min(
              60_000,
              (error.retryAfterMs ?? 5_000) *
                2 ** syncAutoRetryCountRef.current,
            )
            syncAutoRetryCountRef.current += 1
            syncRetryTimerRef.current = globalThis.setTimeout(() => {
              syncRetryTimerRef.current = null
              syncDrainRef.current(false)
            }, retryDelay)
          }
        })
        .finally(() => {
          syncInFlightRef.current = false
          const latestPending = syncStateRef.current?.pending ?? null
          const hasNewerSubmission =
            latestPending !== null &&
            pendingFingerprint(latestPending) !== targetFingerprint
          const shouldContinue = syncQueuedRef.current || hasNewerSubmission
          syncQueuedRef.current = false
          // A manual retry may bypass the current cooldown once, but it must
          // not carry that bypass into a newer score queued during the request.
          if (shouldContinue) syncDrainRef.current(false)
        })
    },
    [api, loadPage, persistSyncState],
  )
  useEffect(() => {
    syncDrainRef.current = drainSyncQueue
  }, [drainSyncQueue])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadAbortRef.current?.abort()
      if (syncRetryTimerRef.current !== null) {
        globalThis.clearTimeout(syncRetryTimerRef.current)
        syncRetryTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    try {
      const initialBalance = initialLeaderboardBalance(
        initialBalanceRef.current,
      )
      let loadedProfile = getOrCreateLeaderboardProfile({
        storage: profileStorage,
        crypto: profileCrypto,
        initialHighestBalance: initialBalance,
      })
      let loadedSyncState = readLeaderboardSyncState(profileStorage)
      const recoveredHighest = Math.max(
        loadedProfile.highestBalance,
        initialBalance,
        loadedSyncState.pending?.highestBalance ?? 0,
        loadedSyncState.self?.highestBalance ?? 0,
      )
      if (
        recoveredHighest !== loadedProfile.highestBalance ||
        (loadedSyncState.pending !== null &&
          loadedSyncState.pending.displayName !== loadedProfile.displayName)
      ) {
        loadedProfile = {
          ...loadedProfile,
          displayName:
            loadedSyncState.pending?.displayName ?? loadedProfile.displayName,
          highestBalance: recoveredHighest,
        }
        saveLeaderboardProfile(loadedProfile, profileStorage)
      }
      const registrationState = ensureInitialLeaderboardOutbox(
        loadedSyncState,
        loadedProfile,
      )
      if (registrationState !== loadedSyncState) {
        saveLeaderboardSyncState(registrationState, profileStorage)
        loadedSyncState = registrationState
      }
      profileRef.current = loadedProfile
      syncStateRef.current = loadedSyncState
      setProfile(loadedProfile)
      setSelf(loadedSyncState.self)
      setSyncStatus(loadedSyncState.self === null ? 'idle' : 'synced')
      localPersistenceWarningRef.current = null
      setProfileError(null)
      if (loadedSyncState.pending) syncDrainRef.current()
    } catch (error) {
      setProfileError(
        errorMessage(error, '排行榜匿名身份无法初始化，本机牌桌不受影响。'),
      )
    }
  }, [profileCrypto, profileStorage])

  useEffect(() => {
    if (!profile || !scoreEventId) return
    let cancelled = false
    globalThis.queueMicrotask(() => {
      if (cancelled) return
      const currentSyncState = syncStateRef.current
      if (
        !currentSyncState ||
        currentSyncState.lastObservedScoreEventId === scoreEventId
      ) {
        return
      }
      if (!isHalfPointBalance(currentBalance)) {
        setProfileError('当前牌桌余额格式无效，未写入排行榜历史最高。')
        return
      }
      if (
        currentBalance > profile.highestBalance &&
        !isLeaderboardBalance(currentBalance)
      ) {
        setProfileError('当前牌桌余额超过排行榜可接受范围，未写入历史最高。')
        return
      }

      if (currentBalance > profile.highestBalance) {
        const nextProfile = { ...profile, highestBalance: currentBalance }
        const nextSyncState: LeaderboardLocalSyncState = {
          ...currentSyncState,
          lastObservedScoreEventId: scoreEventId,
          pending: pendingSubmissionFor(nextProfile),
        }
        // The independent outbox is written first so a crash between the two
        // local writes cannot lose an unsent new high score.
        try {
          persistSyncState(nextSyncState)
        } catch {
          const warning =
            '新的历史最高仅保留在当前页面，未能写入本机待同步队列；请保持本页开启后重试。'
          profileRef.current = nextProfile
          setProfile(nextProfile)
          localPersistenceWarningRef.current = warning
          setProfileError(warning)
          return
        }

        // Once the outbox is durable, memory must advance before the separate
        // profile write. Otherwise a failed profile write leaves a stale
        // closure able to replace the pending high with a later lower score.
        profileRef.current = nextProfile
        setProfile(nextProfile)
        try {
          saveLeaderboardProfile(nextProfile, profileStorage)
          localPersistenceWarningRef.current = null
          setProfileError(null)
        } catch {
          const warning =
            '新的历史最高已保留在当前页面和本机待同步队列，但排行榜身份记录未能更新；本页会继续尝试上报。'
          localPersistenceWarningRef.current = warning
          setProfileError(warning)
        }
        syncDrainRef.current()
        return
      }

      try {
        persistSyncState({
          ...currentSyncState,
          lastObservedScoreEventId: scoreEventId,
        })
        setProfileError(localPersistenceWarningRef.current)
        if (currentSyncState.pending) syncDrainRef.current()
      } catch (error) {
        setProfileError(
          errorMessage(error, '本局已结算，但排行榜同步状态未能写入本机。'),
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [currentBalance, persistSyncState, profile, profileStorage, scoreEventId])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    globalThis.queueMicrotask(() => {
      if (!cancelled) void loadPage(page)
    })
    return () => {
      cancelled = true
    }
  }, [active, loadPage, page])

  useEffect(() => {
    if (typeof globalThis.addEventListener !== 'function') return
    const retryWhenOnline = () => syncDrainRef.current(false)
    globalThis.addEventListener('online', retryWhenOnline)
    return () => globalThis.removeEventListener('online', retryWhenOnline)
  }, [])

  const saveDisplayName = useCallback(
    (displayName: string): string | null => {
      const currentProfile = profileRef.current
      const currentSyncState = syncStateRef.current
      if (!currentProfile || !currentSyncState) {
        return '排行榜匿名身份尚未准备好。'
      }
      try {
        const nextProfile = {
          ...currentProfile,
          displayName: normalizeDisplayName(displayName),
        }
        const nextSyncState: LeaderboardLocalSyncState = {
          ...currentSyncState,
          pending: pendingSubmissionFor(nextProfile),
        }
        persistSyncState(nextSyncState)
        saveLeaderboardProfile(nextProfile, profileStorage)
        profileRef.current = nextProfile
        setProfile(nextProfile)
        localPersistenceWarningRef.current = null
        setProfileError(null)
        syncDrainRef.current()
        return null
      } catch (error) {
        return errorMessage(error, '昵称未能保存。')
      }
    },
    [persistSyncState, profileStorage],
  )

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const goToPage = useCallback(
    (nextPage: number) => {
      if (!Number.isFinite(nextPage)) return
      const boundedPage = Math.min(
        totalPages,
        Math.max(1, Math.trunc(nextPage)),
      )
      pageRef.current = boundedPage
      setPage(boundedPage)
    },
    [totalPages],
  )

  const retrySync = useCallback(() => {
    syncDrainRef.current(true)
  }, [])

  const refresh = useCallback(() => {
    const currentProfile = profileRef.current
    const currentSyncState = syncStateRef.current
    if (
      currentProfile &&
      currentSyncState &&
      currentSyncState.pending === null &&
      currentSyncState.self !== null
    ) {
      try {
        // Public GET intentionally has no identity, so a no-change POST is the
        // only privacy-preserving way to refresh an off-page global self rank.
        persistSyncState({
          ...currentSyncState,
          pending: pendingSubmissionFor(currentProfile),
        })
      } catch (error) {
        setProfileError(
          errorMessage(error, '无法保存排名刷新请求，本机牌桌不受影响。'),
        )
      }
    }
    syncDrainRef.current(true)
    void loadPage(page)
  }, [loadPage, page, persistSyncState])

  return {
    profile,
    profileError,
    syncStatus,
    syncError,
    syncCanRetry,
    loadStatus,
    loadError,
    entries,
    self,
    total,
    page,
    pageSize,
    totalPages,
    saveDisplayName,
    goToPage,
    refresh,
    retrySync,
  }
}
