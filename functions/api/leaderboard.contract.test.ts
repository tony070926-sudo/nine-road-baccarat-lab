import { describe, expect, it, vi } from 'vitest'
import {
  LeaderboardApiError,
  createLeaderboardApiClient,
  type LeaderboardFetch,
} from '../../src/leaderboard/client'
import type { LeaderboardProfile } from '../../src/leaderboard/types'
import { onRequestGet, onRequestPost } from './leaderboard'

const profile: LeaderboardProfile = {
  playerId: '123e4567-e89b-42d3-a456-426614174000',
  token: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  displayName: '九点玩家',
  highestBalance: 10_009.5,
}

const RATE_LIMIT_SECRET = 'contract-test-rate-limit-secret-32-bytes'
const TEST_NETWORK_ADDRESS = '203.0.113.10'

interface StoredPrivateRow {
  displayName: string
  highestBalanceX2: number
  achievedAt: string
  tokenHash: string
  updatedAt: string
}

interface PostDatabaseOptions {
  reportedTotal?: number
  initialRateCounts?: Partial<Record<'new-identities' | 'submissions', number>>
  initialRateAgeMs?: Partial<Record<'new-identities' | 'submissions', number>>
  seededEntries?: Array<StoredPrivateRow & { playerId: string }>
  acceptedRateCounts?: Partial<Record<'new-identities' | 'submissions', number>>
  capacityRace?: boolean
  fail?: boolean
}

function postDatabase(options: PostDatabaseOptions = {}): D1Database {
  const stored = new Map<string, StoredPrivateRow>(
    options.seededEntries?.map(({ playerId, ...row }) => [playerId, row]) ?? [],
  )
  const rateLimits = new Map<
    string,
    { windowStartedAt: number; requestCount: number }
  >()
  const identityLimits = new Map<string, number>()

  return {
    prepare(sql: string) {
      if (options.fail) throw new Error('D1 unavailable')
      let values: unknown[] = []
      const statement = {
        bind(...nextValues: unknown[]) {
          values = nextValues
          return statement
        },
        async first() {
          if (sql.includes('leaderboard_identity_limits')) {
            const tokenHash = String(values[0])
            if (sql.trimStart().startsWith('SELECT')) {
              const previous = identityLimits.get(tokenHash)
              return previous === undefined ? null : { lastChangedAt: previous }
            }
            const nowMs = Number(values[1])
            const cooldownMs = Number(values[3])
            const previous = identityLimits.get(tokenHash)
            if (previous !== undefined && nowMs - previous < cooldownMs) {
              return null
            }
            identityLimits.set(tokenHash, nowMs)
            return { lastChangedAt: nowMs }
          }
          if (sql.includes('leaderboard_rate_limits')) {
            const networkHash = String(values[0])
            const bucket = String(values[1]) as 'new-identities' | 'submissions'
            const key = `${networkHash}:${bucket}`
            if (sql.trimStart().startsWith('SELECT')) {
              return rateLimits.get(key) ?? null
            }
            const nowMs = Number(values[2])
            const windowMs = Number(values[4])
            const limit = Number(values[7])
            let current = rateLimits.get(key)
            if (!current) {
              current = {
                windowStartedAt:
                  nowMs - (options.initialRateAgeMs?.[bucket] ?? 0),
                requestCount: options.initialRateCounts?.[bucket] ?? 0,
              }
            }
            if (nowMs - current.windowStartedAt >= windowMs) {
              current = { windowStartedAt: nowMs, requestCount: 1 }
            } else if (current.requestCount >= limit) {
              rateLimits.set(key, current)
              return null
            } else {
              current = {
                ...current,
                requestCount: current.requestCount + 1,
              }
            }
            rateLimits.set(key, current)
            if (options.acceptedRateCounts) {
              options.acceptedRateCounts[bucket] =
                (options.acceptedRateCounts[bucket] ?? 0) + 1
            }
            return current
          }
          if (sql.includes('COUNT(*) + 1 AS rank')) {
            expect(sql).toContain('highest_balance_x2 > ?')
            expect(sql).toContain('achieved_at < ?')
            expect(sql).toContain('achieved_at = ? AND player_id < ?')
            const targetPlayerId = String(values[4])
            const ordered = Array.from(stored.entries()).sort(
              ([leftId, left], [rightId, right]) => {
                if (left.highestBalanceX2 !== right.highestBalanceX2) {
                  return right.highestBalanceX2 - left.highestBalanceX2
                }
                if (left.achievedAt !== right.achievedAt) {
                  return left.achievedAt < right.achievedAt ? -1 : 1
                }
                return leftId < rightId ? -1 : leftId === rightId ? 0 : 1
              },
            )
            const index = ordered.findIndex(([playerId]) => playerId === targetPlayerId)
            return index < 0 ? null : { rank: index + 1 }
          }
          if (sql.includes('SELECT COUNT(*)')) {
            return { total: options.reportedTotal ?? stored.size }
          }
          if (sql.includes('FROM leaderboard_entries')) {
            return stored.get(String(values[0])) ?? null
          }
          expect(sql).toContain('INSERT INTO leaderboard_entries')
          if (options.capacityRace) {
            throw new Error('D1_ERROR: leaderboard capacity reached')
          }
          const playerId = String(values[0])
          const previous = stored.get(playerId)
          const submittedBalanceX2 = Number(values[2])
          const isNewHigh =
            previous === undefined ||
            submittedBalanceX2 > previous.highestBalanceX2
          const next: StoredPrivateRow = {
            displayName: String(values[1]),
            highestBalanceX2: Math.max(
              previous?.highestBalanceX2 ?? submittedBalanceX2,
              submittedBalanceX2,
            ),
            tokenHash: String(values[3]),
            achievedAt: isNewHigh
              ? String(values[4])
              : (previous?.achievedAt ?? String(values[4])),
            updatedAt: String(values[6]),
          }
          stored.set(playerId, next)
          return next
        },
      }
      return statement
    },
  } as unknown as D1Database
}

