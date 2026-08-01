import { describe, expect, it } from 'vitest'
import {
  EMPTY_LEADERBOARD_SYNC_STATE,
  LEADERBOARD_SYNC_STORAGE_KEY,
  ensureInitialLeaderboardOutbox,
  readLeaderboardSyncState,
  saveLeaderboardSyncState,
  type LeaderboardLocalSyncState,
} from './syncState'

const baselineProfile = {
  displayName: '九点玩家',
  highestBalance: 10_000,
}

describe('leaderboard local outbox', () => {
  it('loads legacy self records without rank and preserves new global ranks', () => {
    let stored: string | null = JSON.stringify({
      ...EMPTY_LEADERBOARD_SYNC_STATE,
      self: {
        displayName: baselineProfile.displayName,
        highestBalance: baselineProfile.highestBalance,
        achievedAt: '2026-08-01T12:00:00.000Z',
      },
    })
    const storage = {
      getItem(key: string) {
        return key === LEADERBOARD_SYNC_STORAGE_KEY ? stored : null
      },
      setItem(key: string, value: string) {
        if (key === LEADERBOARD_SYNC_STORAGE_KEY) stored = value
      },
    }

    expect(readLeaderboardSyncState(storage).self).toEqual({
      displayName: baselineProfile.displayName,
      highestBalance: baselineProfile.highestBalance,
      achievedAt: '2026-08-01T12:00:00.000Z',
    })

    saveLeaderboardSyncState(
      {
        ...EMPTY_LEADERBOARD_SYNC_STATE,
        self: {
          rank: 17,
          displayName: baselineProfile.displayName,
          highestBalance: baselineProfile.highestBalance,
          achievedAt: '2026-08-01T12:00:00.000Z',
        },
      },
      storage,
    )
    expect(readLeaderboardSyncState(storage).self).toMatchObject({ rank: 17 })

    stored = JSON.stringify({
      ...EMPTY_LEADERBOARD_SYNC_STATE,
      self: {
        rank: 0,
        displayName: baselineProfile.displayName,
        highestBalance: baselineProfile.highestBalance,
        achievedAt: '2026-08-01T12:00:00.000Z',
      },
    })
    expect(readLeaderboardSyncState(storage)).toEqual(
      EMPTY_LEADERBOARD_SYNC_STATE,
    )
  })

  it('queues the baseline for a first-time visitor so a loss does not prevent ranking', () => {
    const next = ensureInitialLeaderboardOutbox(
      { ...EMPTY_LEADERBOARD_SYNC_STATE },
      baselineProfile,
    )

    expect(next.pending).toEqual(baselineProfile)
    expect(next.self).toBeNull()
  })

  it('does not replace an unsent newer score or an equal synced identity', () => {
    const pendingState: LeaderboardLocalSyncState = {
      ...EMPTY_LEADERBOARD_SYNC_STATE,
      pending: { displayName: '新昵称', highestBalance: 12_000.5 },
    }
    expect(ensureInitialLeaderboardOutbox(pendingState, baselineProfile)).toBe(
      pendingState,
    )

    const syncedState: LeaderboardLocalSyncState = {
      ...EMPTY_LEADERBOARD_SYNC_STATE,
      self: {
        displayName: baselineProfile.displayName,
        highestBalance: baselineProfile.highestBalance,
        achievedAt: '2026-08-01T12:00:00.000Z',
      },
    }
    expect(ensureInitialLeaderboardOutbox(syncedState, baselineProfile)).toBe(
      syncedState,
    )
  })

  it('queues a recovered local-history high above the last synced score', () => {
    const syncedState: LeaderboardLocalSyncState = {
      ...EMPTY_LEADERBOARD_SYNC_STATE,
      self: {
        displayName: baselineProfile.displayName,
        highestBalance: 10_000,
        achievedAt: '2026-08-01T12:00:00.000Z',
      },
    }

    expect(
      ensureInitialLeaderboardOutbox(syncedState, {
        ...baselineProfile,
        highestBalance: 15_000.5,
      }).pending,
    ).toEqual({
      displayName: baselineProfile.displayName,
      highestBalance: 15_000.5,
    })
  })
})
