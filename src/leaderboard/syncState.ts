import {
  isLeaderboardBalance,
  normalizeDisplayName,
  type LeaderboardStorage,
} from './profile'
import {
  isLeaderboardAchievedAt,
  type LeaderboardProfile,
  type LeaderboardScore,
} from './types'

export const LEADERBOARD_SYNC_STORAGE_KEY =
  'nine-road-baccarat:leaderboard-sync:v1'

export interface LeaderboardPendingSubmission {
  displayName: string
  highestBalance: number
}

export interface LeaderboardLocalSyncState {
  lastObservedScoreEventId: string | null
  pending: LeaderboardPendingSubmission | null
  self: LeaderboardScore | null
}

export const EMPTY_LEADERBOARD_SYNC_STATE: LeaderboardLocalSyncState = {
  lastObservedScoreEventId: null,
  pending: null,
  self: null,
}

function defaultStorage(storage?: LeaderboardStorage): LeaderboardStorage {
  if (storage) return storage
  if (typeof globalThis.localStorage === 'undefined') {
    throw new Error('当前环境不支持本机排行榜同步队列。')
  }
  return globalThis.localStorage
}

function isScoreEventId(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' && value.length > 0 && value.length <= 200)
  )
}

function isPendingSubmission(
  value: unknown,
): value is LeaderboardPendingSubmission {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LeaderboardPendingSubmission>
  if (
    typeof candidate.displayName !== 'string' ||
    !isLeaderboardBalance(candidate.highestBalance)
  ) {
    return false
  }
  try {
    return normalizeDisplayName(candidate.displayName) === candidate.displayName
  } catch {
    return false
  }
}

function isOwnEntry(value: unknown): value is LeaderboardScore {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LeaderboardScore>
  return (
    typeof candidate.displayName === 'string' &&
    isLeaderboardBalance(candidate.highestBalance) &&
    isLeaderboardAchievedAt(candidate.achievedAt) &&
    (candidate.rank === undefined ||
      (Number.isSafeInteger(candidate.rank) && candidate.rank >= 1))
  )
}

function isSyncState(value: unknown): value is LeaderboardLocalSyncState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LeaderboardLocalSyncState>
  return (
    isScoreEventId(candidate.lastObservedScoreEventId) &&
    (candidate.pending === null || isPendingSubmission(candidate.pending)) &&
    (candidate.self === null || isOwnEntry(candidate.self))
  )
}

export function readLeaderboardSyncState(
  storage?: LeaderboardStorage,
): LeaderboardLocalSyncState {
  let raw: string | null
  try {
    raw = defaultStorage(storage).getItem(LEADERBOARD_SYNC_STORAGE_KEY)
  } catch (error) {
    const detail = error instanceof Error ? `：${error.message}` : ''
    throw new Error(`排行榜同步队列读取失败${detail}`, { cause: error })
  }
  if (!raw) return { ...EMPTY_LEADERBOARD_SYNC_STATE }
  try {
    const parsed: unknown = JSON.parse(raw)
    return isSyncState(parsed)
      ? parsed
      : { ...EMPTY_LEADERBOARD_SYNC_STATE }
  } catch {
    return { ...EMPTY_LEADERBOARD_SYNC_STATE }
  }
}

export function saveLeaderboardSyncState(
  state: LeaderboardLocalSyncState,
  storage?: LeaderboardStorage,
): void {
  if (!isSyncState(state)) {
    throw new Error('排行榜同步队列内容无效，未写入本机。')
  }
  try {
    defaultStorage(storage).setItem(
      LEADERBOARD_SYNC_STORAGE_KEY,
      JSON.stringify(state),
    )
  } catch (error) {
    const detail = error instanceof Error ? `：${error.message}` : ''
    throw new Error(`排行榜同步队列保存失败${detail}`, { cause: error })
  }
}

export function pendingSubmissionFor(
  profile: Pick<LeaderboardProfile, 'displayName' | 'highestBalance'>,
): LeaderboardPendingSubmission {
  return {
    displayName: profile.displayName,
    highestBalance: profile.highestBalance,
  }
}

export function ensureInitialLeaderboardOutbox(
  state: LeaderboardLocalSyncState,
  profile: Pick<LeaderboardProfile, 'displayName' | 'highestBalance'>,
): LeaderboardLocalSyncState {
  if (state.pending !== null) {
    if (state.pending.highestBalance >= profile.highestBalance) return state
    return {
      ...state,
      pending: {
        displayName: state.pending.displayName,
        highestBalance: profile.highestBalance,
      },
    }
  }
  if (
    state.self !== null &&
    state.self.displayName === profile.displayName &&
    state.self.highestBalance >= profile.highestBalance
  ) {
    return state
  }
  return {
    ...state,
    pending: pendingSubmissionFor(profile),
  }
}

export function samePendingSubmission(
  left: LeaderboardPendingSubmission | null,
  right: LeaderboardPendingSubmission | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.displayName === right.displayName &&
      left.highestBalance === right.highestBalance)
  )
}
