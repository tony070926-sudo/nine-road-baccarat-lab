const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_JSON_BODY_BYTES = 4_096
const MAX_LEADERBOARD_BALANCE = 1_000_000_000
const MAX_LEADERBOARD_ENTRIES = 100_000
const SUBMISSION_COOLDOWN_MS = 2_000
const NETWORK_REQUEST_WINDOW_MS = 60_000
const NETWORK_REQUEST_LIMIT = 30
const NEW_IDENTITY_WINDOW_MS = 60 * 60_000
const NEW_IDENTITY_LIMIT = 5
// The server owns identity continuity and monotonic storage, but the score is
// still reported by the browser and is not proof of a server-authoritative game.
const LEADERBOARD_INTEGRITY = 'self-reported-unverified'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BASE64URL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const UNSAFE_NAME_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u
const POST_FIELDS = ['displayName', 'highestBalance', 'playerId'] as const

interface LeaderboardEnv extends Env {
  LEADERBOARD_RATE_LIMIT_SECRET: string
}

export interface LeaderboardRequestContext {
  request: Request
  env: LeaderboardEnv
}

interface Pagination {
  page: number
  pageSize: number
  offset: number
}

interface LeaderboardStorageRow {
  displayName: string
  highestBalanceX2: number
  achievedAt: string
}

interface PrivateLeaderboardStorageRow extends LeaderboardStorageRow {
  tokenHash: string
  updatedAt: string
}

interface CountRow {
  total: number
}

interface RankRow {
  rank: number
}

interface RateLimitStorageRow {
  windowStartedAt: number
  requestCount: number
}

interface IdentityLimitStorageRow {
  lastChangedAt: number
}

interface LimitConsumptionResult {
  allowed: boolean
  retryAfterMs: number
}

interface LeaderboardSubmission {
  playerId: string
  displayName: string
  highestBalance: number
}

interface PublicLeaderboardEntry {
  rank: number
  displayName: string
  highestBalance: number
  achievedAt: string
}

interface ValidationSuccess<T> {
  ok: true
  value: T
}

interface ValidationFailure {
  ok: false
  message: string
}

type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Leaderboard-Integrity': LEADERBOARD_INTEGRITY,
  'X-Content-Type-Options': 'nosniff',
} as const

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  })
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
      },
    },
    status,
  )
}

function rateLimitResponse(
  code: string,
  message: string,
  retryAfterMs: number,
): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1_000))
  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
      },
    }),
    {
      status: 429,
      headers: {
        ...JSON_HEADERS,
        'Retry-After': String(retryAfterSeconds),
      },
    },
  )
}

function parsePositiveInteger(
  value: string | null,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number | null {
  if (value === null || value === '') return fallback
  if (!/^[1-9][0-9]*$/.test(value)) return null

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return null
  return parsed
}

function parsePagination(request: Request): ValidationResult<Pagination> {
  const searchParams = new URL(request.url).searchParams
  const page = parsePositiveInteger(searchParams.get('page'), DEFAULT_PAGE)
  const pageSize = parsePositiveInteger(
    searchParams.get('pageSize'),
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  )

  if (page === null || pageSize === null) {
    return {
      ok: false,
      message: `page must be a positive integer and pageSize must be between 1 and ${MAX_PAGE_SIZE}.`,
    }
  }

  const offset = (page - 1) * pageSize
  if (!Number.isSafeInteger(offset)) {
    return {
      ok: false,
      message: 'The requested page is outside the supported range.',
    }
  }

  return { ok: true, value: { page, pageSize, offset } }
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false
  const mediaType = value.split(';', 1)[0].trim().toLowerCase()
  return mediaType === 'application/json' || mediaType.endsWith('+json')
}

async function readRequestBodyWithLimit(request: Request): Promise<string | null> {
  if (request.body === null) return ''

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // The response is still a deterministic 413 if the producer rejects
          // cancellation after the byte limit has already been crossed.
        }
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactPostFields(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort()
  return (
    keys.length === POST_FIELDS.length &&
    keys.every((key, index) => key === POST_FIELDS[index])
  )
}

function parseSubmission(
  value: unknown,
): ValidationResult<LeaderboardSubmission> {
  if (!isRecord(value) || !hasExactPostFields(value)) {
    return {
      ok: false,
      message:
        'Body must contain only playerId, displayName, and highestBalance.',
    }
  }

  const { playerId, displayName, highestBalance } = value
  if (typeof playerId !== 'string' || !UUID_PATTERN.test(playerId)) {
    return { ok: false, message: 'playerId must be a canonical UUID.' }
  }

  if (typeof displayName !== 'string') {
    return { ok: false, message: 'displayName must be a string.' }
  }

  const normalizedName = displayName
    .normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ')
  const nameLength = Array.from(normalizedName).length
  if (
    nameLength < 2 ||
    nameLength > 16 ||
    UNSAFE_NAME_CHARACTER_PATTERN.test(normalizedName)
  ) {
    return {
      ok: false,
      message: 'displayName must contain 2 to 16 visible characters.',
    }
  }

  if (
    typeof highestBalance !== 'number' ||
    highestBalance < 10_000 ||
    highestBalance > MAX_LEADERBOARD_BALANCE ||
    !Number.isSafeInteger(highestBalance * 2)
  ) {
    return {
      ok: false,
      message:
        'highestBalance must be between 10000 and 1000000000 using whole or half-point increments.',
    }
  }

  return {
    ok: true,
    value: {
      playerId: playerId.toLowerCase(),
      displayName: normalizedName,
      highestBalance,
    },
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '')
}

function parseBearerToken(request: Request): Uint8Array | null {
  const authorization = request.headers.get('Authorization')
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)
  if (!match || !BASE64URL_TOKEN_PATTERN.test(match[1])) return null

  try {
    const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/') + '='
    const binary = atob(base64)
    if (binary.length !== 32) return null

    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    )
    return encodeBase64Url(bytes) === match[1] ? bytes : null
  } catch {
    return null
  }
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digestInput = new ArrayBuffer(value.byteLength)
  new Uint8Array(digestInput).set(value)
  const digest = await crypto.subtle.digest('SHA-256', digestInput)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

