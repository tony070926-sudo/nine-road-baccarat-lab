export interface DealMotionToken {
  roundId: string
  cardId: string
  sequence: number
}

const DEALER_MOTION_FALLBACK_MS = 1_400
const USER_MOTION_FALLBACK_MS = 2_800

export const DRAG_REVEAL_COMMIT_PROGRESS = 0.62

interface DragRevealMetricsInput {
  startX: number
  startY: number
  currentX: number
  currentY: number
  cardHeight: number
}

export interface DragRevealMetrics {
  progress: number
  tilt: number
  requiredDistance: number
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

/**
 * Convert direct pointer travel into a normalized card-squeeze gesture.
 * Vertical travel is primary, while horizontal travel remains available for
 * narrow mobile layouts and different player grips.
 */
export function dragRevealMetrics({
  startX,
  startY,
  currentX,
  currentY,
  cardHeight,
}: DragRevealMetricsInput): DragRevealMetrics {
  const deltaX = currentX - startX
  const deltaY = currentY - startY
  const requiredDistance = clamp(cardHeight * 0.9, 68, 116)
  const revealDistance = Math.max(Math.abs(deltaY), Math.abs(deltaX) * 0.72)
  const progress = clamp(revealDistance / requiredDistance, 0, 1)
  const tilt = clamp((deltaX / requiredDistance) * 8, -8, 8)

  return { progress, tilt, requiredDistance }
}

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
