import { describe, expect, it, vi } from 'vitest'
import {
  INITIAL_POINT_CALL_MS,
  MIN_INITIAL_POINT_CALL_MS,
  createInitialPointCallCompletionGate,
  initialPointCallHold,
} from './useInitialPointCall'

describe('initial point call timing', () => {
  it('holds the call long enough to be perceived in every motion profile', () => {
    expect(initialPointCallHold('cinematic')).toBeGreaterThan(
      INITIAL_POINT_CALL_MS,
    )
    expect(initialPointCallHold('standard')).toBe(INITIAL_POINT_CALL_MS)
    expect(initialPointCallHold('fast')).toBe(341)
    expect(initialPointCallHold('reduced')).toBe(MIN_INITIAL_POINT_CALL_MS)
  })

  it('advances only after both the visual hold and dealer call finish', () => {
    const visualFirstComplete = vi.fn()
    const visualFirst = createInitialPointCallCompletionGate(
      visualFirstComplete,
    )
    visualFirst.markVisualHoldComplete()
    expect(visualFirstComplete).not.toHaveBeenCalled()
    visualFirst.markDealerCallComplete()
    visualFirst.markDealerCallComplete()
    expect(visualFirstComplete).toHaveBeenCalledTimes(1)

    const speechFirstComplete = vi.fn()
    const speechFirst = createInitialPointCallCompletionGate(
      speechFirstComplete,
    )
    speechFirst.markDealerCallComplete()
    expect(speechFirstComplete).not.toHaveBeenCalled()
    speechFirst.markVisualHoldComplete()
    expect(speechFirstComplete).toHaveBeenCalledTimes(1)
  })
})