async function networkFingerprint(
  request: Request,
  configuredSecret: string | undefined,
): Promise<string | null> {
  const address = request.headers.get('CF-Connecting-IP')?.trim()
  if (!address || !/^[0-9a-f:.]{2,64}$/i.test(address)) return null

  const hostname = new URL(request.url).hostname
  const localRequest = hostname === '127.0.0.1' || hostname === 'localhost'
  const secret =
    configuredSecret?.trim() ||
    (localRequest ? 'local-leaderboard-rate-limit-secret-only' : '')
  if (secret.length < 32) return null
  return hmacSha256Hex(secret, address)
}

async function consumeRateLimit(
  database: D1Database,
  networkHash: string,
  bucket: 'new-identities' | 'submissions',
  nowMs: number,
  windowMs: number,
  limit: number,
): Promise<LimitConsumptionResult> {
  const row = await database
    .prepare(
      `INSERT INTO leaderboard_rate_limits (
         network_hash,
         bucket,
         window_started_at,
         request_count,
         updated_at
       ) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(network_hash, bucket) DO UPDATE SET
         window_started_at = CASE
           WHEN excluded.updated_at - leaderboard_rate_limits.window_started_at >= ?
             THEN excluded.window_started_at
           ELSE leaderboard_rate_limits.window_started_at
         END,
         request_count = CASE
           WHEN excluded.updated_at - leaderboard_rate_limits.window_started_at >= ?
             THEN 1
           ELSE leaderboard_rate_limits.request_count + 1
         END,
         updated_at = excluded.updated_at
       WHERE
         excluded.updated_at - leaderboard_rate_limits.window_started_at >= ?
         OR leaderboard_rate_limits.request_count < ?
       RETURNING
         window_started_at AS windowStartedAt,
         request_count AS requestCount`,
    )
    .bind(
      networkHash,
      bucket,
      nowMs,
      nowMs,
      windowMs,
      windowMs,
      windowMs,
      limit,
    )
    .first<RateLimitStorageRow>()

  if (row !== null) {
    if (
      !Number.isSafeInteger(row.windowStartedAt) ||
      !Number.isSafeInteger(row.requestCount) ||
      row.requestCount < 1 ||
      row.requestCount > limit
    ) {
      throw new Error('Invalid rate-limit data returned by D1.')
    }
    return { allowed: true, retryAfterMs: 0 }
  }

  const current = await database
    .prepare(
      `SELECT
         window_started_at AS windowStartedAt,
         request_count AS requestCount
       FROM leaderboard_rate_limits
       WHERE network_hash = ? AND bucket = ?`,
    )
    .bind(networkHash, bucket)
    .first<RateLimitStorageRow>()
  if (
    current === null ||
    !Number.isSafeInteger(current.windowStartedAt) ||
    !Number.isSafeInteger(current.requestCount) ||
    current.requestCount < 1
  ) {
    throw new Error('Invalid rate-limit data returned by D1.')
  }
  const retryAfterMs = Math.min(
    windowMs,
    Math.max(1, current.windowStartedAt + windowMs - nowMs),
  )
  return { allowed: false, retryAfterMs }
}

