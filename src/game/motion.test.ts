import { describe, expect, it } from 'vitest'
import {
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
