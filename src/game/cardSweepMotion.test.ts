import { describe, expect, it } from 'vitest'
import {
  CARD_SWEEP_BODY_MS,
  CARD_SWEEP_STAGGER_MS,
  REDUCED_CARD_SWEEP_TOTAL_MS,
  cardSweepMotionDuration,
  cardSweepMotionSteps,
  createCardSweepMotionToken,
  type CardSweepMotionInput,
} from './cardSweepMotion'

function input(
  count: number,
  profile: CardSweepMotionInput['profile'] = 'standard',
): CardSweepMotionInput {
  return {
    roundId: 'round-42',
    cardIds: Array.from({ length: count }, (_, index) => `card-${index + 1}`),
    profile,
  }
}

describe('card sweep motion', () => {
  it.each([4, 5, 6])(
    'keeps the captured order and timing for a %i-card sweep',
    (count) => {
      const token = createCardSweepMotionToken(input(count))
      const steps = cardSweepMotionSteps(token)

      expect(steps.map((step) => step.cardId)).toEqual(token.cardIds)
      expect(steps.map((step) => step.sequence)).toEqual(
        Array.from({ length: count }, (_, index) => index),
      )
      expect(steps.map((step) => step.delayMs)).toEqual(
        Array.from(
          { length: count },
          (_, index) => index * CARD_SWEEP_STAGGER_MS,
        ),
      )
      expect(steps.every((step) => step.durationMs === CARD_SWEEP_BODY_MS)).toBe(
        true,
      )
      expect(cardSweepMotionDuration(token)).toBe(
        CARD_SWEEP_BODY_MS + (count - 1) * CARD_SWEEP_STAGGER_MS,
      )
    },
  )

  it('scales fast and cinematic motion once with the shared profile rules', () => {
    const fastToken = createCardSweepMotionToken(input(6, 'fast'))
    const cinematicToken = createCardSweepMotionToken(input(4, 'cinematic'))

    expect(cardSweepMotionSteps(fastToken)).toEqual(
      Array.from({ length: 6 }, (_, sequence) => ({
        cardId: `card-${sequence + 1}`,
        sequence,
        delayMs: sequence * 30,
        durationMs: 418,
      })),
    )
    expect(cardSweepMotionDuration(fastToken)).toBe(568)

    expect(cardSweepMotionSteps(cinematicToken)).toEqual(
      Array.from({ length: 4 }, (_, sequence) => ({
        cardId: `card-${sequence + 1}`,
        sequence,
        delayMs: sequence * 72,
        durationMs: 988,
      })),
    )
    expect(cardSweepMotionDuration(cinematicToken)).toBe(1_204)
  })

  it('collapses reduced motion into one 30ms completion window', () => {
    const token = createCardSweepMotionToken(input(6, 'reduced'))
    const steps = cardSweepMotionSteps(token)

    expect(steps.every((step) => step.delayMs === 0)).toBe(true)
    expect(
      steps.every(
        (step) => step.durationMs === REDUCED_CARD_SWEEP_TOTAL_MS,
      ),
    ).toBe(true)
    expect(cardSweepMotionDuration(token)).toBe(
      REDUCED_CARD_SWEEP_TOTAL_MS,
    )
  })

  it('rejects invalid round, card, count, duplicate, and profile inputs', () => {
    expect(() =>
      createCardSweepMotionToken({ ...input(4), roundId: '  ' }),
    ).toThrow(/roundId/)
    expect(() => createCardSweepMotionToken(input(3))).toThrow(/4-6/)
    expect(() => createCardSweepMotionToken(input(7))).toThrow(/4-6/)
    expect(() =>
      createCardSweepMotionToken({
        ...input(4),
        cardIds: ['card-1', 'card-2', '', 'card-4'],
      }),
    ).toThrow(/non-empty/)
    expect(() =>
      createCardSweepMotionToken({
        ...input(4),
        cardIds: ['card-1', 'card-2', 'card-2', 'card-4'],
      }),
    ).toThrow(/unique/)
    expect(() =>
      createCardSweepMotionToken({
        ...input(4),
        profile: 'turbo' as CardSweepMotionInput['profile'],
      }),
    ).toThrow(/profile/)
  })

  it('does not mutate or retain mutable input and freezes the visual token', () => {
    const cardIds = ['p1', 'b1', 'p2', 'b2']
    const originalInput = {
      roundId: 'round-immutable',
      cardIds,
      profile: 'standard' as CardSweepMotionInput['profile'],
    }
    const snapshot = structuredClone(originalInput)
    const token = createCardSweepMotionToken(originalInput)
    const steps = cardSweepMotionSteps(token)

    expect(originalInput).toEqual(snapshot)

    cardIds[0] = 'changed-after-capture'
    originalInput.roundId = 'changed-round'
    originalInput.profile = 'fast'

    expect(token.roundId).toBe(snapshot.roundId)
    expect(token.cardIds).toEqual(snapshot.cardIds)
    expect(token.profile).toBe(snapshot.profile)
    expect(Object.isFrozen(token)).toBe(true)
    expect(Object.isFrozen(token.cardIds)).toBe(true)
    expect(Object.isFrozen(steps)).toBe(true)
    expect(Object.isFrozen(steps[0])).toBe(true)
  })

  it('accepts frozen input and produces the same schedule deterministically', () => {
    const frozenInput = Object.freeze({
      roundId: 'round-frozen',
      cardIds: Object.freeze(['p1', 'b1', 'p2', 'b2', 'p3']),
      profile: 'cinematic' as const,
    })
    const token = createCardSweepMotionToken(frozenInput)

    expect(cardSweepMotionSteps(token)).toEqual(cardSweepMotionSteps(token))
    expect(frozenInput.cardIds).toEqual(['p1', 'b1', 'p2', 'b2', 'p3'])
  })
})