async function consumeIdentityChangeLimit(
  database: D1Database,
  tokenHash: string,
  nowMs: number,
): Promise<LimitConsumptionResult> {
  const row = await database
    .prepare(
      `INSERT INTO leaderboard_identity_limits (
         token_hash,
         last_changed_at,
         updated_at
       ) VALUES (?, ?, ?)
       ON CONFLICT(token_hash) DO UPDATE SET
         last_changed_at = excluded.last_changed_at,
         updated_at = excluded.updated_at
       WHERE
         excluded.last_changed_at - leaderboard_identity_limits.last_changed_at >= ?
       RETURNING last_changed_at AS lastChangedAt`,
    )
    .bind(tokenHash, nowMs, nowMs, SUBMISSION_COOLDOWN_MS)
    .first<IdentityLimitStorageRow>()

  if (row !== null) {
    if (!Number.isSafeInteger(row.lastChangedAt) || row.lastChangedAt < 0) {
      throw new Error('Invalid identity-limit data returned by D1.')
    }
    return { allowed: true, retryAfterMs: 0 }
  }

  const current = await database
    .prepare(
      `SELECT last_changed_at AS lastChangedAt
       FROM leaderboard_identity_limits
       WHERE token_hash = ?`,
    )
    .bind(tokenHash)
    .first<IdentityLimitStorageRow>()
  if (
    current === null ||
    !Number.isSafeInteger(current.lastChangedAt) ||
    current.lastChangedAt < 0
  ) {
    throw new Error('Invalid identity-limit data returned by D1.')
  }
  return {
    allowed: false,
    retryAfterMs: Math.min(
      SUBMISSION_COOLDOWN_MS,
      Math.max(1, current.lastChangedAt + SUBMISSION_COOLDOWN_MS - nowMs),
    ),
  }
}

