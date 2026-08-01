import {
  motionDuration,
  type EffectiveMotionProfile,
} from './motionProfile'

export const CARD_SWEEP_BODY_MS = 760
export const CARD_SWEEP_STAGGER_MS = 55
export const REDUCED_CARD_SWEEP_TOTAL_MS = 30
export const MIN_CARD_SWEEP_CARDS = 4
export const MAX_CARD_SWEEP_CARDS = 6

export interface CardSweepMotionInput {
  readonly roundId: string
  readonly cardIds: readonly string[]
  readonly profile: EffectiveMotionProfile
}

export interface CardSweepMotionToken {
  readonly roundId: string
  readonly cardIds: readonly string[]
  readonly profile: EffectiveMotionProfile
}

export interface CardSweepMotionStep {
  readonly cardId: string
  readonly sequence: number
  readonly delayMs: number
  readonly durationMs: number
}

const EFFECTIVE_MOTION_PROFILES: ReadonlySet<EffectiveMotionProfile> = new Set([
  'cinematic',
  'standard',
  'fast',
  'reduced',
])

function assertCardSweepMotionInput(
  input: CardSweepMotionInput,
): asserts input is CardSweepMotionInput {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Card sweep motion input must be an object')
  }
  if (typeof input.roundId !== 'string' || input.roundId.trim() === '') {
    throw new TypeError('Card sweep roundId must be a non-empty string')
  }
  if (!Array.isArray(input.cardIds)) {
    throw new TypeError('Card sweep cardIds must be an array')
  }
  if (
    input.cardIds.length < MIN_CARD_SWEEP_CARDS ||
    input.cardIds.length > MAX_CARD_SWEEP_CARDS
  ) {
    throw new RangeError(
      `Card sweep requires ${MIN_CARD_SWEEP_CARDS}-${MAX_CARD_SWEEP_CARDS} cards`,
    )
  }

  const uniqueCardIds = new Set<string>()
  for (const cardId of input.cardIds) {
    if (typeof cardId !== 'string' || cardId.trim() === '') {
      throw new TypeError('Card sweep cardIds must be non-empty strings')
    }
    if (uniqueCardIds.has(cardId)) {
      throw new TypeError(`Card sweep cardIds must be unique: ${cardId}`)
    }
    uniqueCardIds.add(cardId)
  }

  if (!EFFECTIVE_MOTION_PROFILES.has(input.profile)) {
    throw new TypeError('Card sweep profile is not supported')
  }
}

/**
 * Snapshots the visual sweep identity without retaining the caller's array.
 * This token contains no engine state and cannot deal, settle, or discard cards.
 */
export function createCardSweepMotionToken(
  input: CardSweepMotionInput,
): CardSweepMotionToken {
  assertCardSweepMotionInput(input)

  return Object.freeze({
    roundId: input.roundId,
    cardIds: Object.freeze([...input.cardIds]),
    profile: input.profile,
  })
}

/** Returns one deterministic visual step per card in the captured input order. */
export function cardSweepMotionSteps(
  token: CardSweepMotionToken,
): readonly CardSweepMotionStep[] {
  assertCardSweepMotionInput(token)

  const reducedMotion = token.profile === 'reduced'
  const durationMs = reducedMotion
    ? REDUCED_CARD_SWEEP_TOTAL_MS
    : motionDuration(CARD_SWEEP_BODY_MS, token.profile)
  const staggerMs = reducedMotion
    ? 0
    : motionDuration(CARD_SWEEP_STAGGER_MS, token.profile)

  return Object.freeze(
    token.cardIds.map((cardId, sequence) =>
      Object.freeze({
        cardId,
        sequence,
        delayMs: sequence * staggerMs,
        durationMs,
      }),
    ),
  )
}

/** Returns the latest visual completion point across all card steps. */
export function cardSweepMotionDuration(token: CardSweepMotionToken): number {
  return Math.max(
    ...cardSweepMotionSteps(token).map(
      ({ delayMs, durationMs }) => delayMs + durationMs,
    ),
  )
}
