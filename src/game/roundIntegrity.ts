import type {
  Card,
  DealResult,
  PendingRound,
  PersistedGameState,
  PersistedPendingRound,
  ShoeState,
} from '../types'
import { dealRound } from './baccarat'
import { resolveRevealControl } from './reveal'
import {
  isPersistedGameState,
  isPersistedPendingRound,
} from './stateValidation'

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
  left: PendingRound | PersistedPendingRound,
  right: PendingRound | PersistedPendingRound,
): boolean {
  return (
    left.id === right.id &&
    left.playMode === right.playMode &&
    resolveRevealControl(left) === resolveRevealControl(right) &&
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

/**
 * Proves that a durable pending round was deterministically derived from the
 * current unadvanced shoe. Presentation modules must not own this invariant.
 */
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
