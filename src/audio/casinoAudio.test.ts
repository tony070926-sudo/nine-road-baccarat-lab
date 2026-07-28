import { describe, expect, it } from 'vitest'
import { crowdIntensity, panForSide } from './spatialAudio'

describe('casino spatial audio mapping', () => {
  it('keeps player left, banker right, and dealer cues centered', () => {
    expect(panForSide('player')).toBeLessThan(0)
    expect(panForSide('banker')).toBeGreaterThan(0)
    expect(panForSide('player')).toBe(-panForSide('banker'))
    expect(panForSide('center')).toBe(0)
  })

  it('keeps celebration stronger than anticipation, reaction, and hush', () => {
    expect(crowdIntensity('celebration')).toBeGreaterThan(
      crowdIntensity('anticipation'),
    )
    expect(crowdIntensity('anticipation')).toBeGreaterThan(
      crowdIntensity('reaction'),
    )
    expect(crowdIntensity('reaction')).toBeGreaterThan(
      crowdIntensity('hush'),
    )
  })
})
