import type {
  PendingRound,
  PersistedGameState,
  PersistedPendingRound,
} from '../types'
import {
  loadGameState,
  loadPendingRound,
  savePendingRound,
} from './storage'
import {
  pendingRoundMatchesGame,
  pendingRoundsMatch,
} from './reveal'

export interface RoundJournalSnapshot {
  game: PersistedGameState
  pending: PersistedPendingRound
}

export type RevealJournalAdvance =
  | { status: 'advanced'; snapshot: RoundJournalSnapshot }
  | { status: 'conflict' }
  | { status: 'write-failed' }

function sameGamePosition(
  expected: PersistedGameState,
  actual: PersistedGameState,
): boolean {
  return (
    actual.sessionStartedAt === expected.sessionStartedAt &&
    actual.balance === expected.balance &&
    actual.shoe.id === expected.shoe.id &&
    actual.shoe.cursor === expected.shoe.cursor &&
    actual.shoe.handNumber === expected.shoe.handNumber
  )
}

/**
 * Reads the game and journal together and verifies that the journal is both
 * internally valid and derived from the current unadvanced shoe.
 */
export function loadMatchingRoundJournal(
  expectedRound?: PendingRound,
  expectedRevealedCount?: number,
): RoundJournalSnapshot | null {
  const game = loadGameState()
  const pending = loadPendingRound()
  if (
    !game ||
    !pending ||
    !pendingRoundMatchesGame(game, pending) ||
    (expectedRound && !pendingRoundsMatch(expectedRound, pending)) ||
    (expectedRevealedCount !== undefined &&
      pending.revealedCount !== expectedRevealedCount)
  ) {
    return null
  }

  return { game, pending }
}

/**
 * Advances reveal progress as a compare-write-read transaction. Callers must
 * not update visible or in-memory progress until this returns `advanced`.
 */
export function advanceRevealJournal({
  game,
  round,
  currentRevealedCount,
  nextRevealedCount,
}: {
  game: PersistedGameState
  round: PendingRound
  currentRevealedCount: number
  nextRevealedCount: number
}): RevealJournalAdvance {
  if (
    nextRevealedCount !== currentRevealedCount + 1 ||
    nextRevealedCount > round.result.dealOrder.length
  ) {
    return { status: 'conflict' }
  }

  const current = loadMatchingRoundJournal(round, currentRevealedCount)
  if (!current || !sameGamePosition(game, current.game)) {
    return { status: 'conflict' }
  }

  const nextPending: PersistedPendingRound = {
    ...current.pending,
    revealedCount: nextRevealedCount,
  }
  if (!savePendingRound(nextPending)) {
    return { status: 'write-failed' }
  }

  const saved = loadMatchingRoundJournal(round, nextRevealedCount)
  if (!saved || !sameGamePosition(game, saved.game)) {
    return { status: 'write-failed' }
  }

  return { status: 'advanced', snapshot: saved }
}
