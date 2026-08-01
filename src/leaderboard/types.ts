export const LEADERBOARD_MIN_DISPLAY_NAME_LENGTH = 2
export const LEADERBOARD_MAX_DISPLAY_NAME_LENGTH = 16
export const DEFAULT_LEADERBOARD_PAGE_SIZE = 20
export const MIN_LEADERBOARD_BALANCE = 10_000
export const MAX_LEADERBOARD_BALANCE = 1_000_000_000
export const LEADERBOARD_INTEGRITY = 'self-reported-unverified'

export interface LeaderboardProfile {
  playerId: string
  token: string
  displayName: string
  highestBalance: number
}

/**
 * Public leaderboard rows deliberately omit playerId. The client may compare
 * a locally saved submission summary to a row, but never exposes the durable
 * anonymous identifier to other players.
 */
export interface LeaderboardScore {
  displayName: string
  highestBalance: number
  achievedAt: string
  /**
   * Older locally persisted self summaries predate global POST ranks. New
   * server responses always include this value, while legacy summaries remain
   * readable until the next successful synchronization refreshes them.
   */
  rank?: number
}

export interface LeaderboardEntry extends LeaderboardScore {
  rank: number
}

export type LeaderboardSubmissionEntry = LeaderboardEntry

export interface LeaderboardPage {
  entries: LeaderboardEntry[]
  total: number
  page: number
  pageSize: number
}

export interface LeaderboardPageRequest {
  page: number
  pageSize: number
  signal?: AbortSignal
}

export interface LeaderboardApi {
  getPage(request: LeaderboardPageRequest): Promise<LeaderboardPage>
  submit(
    profile: LeaderboardProfile,
    signal?: AbortSignal,
  ): Promise<LeaderboardSubmissionEntry>
}

const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

export function isLeaderboardAchievedAt(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO_INSTANT_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

export type LeaderboardSyncStatus =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'error'

export type LeaderboardLoadStatus = 'idle' | 'loading' | 'ready' | 'error'
