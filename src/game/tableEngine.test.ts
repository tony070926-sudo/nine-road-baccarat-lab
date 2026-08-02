import { describe, expect, it } from 'vitest'
import type { Bets, PersistedGameState, ShoeState } from '../types'
import {
  EMPTY_BETS,
  RULESET_VERSION,
  createSeededRandomInt,
  createShoe,
  settleBets,
} from './baccarat'
import {
  TableEngineError,
  advanceRevealState,
  completeSettlementPresentationState,
  deriveTablePhase,
  prepareRoundState,
  replaceShoeState,
  resetTableState,
  settleRoundState,
  type TableEngineErrorCode,
} from './tableEngine'
import type { TableCoreState } from './tableState'

const PLAYER_BETS: Bets = { ...EMPTY_BETS, player: 100 }

function freshShoe(seed: number, id: string): ShoeState {
  return createShoe(createSeededRandomInt(seed), id)
}

function initialState(seed = 101): TableCoreState {
  const game: PersistedGameState = {
    version: 1,
    balance: 10_000,
    shoe: freshShoe(seed, `S-ENGINE-${seed}`),
    history: [],
    lastBets: { ...EMPTY_BETS },
    sessionStartedAt: '2026-08-01T00:00:00.000Z',
  }
  return { game, pending: null }
}

function preparedState(
  state = initialState(),
  roundId = 'round-engine-1',
): TableCoreState {
  return prepareRoundState(state, {
    bets: PLAYER_BETS,
    playMode: 'bet',
    revealControl: 'player-squeeze',
    roundId,
  })
}

function fullyReveal(state: TableCoreState): TableCoreState {
  if (!state.pending) throw new Error('Expected a pending round')
  let next = state
  const { id } = state.pending
  while (next.pending) {
    const target = next.pending.revealedCount + 1
    if (target > next.pending.result.dealOrder.length) break
    next = advanceRevealState(next, {
      roundId: id,
      nextRevealedCount: target,
    })
  }
  return next
}

