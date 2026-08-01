import type {
  Bets,
  Card,
  DealResult,
  PendingRound,
  PersistedGameState,
  PersistedPendingRound,
  PlayMode,
  ShoeState,
} from '../types'
import { dealRound } from './baccarat'
import {
  isPersistedGameState,
  isPersistedPendingRound,
} from './stateValidation'

const OPENING_CARD_COUNT = 4
export type RevealSide = 'player' | 'banker'

export function revealSideForCard(
  result: DealResult,
  cardId: string,
): RevealSide | null {
  if (result.playerCards.some((card) => card.id === cardId)) return 'player'
  if (result.bankerCards.some((card) => card.id === cardId)) return 'banker'
  return null
}

/**
 * The single simulated seated player may squeeze only the hand covered by a
 * main Player or Banker wager. Side-bet-only and fly rounds are dealer-opened.
 */
export function manualRevealSides(
  bets: Bets,
  playMode: PlayMode,
): RevealSide[] {
  if (playMode === 'fly') return []

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

function cardsMatch(left: Card, right: Card): boolean {
  return (
    left.id === right.id &&
    left.suit === right.suit &&
    left.rank === right.rank &&
    left.deck === right.deck
  )
}

function cardArraysMatch(
  left: readonly Card[],
  right: readonly Card[],
): boolean {
  return (
    left.length === right.length &&
    left.every((card, index) => cardsMatch(card, right[index]))
  )
}

function dealResultsMatch(left: DealResult, right: DealResult): boolean {
  return (
    cardArraysMatch(left.playerCards, right.playerCards) &&
    cardArraysMatch(left.bankerCards, right.bankerCards) &&
    cardArraysMatch(left.dealOrder, right.dealOrder) &&
    left.playerTotal === right.playerTotal &&
    left.bankerTotal === right.bankerTotal &&
    left.winner === right.winner &&
    left.natural === right.natural &&
    left.playerPair === right.playerPair &&
    left.bankerPair === right.bankerPair &&
    left.cardsUsed === right.cardsUsed
  )
}

function shoesMatch(left: ShoeState, right: ShoeState): boolean {
  return (
    left.id === right.id &&
    cardArraysMatch(left.cards, right.cards) &&
    left.cursor === right.cursor &&
    left.cutAtRemaining === right.cutAtRemaining &&
    cardsMatch(left.burnCard, right.burnCard) &&
    left.burnedCards === right.burnedCards &&
    left.handNumber === right.handNumber &&
    left.shuffleVersion === right.shuffleVersion &&
    left.needsShuffle === right.needsShuffle
  )
}

export function pendingRoundsMatch(
  left: PendingRound,
  right: PendingRound,
): boolean {
  return (
    left.id === right.id &&
    left.playMode === right.playMode &&
    left.bets.player === right.bets.player &&
    left.bets.banker === right.bets.banker &&
    left.bets.tie === right.bets.tie &&
    left.bets.playerPair === right.bets.playerPair &&
    left.bets.bankerPair === right.bets.bankerPair &&
    left.balanceBefore === right.balanceBefore &&
    left.sourceShoeId === right.sourceShoeId &&
    left.sourceCursor === right.sourceCursor &&
    dealResultsMatch(left.result, right.result) &&
    shoesMatch(left.shoeAfter, right.shoeAfter)
  )
}

export function pendingRoundMatchesGame(
  game: PersistedGameState,
  pending: PersistedPendingRound,
): boolean {
  if (!isPersistedGameState(game) || !isPersistedPendingRound(pending)) {
    return false
  }

  let expectedRound: ReturnType<typeof dealRound>
  try {
    expectedRound = dealRound(game.shoe)
  } catch {
    return false
  }

  return (
    pending.balanceBefore === game.balance &&
    pending.sourceShoeId === game.shoe.id &&
    pending.sourceCursor === game.shoe.cursor &&
    !game.history.some((record) => record.id === pending.id) &&
    dealResultsMatch(pending.result, expectedRound.result) &&
    shoesMatch(pending.shoeAfter, expectedRound.shoe)
  )
}
