import type {
  Bets,
  Card,
  DealResult,
  PlayMode,
  RevealControl,
} from '../types'

const OPENING_CARD_COUNT = 4
export type RevealSide = 'player' | 'banker'

interface RevealControlSource {
  playMode: PlayMode
  revealControl?: RevealControl
}

/**
 * Legacy v1 journals predate an explicit reveal choice. Preserve their
 * original behavior for wagered rounds while keeping fly rounds dealer-run.
 */
export function resolveRevealControl({
  playMode,
  revealControl,
}: RevealControlSource): RevealControl {
  return revealControl ??
    (playMode === 'fly' ? 'dealer-reveal' : 'player-squeeze')
}

export function revealSideForCard(
  result: DealResult,
  cardId: string,
): RevealSide | null {
  if (result.playerCards.some((card) => card.id === cardId)) return 'player'
  if (result.bankerCards.some((card) => card.id === cardId)) return 'banker'
  return null
}

/**
 * When player squeeze is selected, the single simulated seated player may
 * reveal only the hand covered by a main Player or Banker wager. Dealer reveal,
 * side-bet-only, and fly rounds have no player-controlled sides.
 */
export function manualRevealSides(
  bets: Bets,
  playMode: PlayMode,
  revealControl?: RevealControl,
): RevealSide[] {
  if (
    playMode === 'fly' ||
    resolveRevealControl({ playMode, revealControl }) === 'dealer-reveal'
  ) {
    return []
  }

  const sides: RevealSide[] = []
  if (bets.player > 0) sides.push('player')
  if (bets.banker > 0) sides.push('banker')
  return sides
}

/**
 * Dealing and exposure are different physical procedures. This table follows
 * the Macau-style exposure profile: the Player opening hand is exposed first,
 * then the Banker opening hand, followed by any Player and Banker third cards.
 */
export function revealOrder(result: DealResult): Card[] {
  return [
    ...result.playerCards.slice(0, 2),
    ...result.bankerCards.slice(0, 2),
    ...result.playerCards.slice(2),
    ...result.bankerCards.slice(2),
  ]
}

/**
 * The physical opening deal alternates Player and Banker. Keep this separate
 * from revealOrder(), which intentionally groups the two Player cards before
 * the two Banker cards for the table's Macau-style exposure procedure.
 */
export function openingDealCardIds(result: DealResult): string[] {
  return result.dealOrder
    .slice(0, OPENING_CARD_COUNT)
    .map((card) => card.id)
}

export function nextRevealCard(
  result: DealResult,
  revealedCount: number,
): Card | null {
  return revealOrder(result)[revealedCount] ?? null
}

/**
 * The four opening cards are placed face-down together. A mandatory third
 * card only appears after the opening four have been revealed, so its
 * existence cannot be inferred early.
 */
export function visibleRevealCardIds(
  result: DealResult,
  revealedCount: number,
): string[] {
  const order = revealOrder(result)
  const initialCount = Math.min(OPENING_CARD_COUNT, order.length)
  const visibleCount = Math.max(
    initialCount,
    Math.min(order.length, revealedCount + 1),
  )
  return order.slice(0, visibleCount).map((card) => card.id)
}

export function revealedCards(
  result: DealResult,
  revealedCount: number,
): Card[] {
  return revealOrder(result).slice(0, revealedCount)
}

export function revealIsComplete(
  result: DealResult,
  revealedCount: number,
): boolean {
  return revealedCount >= revealOrder(result).length
}
