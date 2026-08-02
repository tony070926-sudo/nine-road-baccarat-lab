import { useEffect, useEffectEvent } from 'react'
import { tableLeaseIsSupported } from '../game/tableLease'
import type { TableCoordinator } from '../game/tableCoordinator'
import type { PersistedTableEnvelopeV2 } from '../game/tableState'
import type { PersistedGameState } from '../types'
import { TableLeaseArbiter } from './tableLeaseArbiter'

type TableRestoreCoordinator = Pick<
  TableCoordinator,
  'start' | 'subscribe' | 'read' | 'bootstrap' | 'dispose'
>

export interface TableRestoreUiUpdate {
  storageReady?: boolean
  error?: string | null
  notice?: string | null
  announcement?: string
}

export interface TableRestoreLoopRuntimeInput {
  initialGame: PersistedGameState
  tableCoordinator: TableRestoreCoordinator
  tableLease: TableLeaseArbiter
  applySnapshot: (
    snapshot: PersistedTableEnvelopeV2,
    ownsLease: boolean,
  ) => void
  cancelProcedure: () => void
  releaseLease: () => void
  updateUi: (update: TableRestoreUiUpdate) => void
  leaseSupported?: () => boolean
  setTimer?: (callback: () => void, delay: number) => number
  clearTimer?: (handle: number) => void
}

/** Starts one imperative recovery lifetime and returns its complete cleanup. */
export function startTableRestoreLoop(
  input: TableRestoreLoopRuntimeInput,
): () => void {
  const leaseSupported = input.leaseSupported ?? tableLeaseIsSupported
  const setTimer =
    input.setTimer ?? ((callback, delay) => window.setTimeout(callback, delay))
  const clearTimer =
    input.clearTimer ?? ((handle) => window.clearTimeout(handle))
  let stopped = false
  let generation = 0
  let retryTimer: number | null = null
  let retryRequested = false
  let restoreInFlight: Promise<void> | null = null

  const clearRetry = () => {
    if (retryTimer !== null) clearTimer(retryTimer)
    retryTimer = null
    retryRequested = false
  }

  const armRetry = () => {
    if (
      stopped ||
      !retryRequested ||
      restoreInFlight !== null ||
      retryTimer !== null
    )
      return
    retryTimer = setTimer(() => {
      retryTimer = null
      if (!retryRequested) return
      retryRequested = false
      void restoreOrBootstrap()
    }, 900)
  }

  const scheduleRetry = () => {
    if (stopped || !leaseSupported()) return
    retryRequested = true
    armRetry()
  }

  const runRestore = async (attemptGeneration: number) => {
    const leaseResult = await input.tableLease.acquire('restore')
    if (stopped || attemptGeneration !== generation) {
      if (leaseResult === 'acquired') input.tableLease.release('restore')
      return
    }

    if (leaseResult === 'busy') {
      scheduleRetry()
      return
    }

    if (leaseResult === 'unavailable') {
      if (input.tableLease.isBusy()) {
        scheduleRetry()
        return
      }
      const canonical = input.tableCoordinator.read()
      if (canonical.status === 'ok') {
        input.applySnapshot(canonical.snapshot, false)
        input.updateUi({ storageReady: true })
      } else if (
        canonical.status === 'corrupt' ||
        canonical.status === 'unavailable'
      ) {
        input.updateUi({
          storageReady: false,
          error:
            canonical.status === 'corrupt'
              ? '牌桌单一存储快照已损坏；为保护牌靴与余额，所有操作已停止。'
              : '浏览器无法读取牌桌存储；为避免重复抽牌，所有操作已停止。',
        })
      }
      if (leaseSupported()) scheduleRetry()
      else
        input.updateUi({
          error: '此浏览器缺少 Web Locks，无法安全恢复或开始牌局。',
        })
      return
    }

    if (!input.tableLease.owns('restore')) {
      scheduleRetry()
      return
    }
    clearRetry()
    const bootstrap = input.tableCoordinator.bootstrap(() => input.initialGame)
    if (bootstrap.status !== 'ready') {
      input.updateUi({
        storageReady: false,
        error:
          bootstrap.status === 'corrupt'
            ? '牌桌存储记录已损坏；未迁移、未覆盖，所有写入已停止。'
            : '浏览器未能建立可校验的牌桌快照；所有写入已停止。',
      })
      input.releaseLease()
      return
    }

    input.applySnapshot(bootstrap.snapshot, true)
    input.updateUi({ storageReady: true })
    if (bootstrap.warning) {
      input.updateUi({
        notice: '旧版未完成牌局无法安全恢复，已保留余额、牌靴与历史记录。',
      })
    }
    if (
      !bootstrap.snapshot.pending &&
      !bootstrap.snapshot.presentationPending
    ) {
      input.updateUi({ announcement: '请先选择下注对象与筹码，然后确认开牌。' })
      input.releaseLease()
    }
  }

  const restoreOrBootstrap = (): Promise<void> => {
    if (stopped || input.tableLease.owns('restore')) return Promise.resolve()
    if (restoreInFlight) return restoreInFlight
    const attemptGeneration = ++generation
    const attempt = runRestore(attemptGeneration)
    restoreInFlight = attempt
    const finish = () => {
      if (restoreInFlight === attempt) restoreInFlight = null
      armRetry()
    }
    void attempt.then(finish, finish)
    return attempt
  }

  input.tableCoordinator.start()
  const unsubscribe = input.tableCoordinator.subscribe((snapshot) => {
    if (stopped) return
    generation += 1
    clearRetry()
    input.cancelProcedure()
    input.releaseLease()
    input.applySnapshot(snapshot, false)
    input.updateUi({ storageReady: true })
    if (
      (snapshot.pending || snapshot.presentationPending) &&
      leaseSupported()
    )
      scheduleRetry()
  })
  void restoreOrBootstrap()

  return () => {
    stopped = true
    generation += 1
    clearRetry()
    unsubscribe()
    input.tableCoordinator.dispose()
    input.cancelProcedure()
    input.releaseLease()
  }
}

interface UseTableRestoreLoopInput extends Omit<
  TableRestoreLoopRuntimeInput,
  'updateUi' | 'leaseSupported' | 'setTimer' | 'clearTimer'
> {
  setStorageReady: (ready: boolean) => void
  setFormError: (message: string | null) => void
  setNotice: (message: string | null) => void
  setRevealAnnouncement: (message: string) => void
}

/** Owns the single-flight recovery loop; round procedure state remains in App. */
export function useTableRestoreLoop(input: UseTableRestoreLoopInput): void {
  const { initialGame, tableCoordinator, tableLease } = input
  const applySnapshot = useEffectEvent(input.applySnapshot)
  const cancelProcedure = useEffectEvent(input.cancelProcedure)
  const releaseLease = useEffectEvent(input.releaseLease)
  const updateUi = useEffectEvent((update: TableRestoreUiUpdate) => {
    if (update.storageReady !== undefined)
      input.setStorageReady(update.storageReady)
    if (update.error !== undefined) input.setFormError(update.error)
    if (update.notice !== undefined) input.setNotice(update.notice)
    if (update.announcement !== undefined)
      input.setRevealAnnouncement(update.announcement)
  })

  useEffect(
    () =>
      startTableRestoreLoop({
        initialGame,
        tableCoordinator,
        tableLease,
        applySnapshot: (snapshot, ownsLease) =>
          applySnapshot(snapshot, ownsLease),
        cancelProcedure: () => cancelProcedure(),
        releaseLease: () => releaseLease(),
        updateUi: (update) => updateUi(update),
      }),
    [initialGame, tableCoordinator, tableLease],
  )
}
