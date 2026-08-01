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
  completion: Promise<unknown>
  onComplete: () => void
}

export function createInitialPointCallCompletionGate(onComplete: () => void) {
  let visualHoldComplete = false
  let dealerCallComplete = false
  let completed = false
  const completeIfReady = () => {
    if (completed || !visualHoldComplete || !dealerCallComplete) return
    completed = true
    onComplete()
  }
  return {
    markVisualHoldComplete: () => {
      visualHoldComplete = true
      completeIfReady()
    },
    markDealerCallComplete: () => {
      dealerCallComplete = true
      completeIfReady()
    },
  }
}

/** Keeps the point call visible before a third card or settlement may begin. */
export function useInitialPointCall(initialRoundId: string | null) {
  const [announcedRoundId, setAnnouncedRoundId] = useState(initialRoundId)
  const activeRoundRef = useRef<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const generationRef = useRef(0)

  const cancel = useCallback(() => {
    generationRef.current += 1
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
    ({ roundId, profile, completion, onComplete }: BeginInitialPointCallInput) => {
      cancel()
      const generation = generationRef.current
      activeRoundRef.current = roundId
      setAnnouncedRoundId((current) =>
        current === roundId ? null : current,
      )
      const gate = createInitialPointCallCompletionGate(() => {
        if (
          generationRef.current !== generation ||
          activeRoundRef.current !== roundId
        ) return
        activeRoundRef.current = null
        setAnnouncedRoundId(roundId)
        onComplete()
      })
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        gate.markVisualHoldComplete()
      }, initialPointCallHold(profile))
      void completion.then(
        gate.markDealerCallComplete,
        gate.markDealerCallComplete,
      )
    },
    [cancel],
  )

  useEffect(() => cancel, [cancel])

  return { announcedRoundId, begin, markComplete, cancel }
}
