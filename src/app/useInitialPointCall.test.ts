import { describe, expect, it } from 'vitest'
import {
  INITIAL_POINT_CALL_MS,
  MIN_INITIAL_POINT_CALL_MS,
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
})
