export interface DealMotionToken {
  roundId: string
  cardId: string
  sequence: number
}

const DEALER_MOTION_FALLBACK_MS = 1_400
const USER_MOTION_FALLBACK_MS = 2_800

/**
 * Animation callbacks can arrive after a new card or round has started.
 * Advance the game only when the callback still belongs to the active motion.
 */
export function isMatchingDealMotion(
  active: DealMotionToken | null | undefined,
  signal: DealMotionToken,
): boolean {
  return (
    active !== null &&
    active !== undefined &&
    active.roundId === signal.roundId &&
    active.cardId === signal.cardId &&
    active.sequence === signal.sequence
  )
}

/**
 * Return only cards that became visible in this render transition and have
 * not already landed on the table. The order from nextVisibleIds is retained.
 */
export function newlyVisibleUndealtCardIds(
  previousVisibleIds: readonly string[],
  nextVisibleIds: readonly string[],
  dealtIds: readonly string[],
): string[] {
  const excludedIds = new Set([...previousVisibleIds, ...dealtIds])
  const newIds = new Set<string>()

  return nextVisibleIds.filter((cardId) => {
    if (excludedIds.has(cardId) || newIds.has(cardId)) return false
    newIds.add(cardId)
    return true
  })
}

/**
 * A fallback prevents the table from getting stuck if animationend is lost.
 * Manual card squeezing deliberately receives more time than a dealer deal.
 */
export function motionFallbackMs(actor: 'user' | 'dealer'): number {
  return actor === 'user'
    ? USER_MOTION_FALLBACK_MS
    : DEALER_MOTION_FALLBACK_MS
}
