import { useCallback, useEffect, useState } from 'react'
import {
  loadMotionProfile,
  motionDuration,
  resolveEffectiveMotionProfile,
  saveMotionProfile,
  type MotionProfile,
} from '../game/motionProfile'

function reducedMotionIsPreferred(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function useMotionProfilePreference() {
  const [motionProfile, setMotionProfile] = useState(loadMotionProfile)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    reducedMotionIsPreferred,
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches)
    }

    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const effectiveMotionProfile = resolveEffectiveMotionProfile(
    motionProfile,
    prefersReducedMotion,
  )
  const scaledMotionDuration = useCallback(
    (baseDurationMs: number, minimumMs = 0) =>
      Math.max(
        minimumMs,
        motionDuration(baseDurationMs, effectiveMotionProfile),
      ),
    [effectiveMotionProfile],
  )
  const updateMotionProfile = useCallback((profile: MotionProfile) => {
    setMotionProfile(profile)
    return saveMotionProfile(profile)
  }, [])

  return {
    motionProfile,
    effectiveMotionProfile,
    scaledMotionDuration,
    updateMotionProfile,
  }
}
