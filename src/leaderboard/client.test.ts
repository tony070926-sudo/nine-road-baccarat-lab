import { describe, expect, it, vi } from 'vitest'
import {
  LeaderboardApiError,
  createLeaderboardApiClient,
  type LeaderboardFetch,
} from './client'
import type { LeaderboardProfile } from './types'

const profile: LeaderboardProfile = {
  playerId: '123e4567-e89b-42d3-a456-426614174000',
  token: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  displayName: '九点玩家',
  highestBalance: 12_345.5,
}

function leaderboardResponse(body: Record<string, unknown>): Response {
  return Response.json(
    { integrity: 'self-reported-unverified', ...body },
    { headers: { 'X-Leaderboard-Integrity': 'self-reported-unverified' } },
  )
}

describe('leaderboard API client', () => {
  it('reads a page using only page and pageSize query parameters', async () => {
    const fetcher = vi.fn<LeaderboardFetch>(async () =>
      leaderboardResponse({
        entries: [
          {
            rank: 21,
            displayName: '牌友甲',
            highestBalance: 12_345.5,
            achievedAt: '2026-08-01T12:00:00.000Z',
          },
        ],
        total: 41,
        page: 2,
        pageSize: 20,
      }),
    )
    const api = createLeaderboardApiClient({ fetch: fetcher })

    const page = await api.getPage({ page: 2, pageSize: 20 })

    expect(page.entries[0].highestBalance).toBe(12_345.5)
    expect(fetcher).toHaveBeenCalledWith(
      '/api/leaderboard?page=2&pageSize=20',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
    expect(String(fetcher.mock.calls[0][0])).not.toContain('playerId')
  })

  it('posts the score with a bearer token but never puts the token in JSON', async () => {
    const fetcher = vi.fn<LeaderboardFetch>(async () =>
      leaderboardResponse({
        entry: {
          rank: 7,
          displayName: profile.displayName,
          highestBalance: profile.highestBalance,
          achievedAt: '2026-08-01T12:00:00.000Z',
        },
      }),
    )
    const api = createLeaderboardApiClient({ fetch: fetcher })

    await expect(api.submit(profile)).resolves.toMatchObject({
      rank: 7,
      displayName: profile.displayName,
      achievedAt: '2026-08-01T12:00:00.000Z',
    })

    const init = fetcher.mock.calls[0][1]
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${profile.token}`,
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      playerId: profile.playerId,
      displayName: profile.displayName,
      highestBalance: profile.highestBalance,
    })
    expect(String(init?.body)).not.toContain(profile.token)
    expect(String(init?.body)).not.toContain('scoreEventId')
  })

  it('requires a positive safe global rank in score submission responses', async () => {
    for (const rank of [undefined, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const api = createLeaderboardApiClient({
        fetch: async () =>
          leaderboardResponse({
            entry: {
              ...(rank === undefined ? {} : { rank }),
              displayName: profile.displayName,
              highestBalance: profile.highestBalance,
              achievedAt: '2026-08-01T12:00:00.000Z',
            },
          }),
      })

      await expect(api.submit(profile)).rejects.toThrow('有效的全局排名')
    }
  })

  it('rejects invalid quarter-point balances and exposes retryable statuses', async () => {
    const invalidApi = createLeaderboardApiClient({
      fetch: async () =>
        leaderboardResponse({
          entries: [
            {
              rank: 1,
              displayName: '牌友甲',
              highestBalance: 10_000.25,
              achievedAt: '2026-08-01T12:00:00.000Z',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
    })
    await expect(invalidApi.getPage({ page: 1, pageSize: 20 })).rejects.toBeInstanceOf(
      LeaderboardApiError,
    )
  })

  it('requires the explicit self-reported-unverified integrity marker', async () => {
    const api = createLeaderboardApiClient({
      fetch: async () =>
        Response.json({
          entries: [],
          total: 0,
          page: 1,
          pageSize: 20,
        }),
    })

    await expect(api.getPage({ page: 1, pageSize: 20 })).rejects.toThrow(
      '自报且未验证',
    )
  })

  it('parses nested backend errors and preserves 4xx status and code', async () => {
    const api = createLeaderboardApiClient({
      fetch: async () =>
        Response.json(
          {
            error: {
              code: 'DISPLAY_NAME_INVALID',
              message: '昵称不符合要求。',
            },
          },
          { status: 400 },
        ),
    })

    const error = await api.submit(profile).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(LeaderboardApiError)
    expect(error).toMatchObject({
      status: 400,
      code: 'DISPLAY_NAME_INVALID',
      message: '昵称不符合要求。',
    })
  })

  it('exposes Retry-After for a retryable 429 without dropping the API error', async () => {
    const api = createLeaderboardApiClient({
      fetch: async () =>
        Response.json(
          {
            error: {
              code: 'RATE_LIMITED',
              message: '提交过于频繁。',
            },
          },
          { status: 429, headers: { 'Retry-After': '3' } },
        ),
    })

    const error = await api.submit(profile).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterMs: 3_000,
    })
  })

  it('preserves an hour-long Retry-After instead of truncating it to five minutes', async () => {
    const api = createLeaderboardApiClient({
      fetch: async () =>
        Response.json(
          {
            error: {
              code: 'identity_creation_rate_limited',
              message: '新身份提交过于频繁。',
            },
          },
          { status: 429, headers: { 'Retry-After': '3600' } },
        ),
    })

    const error = await api.submit(profile).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      status: 429,
      code: 'identity_creation_rate_limited',
      retryAfterMs: 3_600_000,
    })
  })
})
