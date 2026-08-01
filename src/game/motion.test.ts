import { describe, expect, it } from 'vitest'
import {
  DRAG_REVEAL_COMMIT_PROGRESS,
  cappedMotionPoint,
  dealContactDelayMs,
  dealMotionConfig,
  dragRevealMetrics,
  isMatchingDealMotion,
  motionFallbackMs,
  newlyVisibleUndealtCardIds,
  squeezeVisualFrame,
  type DealMotionToken,
} from './motion'

const activeMotion: DealMotionToken = {
  roundId: 'round-8',
  cardId: 'player-third',
  sequence: 4,
}

describe('deal motion token guards', () => {
  it('matches only the exact active round, card, and sequence', () => {
    expect(isMatchingDealMotion(activeMotion, { ...activeMotion })).toBe(true)
    expect(
      isMatchingDealMotion(activeMotion, {
        ...activeMotion,
        roundId: 'round-7',
      }),
    ).toBe(false)
    expect(
      isMatchingDealMotion(activeMotion, {
        ...activeMotion,
        cardId: 'banker-third',
      }),
    ).toBe(false)
    expect(
      isMatchingDealMotion(activeMotion, {
        ...activeMotion,
        sequence: 3,
      }),
    ).toBe(false)
  })

  it('rejects a duplicate completion after its active token is cleared', () => {
    expect(isMatchingDealMotion(null, activeMotion)).toBe(false)
    expect(isMatchingDealMotion(undefined, activeMotion)).toBe(false)
  })
})

describe('dealer hand release geometry', () => {
  it('caps the hand travel while preserving the direction toward the card', () => {
    const release = cappedMotionPoint(
      { x: 100, y: 80 },
      { x: 400, y: 480 },
      150,
    )

    expect(Math.hypot(release.x - 100, release.y - 80)).toBeCloseTo(150)
    expect(release.x).toBeGreaterThan(100)
    expect(release.y).toBeGreaterThan(80)
  })

  it('allows a nearby delivery and keeps a zero-distance hand stable', () => {
    expect(
      cappedMotionPoint({ x: 10, y: 20 }, { x: 40, y: 60 }, 80),
    ).toEqual({ x: 40, y: 60 })
    expect(
      cappedMotionPoint({ x: 10, y: 20 }, { x: 10, y: 20 }, 80),
    ).toEqual({ x: 10, y: 20 })
  })
})

describe('newly visible deal cards', () => {
  it('returns newly exposed third cards in their locked deal order', () => {
    expect(
      newlyVisibleUndealtCardIds(
        ['p1', 'b1', 'p2', 'b2'],
        ['p1', 'b1', 'p2', 'b2', 'p3', 'b3'],
        ['p1', 'b1', 'p2', 'b2'],
      ),
    ).toEqual(['p3', 'b3'])
  })

  it('filters already landed cards and duplicate ids', () => {
    expect(
      newlyVisibleUndealtCardIds(
        ['p1', 'b1'],
        ['p1', 'b1', 'p2', 'p2', 'b2', 'p3'],
        ['p2', 'b2'],
      ),
    ).toEqual(['p3'])
  })

  it('does not treat reordered visible cards as new', () => {
    expect(
      newlyVisibleUndealtCardIds(
        ['p1', 'b1', 'p2', 'b2'],
        ['b1', 'p1', 'b2', 'p2'],
        [],
      ),
    ).toEqual([])
  })
})

describe('motion fallback timing', () => {
  it('shares viewport-specific duration and release travel as one config', () => {
    expect(dealMotionConfig(393)).toEqual({
      durationMs: 760,
      maximumReleaseTravel: 92,
    })
    expect(dealMotionConfig(760)).toEqual({
      durationMs: 760,
      maximumReleaseTravel: 92,
    })

    const narrowDesktop = dealMotionConfig(761)
    expect(narrowDesktop.durationMs).toBe(880)
    expect(narrowDesktop.maximumReleaseTravel).toBeCloseTo(102.735)
    expect(dealMotionConfig(1_280)).toEqual({
      durationMs: 880,
      maximumReleaseTravel: 158,
    })
  })

  it('allows a player squeeze longer than a dealer deal', () => {
    expect(motionFallbackMs('dealer')).toBe(1_400)
    expect(motionFallbackMs('user')).toBe(2_800)
    expect(motionFallbackMs('user')).toBeGreaterThan(
      motionFallbackMs('dealer'),
    )
  })

  it('places the card impact sound on the visual contact keyframe', () => {
    expect(dealContactDelayMs(1_280)).toBe(669)
    expect(dealContactDelayMs(393)).toBe(578)
    expect(dealContactDelayMs(393, true)).toBe(0)
  })
})

describe('direct drag reveal metrics', () => {
  it('tracks pointer travel continuously and clamps the result', () => {
    const vertical = dragRevealMetrics({
      startX: 10,
      startY: 100,
      currentX: 10,
      currentY: 55,
      cardHeight: 100,
      corner: 'right',
    })
    expect(vertical.progress).toBeCloseTo(0.35, 2)
    expect(vertical.requiredDistance).toBe(90)

    expect(
      dragRevealMetrics({
        startX: 0,
        startY: 0,
        currentX: 400,
        currentY: -400,
        cardHeight: 100,
        corner: 'left',
      }).progress,
    ).toBe(1)
  })

  it('supports horizontal squeezing and exposes a forgiving commit point', () => {
    const metrics = dragRevealMetrics({
      startX: 100,
      startY: 100,
      currentX: 40,
      currentY: 50,
      cardHeight: 100,
      corner: 'right',
    })

    expect(metrics.progress).toBeGreaterThan(0.75)
    expect(Math.abs(metrics.tilt)).toBeLessThanOrEqual(3)
    expect(metrics.progress).toBeGreaterThan(DRAG_REVEAL_COMMIT_PROGRESS)
  })

  it('rejects dragging a squeezed corner down or away from the card', () => {
    expect(
      dragRevealMetrics({
        startX: 100,
        startY: 100,
        currentX: 150,
        currentY: 150,
        cardHeight: 100,
        corner: 'right',
      }).progress,
    ).toBe(0)
  })

  it('keeps the required travel usable on small and large cards', () => {
    expect(
      dragRevealMetrics({
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
        cardHeight: 40,
      }).requiredDistance,
    ).toBe(68)
    expect(
      dragRevealMetrics({
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
        cardHeight: 300,
      }).requiredDistance,
    ).toBe(116)
  })
})

describe('local card-curl visuals', () => {
  it('reveals only a bounded corner before the final full-card flip', () => {
    expect(squeezeVisualFrame(0)).toEqual({
      peekPercent: 0,
      curlAngle: 0,
      lift: -0,
      scale: 1,
    })
    const committed = squeezeVisualFrame(DRAG_REVEAL_COMMIT_PROGRESS)
    expect(committed.peekPercent).toBeLessThan(42)
    expect(committed.curlAngle).toBeLessThan(68)
    expect(committed.lift).toBeGreaterThanOrEqual(-4)
    expect(squeezeVisualFrame(2).peekPercent).toBe(42)
  })
})