function handlerFetch(
  database = postDatabase(),
  networkAddress = TEST_NETWORK_ADDRESS,
): LeaderboardFetch {
  return async (input, init) => {
    const url = new URL(String(input), 'https://baccarat.example')
    const headers = new Headers(init?.headers)
    headers.set('CF-Connecting-IP', networkAddress)
    return onRequestPost({
      request: new Request(url, { ...init, headers }),
      env: {
        LEADERBOARD_DB: database,
        LEADERBOARD_RATE_LIMIT_SECRET: RATE_LIMIT_SECRET,
      },
    })
  }
}

function numberedProfile(index: number): LeaderboardProfile {
  const bytes = new Uint8Array(32)
  bytes[30] = Math.floor(index / 256)
  bytes[31] = index % 256
  return {
    ...profile,
    playerId: `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`,
    token: Buffer.from(bytes).toString('base64url'),
    displayName: `牌友${index}`,
    highestBalance: 10_000,
  }
}

function seededEntry(
  playerId: string,
  highestBalanceX2: number,
  achievedAt: string,
): StoredPrivateRow & { playerId: string } {
  return {
    playerId,
    displayName: `种子${playerId.slice(-2)}`,
    highestBalanceX2,
    achievedAt,
    tokenHash: '0'.repeat(64),
    updatedAt: achievedAt,
  }
}

function getDatabase(): D1Database {
  return {
    prepare(sql: string) {
      if (sql.includes('COUNT(*)')) {
        expect(sql).toContain('SELECT COUNT(*) AS total')
        return {} as D1PreparedStatement
      }
      expect(sql).toContain(
        'ORDER BY highest_balance_x2 DESC, achieved_at ASC, player_id ASC',
      )
      const statement = {
        bind(pageSize: number, offset: number) {
          expect(pageSize).toBe(20)
          expect(offset).toBe(0)
          return statement
        },
      }
      return statement
    },
    async batch(statements: D1PreparedStatement[]) {
      expect(statements).toHaveLength(2)
      return [
        { results: [{ total: 2 }] },
        {
          results: [
            {
              displayName: '半分牌友',
              highestBalanceX2: 20_019,
              achievedAt: '2026-08-01T12:00:00.000Z',
            },
            {
              displayName: '起始牌友',
              highestBalanceX2: 20_000,
              achievedAt: '2026-08-01T12:01:00.000Z',
            },
          ],
        },
      ]
    },
  } as unknown as D1Database
}

