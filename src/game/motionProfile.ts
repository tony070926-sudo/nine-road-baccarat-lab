export type MotionProfile = 'cinematic' | 'standard' | 'fast'

export type EffectiveMotionProfile = MotionProfile | 'reduced'

export interface MotionProfileStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export interface MotionProfileOption {
  value: MotionProfile
  label: string
  description: string
  durationScale: number
}

export const DEFAULT_MOTION_PROFILE: MotionProfile = 'standard'

export const MOTION_PROFILE_STORAGE_KEY =
  'nine-road-baccarat:motion-profile:v1'

export const MOTION_PROFILE_OPTIONS: ReadonlyArray<MotionProfileOption> = [
  {
    value: 'cinematic',
    label: '电影感',
    description: '完整呈现发牌动作与结果停留',
    durationScale: 1.3,
  },
  {
    value: 'standard',
    label: '标准',
    description: '平衡牌桌氛围与操作效率',
    durationScale: 1,
  },
  {
    value: 'fast',
    label: '快速',
    description: '缩短过渡，适合连续模拟与复盘',
    durationScale: 0.55,
  },
]

const durationScales: Readonly<Record<EffectiveMotionProfile, number>> = {
  cinematic: 1.3,
  standard: 1,
  fast: 0.55,
  reduced: 0,
}

function getBrowserStorage(): MotionProfileStorage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

export function isMotionProfile(value: unknown): value is MotionProfile {
  return value === 'cinematic' || value === 'standard' || value === 'fast'
}

/**
 * Reads the experience preference independently from the durable table state.
 * Invalid, unavailable, or privacy-blocked storage always falls back safely.
 */
export function loadMotionProfile(
  storage: MotionProfileStorage | null = getBrowserStorage(),
): MotionProfile {
  if (!storage) return DEFAULT_MOTION_PROFILE

  try {
    const storedProfile = storage.getItem(MOTION_PROFILE_STORAGE_KEY)
    return isMotionProfile(storedProfile)
      ? storedProfile
      : DEFAULT_MOTION_PROFILE
  } catch {
    return DEFAULT_MOTION_PROFILE
  }
}

/** Returns whether the preference was durably written. */
export function saveMotionProfile(
  profile: MotionProfile,
  storage: MotionProfileStorage | null = getBrowserStorage(),
): boolean {
  if (!storage) return false

  try {
    storage.setItem(MOTION_PROFILE_STORAGE_KEY, profile)
    return true
  } catch {
    return false
  }
}

/**
 * The operating-system accessibility preference wins without overwriting the
 * user's chosen pace, so their selection is restored when reduced motion ends.
 */
export function resolveEffectiveMotionProfile(
  profile: MotionProfile,
  prefersReducedMotion: boolean,
): EffectiveMotionProfile {
  return prefersReducedMotion ? 'reduced' : profile
}

/** Converts a standard-profile duration into the selected effective duration. */
export function motionDuration(
  baseDurationMs: number,
  profile: EffectiveMotionProfile,
): number {
  if (!Number.isFinite(baseDurationMs) || baseDurationMs <= 0) return 0
  return Math.round(baseDurationMs * durationScales[profile])
}