async function getGlobalLeaderboardRank(
  database: D1Database,
  playerId: string,
  entry: LeaderboardStorageRow,
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) + 1 AS rank
       FROM leaderboard_entries
       WHERE
         highest_balance_x2 > ?
         OR (
           highest_balance_x2 = ?
           AND (
             achieved_at < ?
             OR (achieved_at = ? AND player_id < ?)
           )
         )`,
    )
    .bind(
      entry.highestBalanceX2,
      entry.highestBalanceX2,
      entry.achievedAt,
      entry.achievedAt,
      playerId,
    )
    .first<RankRow>()

  if (row === null || !Number.isSafeInteger(row.rank) || row.rank < 1) {
    throw new Error('Invalid leaderboard rank returned by D1.')
  }
  return row.rank
}

function validLeaderboardRow(value: LeaderboardStorageRow): boolean {
  return (
    typeof value.displayName === 'string' &&
    typeof value.achievedAt === 'string' &&
    Number.isSafeInteger(value.highestBalanceX2) &&
    value.highestBalanceX2 >= 20_000 &&
    value.highestBalanceX2 <= MAX_LEADERBOARD_BALANCE * 2
  )
}

function validPrivateLeaderboardRow(
  value: PrivateLeaderboardStorageRow,
): boolean {
  return (
    validLeaderboardRow(value) &&
    /^[0-9a-f]{64}$/.test(value.tokenHash) &&
    Number.isFinite(Date.parse(value.updatedAt))
  )
}

function internalErrorResponse(
  error: unknown,
  method: 'GET' | 'POST',
): Response {
  console.error(
    JSON.stringify({
      event: 'leaderboard_request_failed',
      method,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }),
  )
  return errorResponse(
    503,
    'leaderboard_unavailable',
    'The leaderboard service is temporarily unavailable.',
  )
}

function isLeaderboardCapacityError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes('leaderboard capacity reached')
  )
}

export async function onRequestGet(
  context: LeaderboardRequestContext,
): Promise<Response> {
  try {
    const pagination = parsePagination(context.request)
    if (!pagination.ok) {
      return errorResponse(400, 'invalid_pagination', pagination.message)
    }

    const { page, pageSize, offset } = pagination.value
    const [countResult, pageResult] = (await context.env.LEADERBOARD_DB.batch([
      context.env.LEADERBOARD_DB.prepare(
        'SELECT COUNT(*) AS total FROM leaderboard_entries',
      ),
      context.env.LEADERBOARD_DB.prepare(
        `SELECT
           display_name AS displayName,
           highest_balance_x2 AS highestBalanceX2,
           achieved_at AS achievedAt
         FROM leaderboard_entries
         ORDER BY highest_balance_x2 DESC, achieved_at ASC, player_id ASC
         LIMIT ? OFFSET ?`,
      )
        .bind(pageSize, offset)
    ])) as [D1Result<CountRow>, D1Result<LeaderboardStorageRow>]
    const countRow = countResult.results[0]

    if (
      countRow === undefined ||
      !Number.isSafeInteger(countRow.total) ||
      countRow.total < 0 ||
      !pageResult.results.every(validLeaderboardRow)
    ) {
      throw new Error('Invalid leaderboard data returned by D1.')
    }

    const entries: PublicLeaderboardEntry[] = pageResult.results.map(
      (entry, index) => ({
        rank: offset + index + 1,
        displayName: entry.displayName,
        highestBalance: entry.highestBalanceX2 / 2,
        achievedAt: entry.achievedAt,
      }),
    )

    return jsonResponse({
      integrity: LEADERBOARD_INTEGRITY,
      total: countRow.total,
      page,
      pageSize,
      entries,
    })
  } catch (error) {
    return internalErrorResponse(error, 'GET')
  }
}

export async function onRequestPost(
  context: LeaderboardRequestContext,
): Promise<Response> {
  try {
    const nowMs = Date.now()
    const networkHash = await networkFingerprint(
      context.request,
      context.env.LEADERBOARD_RATE_LIMIT_SECRET,
    )
    if (networkHash === null) {
      return errorResponse(
        503,
        'abuse_guard_unavailable',
        'The leaderboard abuse guard is not configured for this request.',
      )
    }
    const requestLimit = await consumeRateLimit(
      context.env.LEADERBOARD_DB,
      networkHash,
      'submissions',
      nowMs,
      NETWORK_REQUEST_WINDOW_MS,
      NETWORK_REQUEST_LIMIT,
    )
    if (!requestLimit.allowed) {
      return rateLimitResponse(
        'network_rate_limited',
        'This network may send at most 30 leaderboard requests per minute.',
        requestLimit.retryAfterMs,
      )
    }

    const tokenBytes = parseBearerToken(context.request)
    if (tokenBytes === null) {
      return errorResponse(
        401,
        'invalid_authorization',
        'Authorization must contain a 32-byte base64url Bearer token.',
      )
    }

    if (!isJsonContentType(context.request.headers.get('Content-Type'))) {
      return errorResponse(
        415,
        'unsupported_media_type',
        'Content-Type must be application/json.',
      )
    }

    const contentLength = context.request.headers.get('Content-Length')
    if (
      contentLength !== null &&
      (!/^[0-9]+$/.test(contentLength) ||
        Number(contentLength) > MAX_JSON_BODY_BYTES)
    ) {
      return errorResponse(
        413,
        'payload_too_large',
        'The JSON body must not exceed 4096 bytes.',
      )
    }

    let body: unknown
    try {
      const rawBody = await readRequestBodyWithLimit(context.request)
      if (rawBody === null) {
        return errorResponse(
          413,
          'payload_too_large',
          'The JSON body must not exceed 4096 bytes.',
        )
      }
      body = JSON.parse(rawBody) as unknown
    } catch {
      return errorResponse(
        400,
        'invalid_json',
        'Request body must be valid JSON.',
      )
    }

    const submission = parseSubmission(body)
    if (!submission.ok) {
      return errorResponse(400, 'invalid_submission', submission.message)
    }

    const tokenHash = await sha256Hex(tokenBytes)
    const now = new Date(nowMs).toISOString()
    const { playerId, displayName, highestBalance } = submission.value
    const highestBalanceX2 = highestBalance * 2
    const existing = await context.env.LEADERBOARD_DB.prepare(
      `SELECT
         display_name AS displayName,
         highest_balance_x2 AS highestBalanceX2,
         achieved_at AS achievedAt,
         token_hash AS tokenHash,
         updated_at AS updatedAt
       FROM leaderboard_entries
       WHERE player_id = ?`,
    )
      .bind(playerId)
      .first<PrivateLeaderboardStorageRow>()

    if (existing !== null) {
      if (!validPrivateLeaderboardRow(existing)) {
        throw new Error('Invalid private leaderboard data returned by D1.')
      }
      if (existing.tokenHash !== tokenHash) {
        return errorResponse(
          403,
          'identity_conflict',
          'The submitted player identity cannot be updated with this token.',
        )
      }

      const submissionChangesEntry =
        displayName !== existing.displayName ||
        highestBalanceX2 > existing.highestBalanceX2
      if (!submissionChangesEntry) {
        const rank = await getGlobalLeaderboardRank(
          context.env.LEADERBOARD_DB,
          playerId,
          existing,
        )
        return jsonResponse({
          integrity: LEADERBOARD_INTEGRITY,
          entry: {
            rank,
            displayName: existing.displayName,
            highestBalance: existing.highestBalanceX2 / 2,
            achievedAt: existing.achievedAt,
          },
        })
      }
    }

    if (existing === null) {
      const countRow = await context.env.LEADERBOARD_DB.prepare(
        'SELECT COUNT(*) AS total FROM leaderboard_entries',
      ).first<CountRow>()
      if (
        countRow === null ||
        !Number.isSafeInteger(countRow.total) ||
        countRow.total < 0
      ) {
        throw new Error('Invalid leaderboard count returned by D1.')
      }
      if (countRow.total >= MAX_LEADERBOARD_ENTRIES) {
        return errorResponse(
          409,
          'leaderboard_capacity_reached',
          'The public simulation leaderboard has reached its entry limit.',
        )
      }
    }

    const identityLimit = await consumeIdentityChangeLimit(
      context.env.LEADERBOARD_DB,
      tokenHash,
      nowMs,
    )
    if (!identityLimit.allowed) {
      return rateLimitResponse(
        'submission_rate_limited',
        'Leaderboard changes may be submitted once every 2 seconds.',
        identityLimit.retryAfterMs,
      )
    }

    if (existing === null) {
      const newIdentityLimit = await consumeRateLimit(
        context.env.LEADERBOARD_DB,
        networkHash,
        'new-identities',
        nowMs,
        NEW_IDENTITY_WINDOW_MS,
        NEW_IDENTITY_LIMIT,
      )
      if (!newIdentityLimit.allowed) {
        return rateLimitResponse(
          'identity_creation_rate_limited',
          'This network may create at most 5 leaderboard identities per hour.',
          newIdentityLimit.retryAfterMs,
        )
      }
    }

    const stored = await context.env.LEADERBOARD_DB.prepare(
      `INSERT INTO leaderboard_entries (
         player_id,
         display_name,
         highest_balance_x2,
         token_hash,
         achieved_at,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET
         display_name = excluded.display_name,
         highest_balance_x2 = CASE
           WHEN excluded.highest_balance_x2 > leaderboard_entries.highest_balance_x2
             THEN excluded.highest_balance_x2
           ELSE leaderboard_entries.highest_balance_x2
         END,
         achieved_at = CASE
           WHEN excluded.highest_balance_x2 > leaderboard_entries.highest_balance_x2
             THEN excluded.achieved_at
           ELSE leaderboard_entries.achieved_at
         END,
         updated_at = excluded.updated_at
       WHERE leaderboard_entries.token_hash = excluded.token_hash
       RETURNING
         display_name AS displayName,
         highest_balance_x2 AS highestBalanceX2,
         achieved_at AS achievedAt`,
    )
      .bind(playerId, displayName, highestBalanceX2, tokenHash, now, now, now)
      .first<LeaderboardStorageRow>()

    if (stored === null) {
      return errorResponse(
        403,
        'identity_conflict',
        'The submitted player identity cannot be updated with this token.',
      )
    }
    if (!validLeaderboardRow(stored)) {
      throw new Error('Invalid leaderboard data returned by D1.')
    }
    const rank = await getGlobalLeaderboardRank(
      context.env.LEADERBOARD_DB,
      playerId,
      stored,
    )

    return jsonResponse({
      integrity: LEADERBOARD_INTEGRITY,
      entry: {
        rank,
        displayName: stored.displayName,
        highestBalance: stored.highestBalanceX2 / 2,
        achievedAt: stored.achievedAt,
      },
    })
  } catch (error) {
    if (isLeaderboardCapacityError(error)) {
      return errorResponse(
        409,
        'leaderboard_capacity_reached',
        'The public simulation leaderboard has reached its entry limit.',
      )
    }
    return internalErrorResponse(error, 'POST')
  }
}
