import { useCallback, useEffect, useRef, useState } from 'react'
import {
  motionDuration,
  type EffectiveMotionProfile,
} from '../game/motionProfile'

export const INITIAL_POINT_CALL_MS = 620
export const MIN_INITIAL_POINT_CALL_MS = 30

export function initialPointCallHold(
  profile: EffectiveMotionProfile,
): number {
  return Math.max(
    MIN_INITIAL_POINT_CALL_MS,
    motionDuration(INITIAL_POINT_CALL_MS, profile),
  )
}

interface BeginInitialPointCallInput {
  roundId: string
  profile: EffectiveMotionProfile
  onComplete: () => void
}

/** Keeps the point call visible before a third card or settlement may begin. */
export function useInitialPointCall(initialRoundId: string | null) {
  const [announcedRoundId, setAnnouncedRoundId] = useState(initialRoundId)
  const activeRoundRef = useRef<string | null>(null)
  const timerRef = useRef<number | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    activeRoundRef.current = null
  }, [])

  const markComplete = useCallback(
    (roundId: string) => {
      cancel()
      setAnnouncedRoundId(roundId)
    },
    [cancel],
  )

  const begin = useCallback(
    ({ roundId, profile, onComplete }: BeginInitialPointCallInput) => {
      cancel()
      activeRoundRef.current = roundId
      setAnnouncedRoundId((current) =>
        current === roundId ? null : current,
      )
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        if (activeRoundRef.current !== roundId) return
        activeRoundRef.current = null
        setAnnouncedRoundId(roundId)
        onComplete()
      }, initialPointCallHold(profile))
    },
    [cancel],
  )

  useEffect(() => cancel, [cancel])

  return { announcedRoundId, begin, markComplete, cancel }
}
