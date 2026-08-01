import { describe, expect, it } from 'vitest'
import {
  LEADERBOARD_PROFILE_STORAGE_KEY,
  getOrCreateLeaderboardProfile,
  initialLeaderboardBalance,
  readLeaderboardProfile,
  updateLeaderboardProfile,
  type LeaderboardCrypto,
  type LeaderboardStorage,
} from './profile'

class MemoryStorage implements LeaderboardStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const deterministicCrypto: LeaderboardCrypto = {
  randomUUID: () => '123e4567-e89b-42d3-a456-426614174000',
  getRandomValues: (bytes) => {
    bytes.forEach((_, index) => {
      bytes[index] = index
    })
    return bytes
  },
}

describe('leaderboard profile', () => {
  it('creates and reuses one anonymous UUID and 32-byte base64url token', () => {
    const storage = new MemoryStorage()
    const created = getOrCreateLeaderboardProfile({
      storage,
      crypto: deterministicCrypto,
      initialHighestBalance: 10_000,
    })

    expect(created.playerId).toBe('123e4567-e89b-42d3-a456-426614174000')
    expect(created.token).toBe(
      'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    )
    expect(created.highestBalance).toBe(10_000)
    expect(created.displayName).toBe('牌友123E')
    expect(getOrCreateLeaderboardProfile({ storage })).toEqual(created)
  })

  it('keeps the historical high when the live table balance falls or resets', () => {
    const storage = new MemoryStorage()
    const created = getOrCreateLeaderboardProfile({
      storage,
      crypto: deterministicCrypto,
      initialHighestBalance: 12_345.5,
    })

    const afterLowerBalance = updateLeaderboardProfile(
      created,
      { highestBalance: 10_000 },
      storage,
    )
    storage.setItem('nine-road-baccarat:table:v2', '{"reset":false}')
    storage.removeItem('nine-road-baccarat:table:v2')

    expect(afterLowerBalance.highestBalance).toBe(12_345.5)
    expect(readLeaderboardProfile(storage)).toEqual(afterLowerBalance)
    expect(storage.getItem(LEADERBOARD_PROFILE_STORAGE_KEY)).not.toBeNull()
  })

  it('validates the nickname and half-point balance precision', () => {
    const storage = new MemoryStorage()
    const created = getOrCreateLeaderboardProfile({
      storage,
      crypto: deterministicCrypto,
    })

    expect(created.highestBalance).toBe(10_000)

    expect(() =>
      updateLeaderboardProfile(created, { displayName: ' A ' }, storage),
    ).toThrow('2–16')
    expect(() =>
      updateLeaderboardProfile(created, { highestBalance: 10_000.25 }, storage),
    ).toThrow('半分精度')

    const updated = updateLeaderboardProfile(
      created,
      { displayName: '  九点  玩家  ', highestBalance: 10_000.5 },
      storage,
    )
    expect(updated.displayName).toBe('九点 玩家')
    expect(updated.highestBalance).toBe(10_000.5)
  })

  it('normalizes nicknames to NFC and rejects invisible format characters', () => {
    const storage = new MemoryStorage()
    const created = getOrCreateLeaderboardProfile({
      storage,
      crypto: deterministicCrypto,
    })

    const normalized = updateLeaderboardProfile(
      created,
      { displayName: 'Cafe\u0301 玩家' },
      storage,
    )
    expect(normalized.displayName).toBe('Café 玩家')
    expect(() =>
      updateLeaderboardProfile(
        normalized,
        { displayName: '玩家\u200B甲' },
        storage,
      ),
    ).toThrow('控制或格式字符')
  })

  it('replaces a locally corrupted non-canonical bearer token', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      LEADERBOARD_PROFILE_STORAGE_KEY,
      JSON.stringify({
        playerId: '123e4567-e89b-42d3-a456-426614174000',
        token: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq',
        displayName: '旧牌友',
        highestBalance: 10_000,
      }),
    )

    const recovered = getOrCreateLeaderboardProfile({
      storage,
      crypto: deterministicCrypto,
    })

    expect(recovered.token).toBe(
      'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    )
  })

  it('uses the 10,000 baseline when the live value is below or above API bounds', () => {
    expect(initialLeaderboardBalance(9_500)).toBe(10_000)
    expect(initialLeaderboardBalance(1_000_000_000.5)).toBe(10_000)
    expect(initialLeaderboardBalance(12_345.5)).toBe(12_345.5)
  })
})
