import { describe, expect, it } from 'vitest'
import {
  DRAG_REVEAL_COMMIT_PROGRESS,
  dragRevealMetrics,
  isMatchingDealMotion,
  motionFallbackMs,
  newlyVisibleUndealtCardIds,
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
  it('allows a player squeeze longer than a dealer deal', () => {
    expect(motionFallbackMs('dealer')).toBe(1_400)
    expect(motionFallbackMs('user')).toBe(2_800)
    expect(motionFallbackMs('user')).toBeGreaterThan(
      motionFallbackMs('dealer'),
    )
  })
})

describe('direct drag reveal metrics', () => {
  it('tracks pointer travel continuously and clamps the result', () => {
    expect(
      dragRevealMetrics({
        startX: 10,
        startY: 100,
        currentX: 10,
        currentY: 55,
        cardHeight: 100,
      }),
    ).toMatchObject({
      progress: 0.5,
      tilt: 0,
      requiredDistance: 90,
    })

    expect(
      dragRevealMetrics({
        startX: 0,
        startY: 0,
        currentX: 400,
        currentY: 400,
        cardHeight: 100,
      }).progress,
    ).toBe(1)
  })

  it('supports horizontal squeezing and exposes a forgiving commit point', () => {
    const metrics = dragRevealMetrics({
      startX: 100,
      startY: 100,
      currentX: 180,
      currentY: 100,
      cardHeight: 100,
    })

    expect(metrics.progress).toBeCloseTo(0.64)
    expect(metrics.tilt).toBeGreaterThan(0)
    expect(metrics.progress).toBeGreaterThan(DRAG_REVEAL_COMMIT_PROGRESS)
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
