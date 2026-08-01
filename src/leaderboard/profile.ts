import {
  LEADERBOARD_MAX_DISPLAY_NAME_LENGTH,
  LEADERBOARD_MIN_DISPLAY_NAME_LENGTH,
  MAX_LEADERBOARD_BALANCE,
  MIN_LEADERBOARD_BALANCE,
  type LeaderboardProfile,
} from './types'

export const LEADERBOARD_PROFILE_STORAGE_KEY =
  'nine-road-baccarat:leaderboard-profile:v1'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
// A 32-byte unpadded base64url token has 43 characters and two zero padding
// bits, so its final character must be one of these canonical encodings.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const CONTROL_OR_FORMAT_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export interface LeaderboardStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface LeaderboardCrypto {
  randomUUID(): string
  getRandomValues(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>
}

export interface GetLeaderboardProfileOptions {
  storage?: LeaderboardStorage
  crypto?: LeaderboardCrypto
  initialHighestBalance?: number
  displayName?: string
}

function profileErrorMessage(error: unknown, action: string): Error {
  const detail = error instanceof Error ? `：${error.message}` : ''
  return new Error(`排行榜身份${action}失败${detail}`)
}

function resolveStorage(storage?: LeaderboardStorage): LeaderboardStorage {
  if (storage) return storage
  if (typeof globalThis.localStorage === 'undefined') {
    throw new Error('当前环境不支持本机排行榜身份存储。')
  }
  return globalThis.localStorage
}

function resolveCrypto(cryptoSource?: LeaderboardCrypto): LeaderboardCrypto {
  if (cryptoSource) return cryptoSource
  if (
    typeof globalThis.crypto?.randomUUID !== 'function' ||
    typeof globalThis.crypto?.getRandomValues !== 'function'
  ) {
    throw new Error('当前浏览器不支持安全的匿名身份生成。')
  }
  return {
    randomUUID: () => globalThis.crypto.randomUUID(),
    getRandomValues: (bytes) => globalThis.crypto.getRandomValues(bytes),
  }
}

function encodeBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
  let encoded = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    const triple =
      (first << 16) |
      ((second ?? 0) << 8) |
      (third ?? 0)

    encoded += BASE64URL_ALPHABET[(triple >>> 18) & 63]
    encoded += BASE64URL_ALPHABET[(triple >>> 12) & 63]
    if (second !== undefined) {
      encoded += BASE64URL_ALPHABET[(triple >>> 6) & 63]
    }
    if (third !== undefined) {
      encoded += BASE64URL_ALPHABET[triple & 63]
    }
  }
  return encoded
}

export function isHalfPointBalance(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isSafeInteger(value * 2)
  )
}

export function isLeaderboardBalance(value: unknown): value is number {
  return (
    isHalfPointBalance(value) &&
    value >= MIN_LEADERBOARD_BALANCE &&
    value <= MAX_LEADERBOARD_BALANCE
  )
}

export function initialLeaderboardBalance(value: unknown): number {
  return isLeaderboardBalance(value) ? value : MIN_LEADERBOARD_BALANCE
}

export function normalizeDisplayName(value: string): string {
  const canonical = value.normalize('NFC')
  const normalized = canonical.trim().replace(/\s+/gu, ' ')
  if (CONTROL_OR_FORMAT_CHARACTER_PATTERN.test(normalized)) {
    throw new Error('昵称不能包含控制或格式字符。')
  }
  const length = Array.from(normalized).length
  if (
    length < LEADERBOARD_MIN_DISPLAY_NAME_LENGTH ||
    length > LEADERBOARD_MAX_DISPLAY_NAME_LENGTH
  ) {
    throw new Error(
      `昵称需为 ${LEADERBOARD_MIN_DISPLAY_NAME_LENGTH}–${LEADERBOARD_MAX_DISPLAY_NAME_LENGTH} 个字符。`,
    )
  }
  return normalized
}

export function isLeaderboardProfile(value: unknown): value is LeaderboardProfile {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LeaderboardProfile>
  if (
    typeof candidate.playerId !== 'string' ||
    !UUID_PATTERN.test(candidate.playerId) ||
    typeof candidate.token !== 'string' ||
    !TOKEN_PATTERN.test(candidate.token) ||
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

export function readLeaderboardProfile(
  storage?: LeaderboardStorage,
): LeaderboardProfile | null {
  let raw: string | null
  try {
    raw = resolveStorage(storage).getItem(LEADERBOARD_PROFILE_STORAGE_KEY)
  } catch (error) {
    throw profileErrorMessage(error, '读取')
  }
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isLeaderboardProfile(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveLeaderboardProfile(
  profile: LeaderboardProfile,
  storage?: LeaderboardStorage,
): void {
  if (!isLeaderboardProfile(profile)) {
    throw new Error('排行榜身份内容无效，未写入本机。')
  }
  try {
    resolveStorage(storage).setItem(
      LEADERBOARD_PROFILE_STORAGE_KEY,
      JSON.stringify(profile),
    )
  } catch (error) {
    throw profileErrorMessage(error, '保存')
  }
}

export function createLeaderboardProfile(
  options: Omit<GetLeaderboardProfileOptions, 'storage'> = {},
): LeaderboardProfile {
  const cryptoSource = resolveCrypto(options.crypto)
  const playerId = cryptoSource.randomUUID()
  if (!UUID_PATTERN.test(playerId)) {
    throw new Error('浏览器生成的匿名玩家编号无效。')
  }
  const tokenBytes = cryptoSource.getRandomValues(new Uint8Array(32))
  if (tokenBytes.byteLength !== 32) {
    throw new Error('浏览器生成的排行榜凭证长度无效。')
  }
  const requestedHighest = options.initialHighestBalance ?? MIN_LEADERBOARD_BALANCE
  if (!isHalfPointBalance(requestedHighest)) {
    throw new Error('排行榜历史最高余额必须是非负的半分精度数值。')
  }
  const highestBalance = Math.max(MIN_LEADERBOARD_BALANCE, requestedHighest)
  if (!isLeaderboardBalance(highestBalance)) {
    throw new Error('排行榜历史最高余额超过可接受范围。')
  }
  const displayName = normalizeDisplayName(
    options.displayName ?? `牌友${playerId.slice(0, 4).toUpperCase()}`,
  )
  return {
    playerId,
    token: encodeBase64Url(tokenBytes),
    displayName,
    highestBalance,
  }
}

export function getOrCreateLeaderboardProfile(
  options: GetLeaderboardProfileOptions = {},
): LeaderboardProfile {
  const existing = readLeaderboardProfile(options.storage)
  if (existing) return existing
  const created = createLeaderboardProfile({
    crypto: options.crypto,
    initialHighestBalance: options.initialHighestBalance,
    displayName: options.displayName,
  })
  saveLeaderboardProfile(created, options.storage)
  return created
}

export function updateLeaderboardProfile(
  profile: LeaderboardProfile,
  update: { displayName?: string; highestBalance?: number },
  storage?: LeaderboardStorage,
): LeaderboardProfile {
  const displayName =
    update.displayName === undefined
      ? profile.displayName
      : normalizeDisplayName(update.displayName)
  const candidateHighest = update.highestBalance ?? profile.highestBalance
  if (!isLeaderboardBalance(candidateHighest)) {
    throw new Error('排行榜历史最高余额必须是非负的半分精度数值。')
  }
  const next = {
    ...profile,
    displayName,
    highestBalance: Math.max(profile.highestBalance, candidateHighest),
  }
  saveLeaderboardProfile(next, storage)
  return next
}