function expectEngineError(
  action: () => unknown,
  code: TableEngineErrorCode,
): void {
  let thrown: unknown
  try {
    action()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(TableEngineError)
  expect((thrown as TableEngineError).code).toBe(code)
}

describe('tableEngine', () => {
  it('derives betting, revealing, and ready-to-settle from durable state', () => {
    const betting = initialState()
    const revealing = preparedState(betting)
    const ready = fullyReveal(revealing)
    const settling = settleRoundState(ready, {
      roundId: 'round-engine-1',
      settledAt: '2026-08-01T00:01:00.000Z',
    }).state

    expect(deriveTablePhase(betting)).toBe('betting')
    expect(deriveTablePhase(revealing)).toBe('revealing')
    expect(deriveTablePhase(ready)).toBe('ready-to-settle')
    expect(deriveTablePhase(settling)).toBe('settling')
  })

  it('prepares one immutable outcome without advancing the durable game', () => {
    const current = initialState()
    const next = preparedState(current)

    expect(next.game).toBe(current.game)
    expect(current.pending).toBeNull()
    expect(next.pending).toMatchObject({
      id: 'round-engine-1',
      revealedCount: 0,
      balanceBefore: current.game.balance,
      sourceShoeId: current.game.shoe.id,
      sourceCursor: current.game.shoe.cursor,
      revealControl: 'player-squeeze',
    })
    expect(next.pending?.shoeAfter.handNumber).toBe(1)
  })

  it('allows reveal progress to advance by exactly one card', () => {
    const current = preparedState()
    const next = advanceRevealState(current, {
      roundId: 'round-engine-1',
      nextRevealedCount: 1,
    })

    expect(current.pending?.revealedCount).toBe(0)
    expect(next.pending?.revealedCount).toBe(1)
    expect(next.game).toBe(current.game)

    expectEngineError(
      () =>
        advanceRevealState(current, {
          roundId: 'round-engine-1',
          nextRevealedCount: 2,
        }),
      'reveal-out-of-order',
    )
    expectEngineError(
      () =>
        advanceRevealState(next, {
          roundId: 'another-round',
          nextRevealedCount: 2,
        }),
      'round-mismatch',
    )
    expectEngineError(
      () =>
        advanceRevealState(initialState(), {
          roundId: 'round-engine-1',
          nextRevealedCount: 1,
        }),
      'no-pending-round',
    )
  })

  it('settles only a fully revealed round and atomically clears pending', () => {
    const prepared = preparedState()
    expectEngineError(
      () =>
        settleRoundState(prepared, {
          roundId: 'round-engine-1',
          settledAt: '2026-08-01T00:01:00.000Z',
        }),
      'round-not-revealed',
    )

    const ready = fullyReveal(prepared)
    const pending = ready.pending
    if (!pending) throw new Error('Expected a pending round')
    const expectedSettlement = settleBets(pending.bets, pending.result)
    const result = settleRoundState(ready, {
      roundId: pending.id,
      settledAt: '2026-08-01T00:01:00.000Z',
    })

    expect(result.status).toBe('settled')
    expect(result.state.pending).toBeNull()
    expect(result.state.presentationPending).toEqual({
      type: 'settlement',
      roundId: pending.id,
    })
    expect(ready.pending).toBe(pending)
    expect(result.record).toMatchObject({
      id: pending.id,
      timestamp: '2026-08-01T00:01:00.000Z',
      settlement: expectedSettlement,
      rulesetVersion: RULESET_VERSION,
      shoeId: pending.shoeAfter.id,
      handNumber: pending.shoeAfter.handNumber,
    })
    expect(result.state.game.balance).toBe(
      pending.balanceBefore + expectedSettlement.net,
    )
    expect(result.state.game.shoe).toBe(pending.shoeAfter)
    expect(result.state.game.history).toHaveLength(1)
    expect(result.state.game.lastBets).toEqual(PLAYER_BETS)
  })

  it('detects an idempotent settlement replay without changing state', () => {
    const ready = fullyReveal(preparedState())
    const first = settleRoundState(ready, {
      roundId: 'round-engine-1',
      settledAt: '2026-08-01T00:01:00.000Z',
    })
    const replay = settleRoundState(first.state, {
      roundId: 'round-engine-1',
      settledAt: '2026-08-01T23:59:59.000Z',
    })

    expect(replay.status).toBe('already-settled')
    expect(replay.state).toBe(first.state)
    expect(replay.record).toBe(first.record)
    expect(replay.record.timestamp).toBe('2026-08-01T00:01:00.000Z')
    expect(replay.state.game.history).toHaveLength(1)
  })

  it('clears only the matching durable settlement presentation', () => {
    const settled = settleRoundState(fullyReveal(preparedState()), {
      roundId: 'round-engine-1',
      settledAt: '2026-08-01T00:01:00.000Z',
    }).state

    expectEngineError(
      () =>
        completeSettlementPresentationState(settled, {
          roundId: 'another-round',
        }),
      'round-mismatch',
    )

    const completed = completeSettlementPresentationState(settled, {
      roundId: 'round-engine-1',
    })
    expect(completed.game).toBe(settled.game)
    expect(completed.pending).toBeNull()
    expect(completed.presentationPending).toBeNull()
    expect(deriveTablePhase(completed)).toBe('betting')
    expectEngineError(
      () =>
        completeSettlementPresentationState(completed, {
          roundId: 'round-engine-1',
        }),
      'no-presentation-pending',
    )
  })

  it('preserves the latest wager across a no-bet fly round', () => {
    const wageredReady = fullyReveal(preparedState())
    const wageredSettlement = settleRoundState(wageredReady, {
      roundId: 'round-engine-1',
      settledAt: '2026-08-01T00:01:00.000Z',
    }).state
    const wagered = completeSettlementPresentationState(wageredSettlement, {
      roundId: 'round-engine-1',
    })
    const flyPrepared = prepareRoundState(wagered, {
      bets: EMPTY_BETS,
      playMode: 'fly',
      revealControl: 'dealer-reveal',
      roundId: 'round-engine-fly',
    })
    const flyReady = fullyReveal(flyPrepared)
    const fly = settleRoundState(flyReady, {
      roundId: 'round-engine-fly',
      settledAt: '2026-08-01T00:02:00.000Z',
    })

    expect(fly.status).toBe('settled')
    expect(fly.record.settlement.totalStake).toBe(0)
    expect(fly.state.game.balance).toBe(wagered.game.balance)
    expect(fly.state.game.lastBets).toEqual(PLAYER_BETS)
  })

  it('refuses every competing table mutation while a round is pending', () => {
    const pending = preparedState()
    const replacement = freshShoe(202, 'S-ENGINE-REPLACEMENT')

    expectEngineError(
      () =>
        prepareRoundState(pending, {
          bets: PLAYER_BETS,
          playMode: 'bet',
          revealControl: 'player-squeeze',
          roundId: 'round-engine-2',
        }),
      'round-in-progress',
    )
    expectEngineError(
      () => replaceShoeState(pending, { shoe: replacement }),
      'round-in-progress',
    )
    expectEngineError(
      () =>
        resetTableState(pending, {
          shoe: replacement,
          balance: 10_000,
          sessionStartedAt: '2026-08-01T01:00:00.000Z',
        }),
      'round-in-progress',
    )
  })

  it('refuses every competing table mutation while settlement presentation is pending', () => {
    const settling = settleRoundState(fullyReveal(preparedState()), {
      roundId: 'round-engine-1',
      settledAt: '2026-08-01T00:01:00.000Z',
    }).state
    const replacement = freshShoe(203, 'S-ENGINE-PRESENTATION-BLOCK')

    expectEngineError(
      () =>
        prepareRoundState(settling, {
          bets: PLAYER_BETS,
          playMode: 'bet',
          revealControl: 'player-squeeze',
          roundId: 'round-engine-2',
        }),
      'round-in-progress',
    )
    expectEngineError(
      () => replaceShoeState(settling, { shoe: replacement }),
      'round-in-progress',
    )
    expectEngineError(
      () =>
        resetTableState(settling, {
          shoe: replacement,
          balance: 10_000,
          sessionStartedAt: '2026-08-01T01:00:00.000Z',
        }),
      'round-in-progress',
    )
  })

  it('replaces only with a different fresh shoe while preserving the ledger', () => {
    const settlement = settleRoundState(fullyReveal(preparedState()), {
      roundId: 'round-engine-1',
      settledAt: '2026-08-01T00:01:00.000Z',
    }).state
    const settled = completeSettlementPresentationState(settlement, {
      roundId: 'round-engine-1',
    })
    const replacement = freshShoe(303, 'S-ENGINE-REPLACEMENT')
    const replaced = replaceShoeState(settled, { shoe: replacement })

    expect(replaced.pending).toBeNull()
    expect(replaced.game.shoe).toBe(replacement)
    expect(replaced.game.history).toBe(settled.game.history)
    expect(replaced.game.balance).toBe(settled.game.balance)
    expect(replaced.game.lastBets).toBe(settled.game.lastBets)
    expect(replaced.game.sessionStartedAt).toBe(settled.game.sessionStartedAt)

    expectEngineError(
      () => replaceShoeState(settled, { shoe: settled.game.shoe }),
      'invalid-shoe',
    )
  })

  it('resets the complete table from externally supplied time, balance, and shoe', () => {
    const settlement = settleRoundState(fullyReveal(preparedState()), {
      roundId: 'round-engine-1',
      settledAt: '2026-08-01T00:01:00.000Z',
    }).state
    const settled = completeSettlementPresentationState(settlement, {
      roundId: 'round-engine-1',
    })
    const replacement = freshShoe(404, 'S-ENGINE-RESET')
    const reset = resetTableState(settled, {
      shoe: replacement,
      balance: 25_000,
      sessionStartedAt: '2026-08-01T02:00:00.000Z',
    })

    expect(reset).toEqual({
      game: {
        version: 1,
        balance: 25_000,
        shoe: replacement,
        history: [],
        lastBets: EMPTY_BETS,
        sessionStartedAt: '2026-08-01T02:00:00.000Z',
      },
      pending: null,
      presentationPending: null,
    })
  })

  it('rejects duplicate round ids after settlement', () => {
    const settlement = settleRoundState(fullyReveal(preparedState()), {
      roundId: 'round-engine-1',
      settledAt: '2026-08-01T00:01:00.000Z',
    }).state
    const settled = completeSettlementPresentationState(settlement, {
      roundId: 'round-engine-1',
    })

    expectEngineError(
      () =>
        prepareRoundState(settled, {
          bets: PLAYER_BETS,
          playMode: 'bet',
          revealControl: 'player-squeeze',
          roundId: 'round-engine-1',
        }),
      'duplicate-round',
    )
  })
})
