import type {
  Bets,
  PersistedGameState,
  PersistedPendingRound,
  PlayMode,
} from '../types'
import { dealRound, totalBets, validateBets } from './baccarat'

interface PrepareRoundInput {
  game: PersistedGameState
  bets: Bets
  playMode: PlayMode
  roundId: string
}

/**
 * Creates the immutable, fully dealt pending round that must be persisted
 * before the UI announces "No more bets". Animations only consume this record;
 * they never decide or redraw the outcome.
 */
export function preparePendingRound({
  game,
  bets,
  playMode,
  roundId,
}: PrepareRoundInput): PersistedPendingRound {
  if (!roundId) throw new Error('roundId is required')
  if (game.shoe.needsShuffle) {
    throw new Error('a fresh shoe is required before preparing the round')
  }

  if (playMode === 'bet') {
    const error = validateBets(bets, game.balance)
    if (error) throw new Error(error)
  } else if (totalBets(bets) !== 0) {
    throw new Error('fly mode cannot contain wagers')
  }

  const { shoe: shoeAfter, result } = dealRound(game.shoe)
  return {
    version: 1,
    id: roundId,
    playMode,
    bets: { ...bets },
    balanceBefore: game.balance,
    sourceShoeId: game.shoe.id,
    sourceCursor: game.shoe.cursor,
    shoeAfter,
    result,
    revealedCount: 0,
  }
}
