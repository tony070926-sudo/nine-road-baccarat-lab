import type {
  Bets,
  PersistedGameState,
  PersistedPendingRound,
  PlayMode,
  RevealControl,
} from '../types'
import { dealRound, totalBets, validateBets } from './baccarat'
import { resolveRevealControl } from './reveal'

interface PrepareRoundInput {
  game: PersistedGameState
  bets: Bets
  playMode: PlayMode
  revealControl?: RevealControl
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
  revealControl,
  roundId,
}: PrepareRoundInput): PersistedPendingRound {
  if (!roundId) throw new Error('roundId is required')
  if (game.shoe.needsShuffle) {
    throw new Error('a fresh shoe is required before preparing the round')
  }
  if (
    revealControl !== undefined &&
    revealControl !== 'player-squeeze' &&
    revealControl !== 'dealer-reveal'
  ) {
    throw new Error('invalid reveal control')
  }
  const resolvedRevealControl = resolveRevealControl({
    playMode,
    revealControl,
  })
  if (playMode === 'fly' && resolvedRevealControl !== 'dealer-reveal') {
    throw new Error('fly mode requires dealer reveal')
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
    revealControl: resolvedRevealControl,
    bets: { ...bets },
    balanceBefore: game.balance,
    sourceShoeId: game.shoe.id,
    sourceCursor: game.shoe.cursor,
    shoeAfter,
    result,
    revealedCount: 0,
  }
}