describe('leaderboard client and Pages Function contract', () => {
  it('returns stable paginated ranks without exposing durable identities', async () => {
    const response = await onRequestGet({
      request: new Request('https://baccarat.example/api/leaderboard'),
      env: { LEADERBOARD_DB: getDatabase() },
    })
    const text = await response.text()
    const body = JSON.parse(text) as {
      entries: Array<{ rank: number; highestBalance: number }>
    }

    expect(response.status).toBe(200)
    expect(body.entries).toEqual([
      expect.objectContaining({ rank: 1, highestBalance: 10_009.5 }),
      expect.objectContaining({ rank: 2, highestBalance: 10_000 }),
    ])
    expect(text).not.toContain('playerId')
    expect(text).not.toContain('token')
    expect(text).not.toContain('tokenHash')
    expect(Object.keys((JSON.parse(text) as { entries: object[] }).entries[0]).sort()).toEqual(
      ['achievedAt', 'displayName', 'highestBalance', 'rank'],
    )
  })

  it('returns a retryable service error when D1 is unavailable', async () => {
    const response = await onRequestGet({
      request: new Request('https://baccarat.example/api/leaderboard'),
      env: {
        LEADERBOARD_DB: {
          prepare() {
            throw new Error('no such table')
          },
        } as unknown as D1Database,
      },
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'leaderboard_unavailable' },
    })
  })

  it('labels API responses as self-reported and unverified', async () => {
    const response = await handlerFetch()('/api/leaderboard', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        playerId: profile.playerId,
        displayName: profile.displayName,
        highestBalance: profile.highestBalance,
      }),
    })

    expect(response.headers.get('X-Leaderboard-Integrity')).toBe(
      'self-reported-unverified',
    )
    await expect(response.json()).resolves.toMatchObject({
      integrity: 'self-reported-unverified',
    })
  })

  it('returns a validated global rank with the POST score response', async () => {
    const api = createLeaderboardApiClient({ fetch: handlerFetch() })

    await expect(api.submit(profile)).resolves.toMatchObject({
      rank: 1,
      displayName: profile.displayName,
      highestBalance: 10_009.5,
      achievedAt: expect.any(String),
    })
  })

  it('computes POST rank with the same stable ordering as GET', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'))
    try {
      const database = postDatabase({
        seededEntries: [
          seededEntry(
            '123e4567-e89b-42d3-a456-426614174100',
            20_020,
            '2026-08-01T12:01:00.000Z',
          ),
          seededEntry(
            '123e4567-e89b-42d3-a456-426614174200',
            20_019,
            '2026-08-01T11:59:59.000Z',
          ),
          seededEntry(
            '123e4567-e89b-42d3-a456-426614173999',
            20_019,
            '2026-08-01T12:00:00.000Z',
          ),
          seededEntry(
            '123e4567-e89b-42d3-a456-426614174300',
            20_018,
            '2026-08-01T11:00:00.000Z',
          ),
        ],
      })
      const api = createLeaderboardApiClient({ fetch: handlerFetch(database) })

      await expect(api.submit(profile)).resolves.toMatchObject({ rank: 4 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads nested API errors from 4xx responses', async () => {
    const api = createLeaderboardApiClient({ fetch: handlerFetch() })
    const error = await api
      .submit({ ...profile, token: 'not-a-valid-token' })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(LeaderboardApiError)
    expect(error).toMatchObject({
      status: 401,
      code: 'invalid_authorization',
    })
    expect((error as Error).message).toContain('32-byte base64url Bearer token')
  })

  it('preserves the nested validation error for quarter-point scores', async () => {
    const api = createLeaderboardApiClient({ fetch: handlerFetch() })
    const error = await api
      .submit({ ...profile, highestBalance: 10_000.25 })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(LeaderboardApiError)
    expect(error).toMatchObject({ status: 400, code: 'invalid_submission' })
  })

  it('rejects abnormal scores above the public simulation cap', async () => {
    const api = createLeaderboardApiClient({ fetch: handlerFetch() })
    const error = await api
      .submit({ ...profile, highestBalance: 1_000_000_000.5 })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(LeaderboardApiError)
    expect(error).toMatchObject({ status: 400, code: 'invalid_submission' })
  })

  it('rate limits rapid changes to the same anonymous identity', async () => {
    const database = postDatabase()
    const api = createLeaderboardApiClient({ fetch: handlerFetch(database) })
    await api.submit(profile)

    const error = await api
      .submit({ ...profile, displayName: '九点玩家二' })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(LeaderboardApiError)
    expect(error).toMatchObject({
      status: 429,
      code: 'submission_rate_limited',
      retryAfterMs: 2_000,
    })
  })

  it('does not let a lower self-reported score reduce the stored high', async () => {
    const acceptedRateCounts: PostDatabaseOptions['acceptedRateCounts'] = {}
    const database = postDatabase({ acceptedRateCounts })
    const api = createLeaderboardApiClient({ fetch: handlerFetch(database) })
    await api.submit(profile)

    await expect(
      api.submit({ ...profile, highestBalance: 10_000 }),
    ).resolves.toMatchObject({ highestBalance: profile.highestBalance })
    expect(acceptedRateCounts.submissions).toBe(2)
  })

  it('rejects another token claiming an existing anonymous identity', async () => {
    const acceptedRateCounts: PostDatabaseOptions['acceptedRateCounts'] = {}
    const database = postDatabase({ acceptedRateCounts })
    const api = createLeaderboardApiClient({ fetch: handlerFetch(database) })
    await api.submit(profile)

    const error = await api
      .submit({ ...profile, token: numberedProfile(9).token })
      .catch((reason: unknown) => reason)
    expect(error).toMatchObject({ status: 403, code: 'identity_conflict' })
    expect(acceptedRateCounts.submissions).toBe(2)
  })

  it('limits creation of rotating identities on the same network', async () => {
    const database = postDatabase()
    const api = createLeaderboardApiClient({ fetch: handlerFetch(database) })
    for (let index = 1; index <= 5; index += 1) {
      await api.submit(numberedProfile(index))
    }

    const error = await api
      .submit(numberedProfile(6))
      .catch((reason: unknown) => reason)
    expect(error).toMatchObject({
      status: 429,
      code: 'identity_creation_rate_limited',
      retryAfterMs: 3_600_000,
    })
  })

  it('limits all POST requests from one network and returns the remaining window', async () => {
    const database = postDatabase({
      initialRateCounts: { submissions: 30 },
      initialRateAgeMs: { submissions: 45_000 },
    })
    const api = createLeaderboardApiClient({ fetch: handlerFetch(database) })

    const error = await api
      .submit(numberedProfile(1))
      .catch((reason: unknown) => reason)
    expect(error).toMatchObject({
      status: 429,
      code: 'network_rate_limited',
      retryAfterMs: 15_000,
    })
  })

  it('charges a concurrent first identity only once against the hourly identity quota', async () => {
    const acceptedRateCounts: PostDatabaseOptions['acceptedRateCounts'] = {}
    const database = postDatabase({ acceptedRateCounts })
    const api = createLeaderboardApiClient({ fetch: handlerFetch(database) })

    const results = await Promise.allSettled([api.submit(profile), api.submit(profile)])

    expect(results.some((result) => result.status === 'fulfilled')).toBe(true)
    expect(acceptedRateCounts['new-identities']).toBe(1)
    expect(acceptedRateCounts.submissions).toBe(2)
  })

  it('cancels an unbounded request stream as soon as it reaches 4097 bytes', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4_096))
        controller.enqueue(new Uint8Array(1))
      },
      cancel() {
        cancelled = true
      },
    })
    const request = new Request('https://baccarat.example/api/leaderboard', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.token}`,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': TEST_NETWORK_ADDRESS,
      },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    expect(request.headers.get('Content-Length')).toBeNull()

    const response = await onRequestPost({
      request,
      env: {
        LEADERBOARD_DB: postDatabase(),
        LEADERBOARD_RATE_LIMIT_SECRET: RATE_LIMIT_SECRET,
      },
    })

    expect(response.status).toBe(413)
    expect(cancelled).toBe(true)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'payload_too_large' },
    })
  })

  it('caps total public entries before accepting a new identity', async () => {
    const database = postDatabase({ reportedTotal: 100_000 })
    const api = createLeaderboardApiClient({ fetch: handlerFetch(database) })

    const error = await api.submit(profile).catch((reason: unknown) => reason)
    expect(error).toMatchObject({
      status: 409,
      code: 'leaderboard_capacity_reached',
    })
  })

  it('maps a concurrent database capacity trigger to the same nested 409', async () => {
    const database = postDatabase({ capacityRace: true })
    const api = createLeaderboardApiClient({ fetch: handlerFetch(database) })

    const error = await api.submit(profile).catch((reason: unknown) => reason)
    expect(error).toMatchObject({
      status: 409,
      code: 'leaderboard_capacity_reached',
    })
  })

  it('returns a retryable nested 503 when POST storage is unavailable', async () => {
    const api = createLeaderboardApiClient({
      fetch: handlerFetch(postDatabase({ fail: true })),
    })

    const error = await api.submit(profile).catch((reason: unknown) => reason)
    expect(error).toMatchObject({
      status: 503,
      code: 'leaderboard_unavailable',
    })
  })
})
