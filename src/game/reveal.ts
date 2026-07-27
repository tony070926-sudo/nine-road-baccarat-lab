import type {
  Card,
  DealResult,
  PersistedGameState,
  PersistedPendingRound,
} from '../types'

const OPENING_CARD_COUNT = 4

export function nextRevealCard(
  result: DealResult,
  revealedCount: number,
): Card | null {
  return result.dealOrder[revealedCount] ?? null
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
  const initialCount = Math.min(OPENING_CARD_COUNT, result.dealOrder.length)
  const visibleCount = Math.max(
    initialCount,
    Math.min(result.dealOrder.length, revealedCount + 1),
  )
  return result.dealOrder.slice(0, visibleCount).map((card) => card.id)
}

export function revealedCards(
  result: DealResult,
  revealedCount: number,
): Card[] {
  return result.dealOrder.slice(0, revealedCount)
}

export function revealIsComplete(
  result: DealResult,
  revealedCount: number,
): boolean {
  return revealedCount >= result.dealOrder.length
}

export function pendingRoundMatchesGame(
  game: PersistedGameState,
  pending: PersistedPendingRound,
): boolean {
  if (
    !pending ||
    typeof pending !== 'object' ||
    !pending.bets ||
    typeof pending.bets !== 'object' ||
    !pending.result ||
    !Array.isArray(pending.result.dealOrder) ||
    !Array.isArray(pending.result.playerCards) ||
    !Array.isArray(pending.result.bankerCards) ||
    !pending.shoeAfter ||
    !Array.isArray(pending.shoeAfter.cards)
  ) {
    return false
  }

  const betValues = [
    pending.bets.player,
    pending.bets.banker,
    pending.bets.tie,
    pending.bets.playerPair,
    pending.bets.bankerPair,
  ]
  const betsAreValid = betValues.every(
    (value) => Number.isFinite(value) && value >= 0,
  )
  const hasValidMode =
    pending.playMode === 'bet' || pending.playMode === 'fly'
  const dealLength = pending.result.dealOrder.length
  const totalStake = betValues.reduce((total, value) => total + value, 0)
  const modeMatchesStake =
    (pending.playMode === 'fly' && totalStake === 0) ||
    (pending.playMode === 'bet' && totalStake > 0)

  return (
    pending.version === 1 &&
    Boolean(pending.id) &&
    hasValidMode &&
    betsAreValid &&
    modeMatchesStake &&
    Number.isFinite(pending.balanceBefore) &&
    pending.balanceBefore >= 0 &&
    pending.balanceBefore === game.balance &&
    pending.sourceShoeId === game.shoe.id &&
    Number.isInteger(pending.sourceCursor) &&
    pending.sourceCursor >= 0 &&
    pending.sourceCursor === game.shoe.cursor &&
    pending.shoeAfter.id === pending.sourceShoeId &&
    pending.result.cardsUsed === dealLength &&
    pending.shoeAfter.cursor ===
      pending.sourceCursor + pending.result.cardsUsed &&
    pending.shoeAfter.handNumber === game.shoe.handNumber + 1 &&
    dealLength >= OPENING_CARD_COUNT &&
    dealLength <= 6 &&
    Number.isInteger(pending.revealedCount) &&
    pending.revealedCount >= 0 &&
    pending.revealedCount < dealLength &&
    !game.history.some((record) => record.id === pending.id)
  )
}
