import type {
  Bets,
  PersistedGameState,
  PlayMode,
  RoundRecord,
  ShoeState,
} from '../types'
import {
  EMPTY_BETS,
  RULESET_VERSION,
  cardsRemaining,
  settleBets,
} from './baccarat'
import { pendingRoundMatchesGame } from './roundIntegrity'
import { preparePendingRound } from './roundPreparation'
import {
  isPersistedGameState,
  isPersistedPendingRound,
} from './stateValidation'
import type { TableCoreState } from './tableState'

const MAX_HISTORY_LENGTH = 500

export type TablePhase = 'betting' | 'revealing' | 'ready-to-settle'

export type TableEngineErrorCode =
  | 'invalid-state'
  | 'round-in-progress'
  | 'duplicate-round'
  | 'no-pending-round'
  | 'round-mismatch'
  | 'reveal-out-of-order'
  | 'round-not-revealed'
  | 'settlement-conflict'
  | 'invalid-shoe'

export class TableEngineError extends Error {
  readonly name = 'TableEngineError'

  constructor(
    readonly code: TableEngineErrorCode,
    message: string,
  ) {
    super(message)
  }
}

interface PrepareRoundStateInput {
  bets: Bets
  playMode: PlayMode
  roundId: string
}

interface AdvanceRevealStateInput {
  roundId: string
  nextRevealedCount: number
}

interface SettleRoundStateInput {
  roundId: string
  settledAt: string
}

interface ReplaceShoeStateInput {
  shoe: ShoeState
}

interface ResetTableStateInput {
  shoe: ShoeState
  balance: number
  sessionStartedAt: string
}

export type SettleRoundStateResult =
  | {
      status: 'settled'
      state: TableCoreState
      record: RoundRecord
    }
  | {
      status: 'already-settled'
      state: TableCoreState
      record: RoundRecord
    }

function fail(code: TableEngineErrorCode, message: string): never {
  throw new TableEngineError(code, message)
}

function assertCoreState(state: TableCoreState): void {
  if (!isPersistedGameState(state.game)) {
    fail('invalid-state', 'The table game state is invalid')
  }

  if (
    state.pending !== null &&
    (!isPersistedPendingRound(state.pending) ||
      !pendingRoundMatchesGame(state.game, state.pending))
  ) {
    fail('invalid-state', 'The pending round does not match the current game')
  }
}

function assertNoPendingRound(state: TableCoreState, operation: string): void {
  if (state.pending) {
    fail(
      'round-in-progress',
      `Cannot ${operation} while round ${state.pending.id} is pending`,
    )
  }
}

function assertFreshShoe(
  state: TableCoreState,
  shoe: ShoeState,
  operation: string,
): void {
  if (
    shoe.id === state.game.shoe.id ||
    shoe.handNumber !== 0 ||
    shoe.cursor !== shoe.burnedCards ||
    shoe.needsShuffle
  ) {
    fail('invalid-shoe', `${operation} requires a different fresh shoe`)
  }
}

function assertValidNextGame(game: PersistedGameState): void {
  if (!isPersistedGameState(game)) {
    fail('invalid-state', 'The table transition produced an invalid game state')
  }
}

export function deriveTablePhase(state: TableCoreState): TablePhase {
  assertCoreState(state)
  if (!state.pending) return 'betting'

  return state.pending.revealedCount === state.pending.result.dealOrder.length
    ? 'ready-to-settle'
    : 'revealing'
}

export function prepareRoundState(
  state: TableCoreState,
  input: PrepareRoundStateInput,
): TableCoreState {
  assertCoreState(state)
  assertNoPendingRound(state, 'prepare a new round')

  if (state.game.history.some((record) => record.id === input.roundId)) {
    fail('duplicate-round', `Round ${input.roundId} has already been settled`)
  }

  const pending = preparePendingRound({
    game: state.game,
    bets: input.bets,
    playMode: input.playMode,
    roundId: input.roundId,
  })

  return {
    game: state.game,
    pending,
  }
}

