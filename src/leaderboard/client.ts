import { isLeaderboardBalance, normalizeDisplayName } from './profile'
import { isLeaderboardAchievedAt, LEADERBOARD_INTEGRITY } from './types'
import type {
  LeaderboardApi,
  LeaderboardEntry,
  LeaderboardPage,
  LeaderboardPageRequest,
  LeaderboardScore,
  LeaderboardSubmissionEntry,
} from './types'

export type LeaderboardFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export interface LeaderboardApiClientOptions {
  endpoint?: string
  fetch?: LeaderboardFetch
}

const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000

export class LeaderboardApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly retryAfterMs?: number

  constructor(
    message: string,
    status = 0,
    code?: string,
    retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'LeaderboardApiError'
    this.status = status
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseScore(value: unknown): LeaderboardScore {
  if (!isRecord(value)) {
    throw new LeaderboardApiError('排行榜返回了无效的玩家记录。')
  }
  const displayName = value.displayName
  const highestBalance = value.highestBalance
  const achievedAt = value.achievedAt
  if (
    typeof displayName !== 'string' ||
    !isLeaderboardBalance(highestBalance) ||
    !isLeaderboardAchievedAt(achievedAt)
  ) {
    throw new LeaderboardApiError('排行榜返回了无效的玩家记录。')
  }
  try {
    if (normalizeDisplayName(displayName) !== displayName) throw new Error()
  } catch {
    throw new LeaderboardApiError('排行榜返回了无效的玩家昵称。')
  }
  return {
    displayName,
    highestBalance,
    achievedAt,
  }
}

function parseSubmissionEntry(value: unknown): LeaderboardSubmissionEntry {
  if (!isRecord(value)) {
    throw new LeaderboardApiError('排行榜返回了无效的玩家记录。')
  }
  const rank = value.rank
  if (!Number.isSafeInteger(rank) || (rank as number) < 1) {
    throw new LeaderboardApiError('排行榜成绩响应缺少有效的全局排名。')
  }
  return {
    ...parseScore(value),
    rank: rank as number,
  }
}

function parseRankedEntry(value: unknown): LeaderboardEntry {
  if (!isRecord(value)) {
    throw new LeaderboardApiError('排行榜返回了无效的排名记录。')
  }
  const rank = value.rank
  if (!Number.isSafeInteger(rank) || (rank as number) < 1) {
    throw new LeaderboardApiError('排行榜返回了无效的排名记录。')
  }
  return {
    ...parseScore(value),
    rank: rank as number,
  }
}

function parsePage(value: unknown): LeaderboardPage {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    throw new LeaderboardApiError('排行榜分页响应格式无效。')
  }
  const { total, page, pageSize } = value
  if (
    !Number.isSafeInteger(total) ||
    (total as number) < 0 ||
    !Number.isSafeInteger(page) ||
    (page as number) < 1 ||
    !Number.isSafeInteger(pageSize) ||
    (pageSize as number) < 1
  ) {
    throw new LeaderboardApiError('排行榜分页信息无效。')
  }
  return {
    entries: value.entries.map(parseRankedEntry),
    total: total as number,
    page: page as number,
    pageSize: pageSize as number,
  }
}

function requireIntegrityMarker(response: Response, body: unknown): void {
  const header = response.headers.get('X-Leaderboard-Integrity')
  const bodyMarker = isRecord(body) ? body.integrity : undefined
  if (header !== LEADERBOARD_INTEGRITY || bodyMarker !== LEADERBOARD_INTEGRITY) {
    throw new LeaderboardApiError('排行榜响应缺少“自报且未验证”的完整性标记。')
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new LeaderboardApiError(
      response.ok ? '排行榜响应不是有效的 JSON。' : '排行榜服务暂时不可用。',
      response.status,
    )
  }
}

async function requireOk(response: Response): Promise<unknown> {
  const body = await readJson(response)
  if (response.ok) return body
  const nestedError = isRecord(body) && isRecord(body.error) ? body.error : null
  const message =
    nestedError && typeof nestedError.message === 'string'
      ? nestedError.message
      : `排行榜请求失败（HTTP ${response.status}）。`
  const code =
    nestedError && typeof nestedError.code === 'string'
      ? nestedError.code
      : undefined
  const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'))
  throw new LeaderboardApiError(message, response.status, code, retryAfterMs)
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(
      MAX_RETRY_AFTER_MS,
      Math.max(1_000, Math.ceil(seconds * 1_000)),
    )
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined
  return Math.min(
    MAX_RETRY_AFTER_MS,
    Math.max(1_000, timestamp - Date.now()),
  )
}

function resolveFetch(fetcher?: LeaderboardFetch): LeaderboardFetch {
  if (fetcher) return fetcher
  if (typeof globalThis.fetch !== 'function') {
    throw new LeaderboardApiError('当前环境不支持排行榜网络请求。')
  }
  return globalThis.fetch.bind(globalThis)
}

function endpointWithPage(
  endpoint: string,
  request: LeaderboardPageRequest,
): string {
  const separator = endpoint.includes('?') ? '&' : '?'
  const query = new URLSearchParams({
    page: String(request.page),
    pageSize: String(request.pageSize),
  })
  return `${endpoint}${separator}${query.toString()}`
}

export function createLeaderboardApiClient(
  options: LeaderboardApiClientOptions = {},
): LeaderboardApi {
  const endpoint = options.endpoint ?? '/api/leaderboard'
  const fetcher = resolveFetch(options.fetch)

  return {
    async getPage(request) {
      if (
        !Number.isSafeInteger(request.page) ||
        request.page < 1 ||
        !Number.isSafeInteger(request.pageSize) ||
        request.pageSize < 1 ||
        request.pageSize > 100
      ) {
        throw new LeaderboardApiError('排行榜页码或每页数量无效。')
      }
      let response: Response
      try {
        response = await fetcher(endpointWithPage(endpoint, request), {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          signal: request.signal,
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        throw new LeaderboardApiError('无法连接排行榜服务，请检查网络后重试。')
      }
      const body = await requireOk(response)
      requireIntegrityMarker(response, body)
      return parsePage(body)
    },

    async submit(profile, signal) {
      let response: Response
      try {
        response = await fetcher(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${profile.token}`,
            'Content-Type': 'application/json',
          },
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
          body: JSON.stringify({
            playerId: profile.playerId,
            displayName: profile.displayName,
            highestBalance: profile.highestBalance,
          }),
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        throw new LeaderboardApiError('成绩尚未同步，请联网后重试。')
      }
      const body = await requireOk(response)
      requireIntegrityMarker(response, body)
      if (!isRecord(body) || body.entry === undefined) {
        throw new LeaderboardApiError('排行榜成绩响应格式无效。')
      }
      return parseSubmissionEntry(body.entry)
    },
  }
}

export function isRetryableLeaderboardError(error: unknown): boolean {
  return (
    error instanceof LeaderboardApiError &&
    (error.status === 0 || error.status === 429 || error.status >= 500)
  )
}

export const leaderboardApi = createLeaderboardApiClient()
