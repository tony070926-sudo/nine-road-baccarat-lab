export interface DealMotionToken {
  roundId: string
  cardId: string
  sequence: number
}

export interface MotionPoint {
  x: number
  y: number
}

const DEALER_MOTION_FALLBACK_MS = 1_400
const USER_MOTION_FALLBACK_MS = 2_800

export const DESKTOP_DEAL_MOTION_MS = 880
export const MOBILE_DEAL_MOTION_MS = 760
export const DEAL_MOTION_MOBILE_MAX_WIDTH = 760
export const MOBILE_DEAL_RELEASE_TRAVEL_PX = 92
export const DESKTOP_DEAL_RELEASE_TRAVEL_PX = 158
export const DESKTOP_DEAL_RELEASE_TRAVEL_RATIO = 0.135
export const DEAL_CONTACT_PROGRESS = 0.76

export interface DealMotionConfig {
  durationMs: number
  maximumReleaseTravel: number
}

/**
 * Keep the card and stage-level dealer rig on the same viewport-specific
 * timing and physical hand-travel limits. The desktop reach scales on narrow
 * stages before reaching its cap; mobile uses a shorter fixed release reach.
 */
export function dealMotionConfig(viewportWidth: number): DealMotionConfig {
  const mobile = viewportWidth <= DEAL_MOTION_MOBILE_MAX_WIDTH

  return {
    durationMs: mobile
      ? MOBILE_DEAL_MOTION_MS
      : DESKTOP_DEAL_MOTION_MS,
    maximumReleaseTravel: mobile
      ? MOBILE_DEAL_RELEASE_TRAVEL_PX
      : Math.min(
          DESKTOP_DEAL_RELEASE_TRAVEL_PX,
          viewportWidth * DESKTOP_DEAL_RELEASE_TRAVEL_RATIO,
        ),
  }
}

export const DRAG_REVEAL_COMMIT_PROGRESS = 0.62
export type SqueezeCorner = 'left' | 'right'

interface DragRevealMetricsInput {
  startX: number
  startY: number
  currentX: number
  currentY: number
  cardHeight: number
  corner?: SqueezeCorner
}

export interface DragRevealMetrics {
  progress: number
  tilt: number
  requiredDistance: number
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

/**
 * Move from an origin toward a target without exceeding the physical travel
 * available to the dealer's hand. The card can continue sliding after this
 * release point, while the arm retracts instead of stretching across the felt.
 */
export function cappedMotionPoint(
  origin: MotionPoint,
  target: MotionPoint,
  maximumDistance: number,
): MotionPoint {
  const deltaX = target.x - origin.x
  const deltaY = target.y - origin.y
  const distance = Math.hypot(deltaX, deltaY)

  if (distance === 0 || maximumDistance <= 0) return { ...origin }
  if (distance <= maximumDistance) return { ...target }

  const ratio = maximumDistance / distance
  return {
    x: origin.x + deltaX * ratio,
    y: origin.y + deltaY * ratio,
  }
}

export interface SqueezeVisualFrame {
  peekPercent: number
  curlAngle: number
  lift: number
  scale: number
}

export function squeezeVisualFrame(progress: number): SqueezeVisualFrame {
  const normalized = clamp(progress, 0, 1)
  return {
    peekPercent: Math.pow(normalized, 1.35) * 42,
    curlAngle: Math.pow(normalized, 0.82) * 68,
    lift: -Math.min(4, normalized * 4),
    scale: 1 + normalized * 0.006,
  }
}

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
  corner = 'right',
}: DragRevealMetricsInput): DragRevealMetrics {
  const deltaX = currentX - startX
  const deltaY = currentY - startY
  const requiredDistance = clamp(cardHeight * 0.9, 68, 116)
  const directionX = corner === 'left' ? 0.55 : -0.55
  const directionY = -0.835
  const forwardDistance = Math.max(
    0,
    deltaX * directionX + deltaY * directionY,
  )
  const rawProgress = clamp(
    (forwardDistance - 2) / requiredDistance,
    0,
    1.18,
  )
  const progress =
    rawProgress < 0.18
      ? rawProgress * 0.65
      : rawProgress < 0.82
        ? 0.117 + (rawProgress - 0.18) * 1.08
        : 0.808 + (rawProgress - 0.82) * 0.55
  const perpendicularDistance =
    deltaX * -directionY + deltaY * directionX
  const tilt = clamp((perpendicularDistance / requiredDistance) * 3, -3, 3)

  return {
    progress: clamp(progress, 0, 1),
    tilt,
    requiredDistance,
  }
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

export function dealContactDelayMs(
  viewportWidth: number,
  reducedMotion = false,
): number {
  if (reducedMotion) return 0
  const { durationMs: duration } = dealMotionConfig(viewportWidth)
  return Math.round(duration * DEAL_CONTACT_PROGRESS)
}