export function advanceRevealState(
  state: TableCoreState,
  input: AdvanceRevealStateInput,
): TableCoreState {
  assertCoreState(state)
  const pending = state.pending
  if (!pending) {
    fail('no-pending-round', 'There is no pending round to reveal')
  }
  if (pending.id !== input.roundId) {
    fail(
      'round-mismatch',
      `Round ${input.roundId} does not match pending round ${pending.id}`,
    )
  }

  const expectedCount = pending.revealedCount + 1
  if (
    !Number.isSafeInteger(input.nextRevealedCount) ||
    input.nextRevealedCount !== expectedCount ||
    input.nextRevealedCount > pending.result.dealOrder.length
  ) {
    fail(
      'reveal-out-of-order',
      `Reveal progress must advance exactly once from ${pending.revealedCount}`,
    )
  }

  return {
    game: state.game,
    pending: {
      ...pending,
      revealedCount: input.nextRevealedCount,
    },
  }
}

export function settleRoundState(
  state: TableCoreState,
  input: SettleRoundStateInput,
): SettleRoundStateResult {
  assertCoreState(state)

  const existingRecord = state.game.history.find(
    (record) => record.id === input.roundId,
  )
  if (existingRecord) {
    if (state.pending) {
      fail(
        'settlement-conflict',
        `Settled round ${input.roundId} conflicts with a pending round`,
      )
    }
    return {
      status: 'already-settled',
      state,
      record: existingRecord,
    }
  }

  const pending = state.pending
  if (!pending) {
    fail('no-pending-round', `Round ${input.roundId} is not pending`)
  }
  if (pending.id !== input.roundId) {
    fail(
      'round-mismatch',
      `Round ${input.roundId} does not match pending round ${pending.id}`,
    )
  }
  if (pending.revealedCount !== pending.result.dealOrder.length) {
    fail(
      'round-not-revealed',
      `Round ${pending.id} cannot settle before every card is revealed`,
    )
  }

  const settlement = settleBets(pending.bets, pending.result)
  const balanceAfter =
    pending.balanceBefore - settlement.totalStake + settlement.totalReturned
  const record: RoundRecord = {
    ...pending.result,
    id: pending.id,
    shoeId: pending.shoeAfter.id,
    handNumber: pending.shoeAfter.handNumber,
    timestamp: input.settledAt,
    playMode: pending.playMode,
    bets: { ...pending.bets },
    settlement,
    balanceBefore: pending.balanceBefore,
    balanceAfter,
    cardsRemaining: cardsRemaining(pending.shoeAfter),
    rulesetVersion: RULESET_VERSION,
    shuffleVersion: pending.shoeAfter.shuffleVersion,
  }
  const nextGame: PersistedGameState = {
    ...state.game,
    balance: balanceAfter,
    shoe: pending.shoeAfter,
    history: [...state.game.history, record].slice(-MAX_HISTORY_LENGTH),
    lastBets:
      settlement.totalStake > 0
        ? { ...pending.bets }
        : state.game.lastBets,
  }
  assertValidNextGame(nextGame)

  return {
    status: 'settled',
    state: {
      game: nextGame,
      pending: null,
    },
    record,
  }
}

export function replaceShoeState(
  state: TableCoreState,
  input: ReplaceShoeStateInput,
): TableCoreState {
  assertCoreState(state)
  assertNoPendingRound(state, 'replace the shoe')
  assertFreshShoe(state, input.shoe, 'Shoe replacement')

  const nextGame: PersistedGameState = {
    ...state.game,
    shoe: input.shoe,
  }
  assertValidNextGame(nextGame)

  return {
    game: nextGame,
    pending: null,
  }
}

export function resetTableState(
  state: TableCoreState,
  input: ResetTableStateInput,
): TableCoreState {
  assertCoreState(state)
  assertNoPendingRound(state, 'reset the table')
  assertFreshShoe(state, input.shoe, 'Table reset')

  const nextGame: PersistedGameState = {
    version: 1,
    balance: input.balance,
    shoe: input.shoe,
    history: [],
    lastBets: { ...EMPTY_BETS },
    sessionStartedAt: input.sessionStartedAt,
  }
  assertValidNextGame(nextGame)

  return {
    game: nextGame,
    pending: null,
  }
}
