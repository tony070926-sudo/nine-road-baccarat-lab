import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MOTION_PROFILE,
  MOTION_PROFILE_STORAGE_KEY,
  isMotionProfile,
  loadMotionProfile,
  motionDuration,
  resolveEffectiveMotionProfile,
  saveMotionProfile,
  type MotionProfileStorage,
} from './motionProfile'

function createStorage(initialValue: string | null = null) {
  let value = initialValue
  const storage: MotionProfileStorage = {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key, nextValue) => {
      value = nextValue
    }),
  }

  return storage
}

describe('motionProfile', () => {
  it('recognises only the three supported pace profiles', () => {
    expect(isMotionProfile('cinematic')).toBe(true)
    expect(isMotionProfile('standard')).toBe(true)
    expect(isMotionProfile('fast')).toBe(true)
    expect(isMotionProfile('reduced')).toBe(false)
    expect(isMotionProfile('turbo')).toBe(false)
  })

  it('loads a stored profile and falls back for missing or invalid values', () => {
    expect(loadMotionProfile(createStorage('cinematic'))).toBe('cinematic')
    expect(loadMotionProfile(createStorage('fast'))).toBe('fast')
    expect(loadMotionProfile(createStorage('turbo'))).toBe(
      DEFAULT_MOTION_PROFILE,
    )
    expect(loadMotionProfile(createStorage())).toBe(DEFAULT_MOTION_PROFILE)
  })

  it('persists with its own versioned storage key', () => {
    const storage = createStorage()

    expect(saveMotionProfile('fast', storage)).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(
      MOTION_PROFILE_STORAGE_KEY,
      'fast',
    )
    expect(loadMotionProfile(storage)).toBe('fast')
  })

  it('survives privacy-blocked reads and writes', () => {
    const blockedStorage: MotionProfileStorage = {
      getItem: vi.fn(() => {
        throw new DOMException('blocked')
      }),
      setItem: vi.fn(() => {
        throw new DOMException('blocked')
      }),
    }

    expect(loadMotionProfile(blockedStorage)).toBe(DEFAULT_MOTION_PROFILE)
    expect(saveMotionProfile('cinematic', blockedStorage)).toBe(false)
    expect(loadMotionProfile(null)).toBe(DEFAULT_MOTION_PROFILE)
    expect(saveMotionProfile('fast', null)).toBe(false)
  })

  it('lets reduced motion override the active pace without losing selection', () => {
    expect(resolveEffectiveMotionProfile('cinematic', true)).toBe('reduced')
    expect(resolveEffectiveMotionProfile('fast', false)).toBe('fast')
  })

  it('maps pace profiles to deterministic animation durations', () => {
    expect(motionDuration(1_000, 'cinematic')).toBe(1_300)
    expect(motionDuration(1_000, 'standard')).toBe(1_000)
    expect(motionDuration(1_000, 'fast')).toBe(550)
    expect(motionDuration(1_000, 'reduced')).toBe(0)
    expect(motionDuration(Number.NaN, 'standard')).toBe(0)
    expect(motionDuration(-50, 'standard')).toBe(0)
  })
})
