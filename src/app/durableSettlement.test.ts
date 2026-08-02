import { describe, expect, it, vi } from 'vitest'
import { EMPTY_BETS, createSeededRandomInt, createShoe } from '../game/baccarat'
import { prepareRoundState, settleRoundState } from '../game/tableEngine'
import type { TableCoordinator } from '../game/tableCoordinator'
import type { PersistedTableEnvelopeV2 } from '../game/tableState'
import type { PersistedGameState, RoundRecord } from '../types'
import {
  displayedDurableSettlement,
  completeDurableSettlementPresentation,
  durableSettledCardState,
  durableSettlementSnapshotIntegrity,
  projectDurableSettlement,
  visibleCurrentShoeRecords,
} from './durableSettlement'

function pendingSettlementEnvelope(): PersistedTableEnvelopeV2 {
  const game: PersistedGameState = {
    version: 1,
    balance: 10_000,
    shoe: createShoe(createSeededRandomInt(13), 'durable-completion-shoe'),
    history: [],
    lastBets: { ...EMPTY_BETS },
    sessionStartedAt: '2026-08-02T00:00:00.000Z',
  }
  const prepared = prepareRoundState(
    { game, pending: null, presentationPending: null },
    {
      bets: { ...EMPTY_BETS, player: 100 },
      playMode: 'bet',
      revealControl: 'dealer-reveal',
      roundId: 'durable-completion-round',
    },
  )
  if (!prepared.pending) throw new Error('Expected a pending round')
  const settled = settleRoundState(
    {
      ...prepared,
      pending: {
        ...prepared.pending,
        revealedCount: prepared.pending.result.dealOrder.length,
      },
    },
    {
      roundId: prepared.pending.id,
      settledAt: '2026-08-02T00:01:00.000Z',
    },
  )
  return {
    schemaVersion: 2,
    revision: 2,
    commitId: 'durable-completion-commit',
    updatedAt: '2026-08-02T00:01:00.000Z',
    lastWriterId: 'durable-completion-writer',
    lastMutation: 'settle-round',
    ...settled.state,
  }
}

function completionCoordinator(
  snapshot: PersistedTableEnvelopeV2,
  commitResult?: ReturnType<TableCoordinator['commit']>,
) {
  const harness = {
    read: vi.fn(() => ({ status: 'ok' as const, snapshot })),
    commit: vi.fn((...args: Parameters<TableCoordinator['commit']>) => {
      void args
      return commitResult
    }),
  }
  return {
    harness,
    coordinator: harness as unknown as TableCoordinator,
  }
}

function gameWithHistory(): PersistedGameState {
  const record = {
    id: 'round-1',
    balanceBefore: 10_000,
    balanceAfter: 10_095,
  } as RoundRecord
  return {
    version: 1,
    balance: record.balanceAfter,
    shoe: createShoe(createSeededRandomInt(11), 'durable-projection-shoe'),
    history: [{ ...record, shoeId: 'durable-projection-shoe' }],
    lastBets: { ...EMPTY_BETS, player: 100 },
    sessionStartedAt: '2026-08-02T00:00:00.000Z',
  }
}

describe('projectDurableSettlement', () => {
  it('hides the unpresented record and post-settlement balance', () => {
    const game = gameWithHistory()
    expect(
      projectDurableSettlement(game, {
        type: 'settlement',
        roundId: 'round-1',
      }),
    ).toEqual({ record: game.history[0], balance: 10_000, history: [] })
  })

  it('exposes canonical state when no matching marker exists', () => {
    const game = gameWithHistory()
    expect(projectDurableSettlement(game, null)).toEqual({
      record: null,
      balance: game.balance,
      history: game.history,
    })
  })

  it('fails closed when a marker does not match the latest record', () => {
    const game = gameWithHistory()
    expect(
      projectDurableSettlement(game, {
        type: 'settlement',
        roundId: 'unexpected-round',
      }),
    ).toEqual({ record: null, balance: 10_000, history: [] })
  })

  it('keeps the marked road hidden until the active recording phase', () => {
    const game = gameWithHistory()
    expect(visibleCurrentShoeRecords(game, null, 'round-1')).toEqual([])
    expect(
      visibleCurrentShoeRecords(
        game,
        { roundId: 'round-1', state: 'recording-road' },
        'round-1',
      ),
    ).toEqual(game.history)
  })

  it('keeps recovered cards shown until the actual sweep begins', () => {
    expect(durableSettledCardState(null, 'round-1', 'round-1', 'round-1')).toBe(
      'shown',
    )
    expect(
      durableSettledCardState('round-1', 'round-1', 'round-1', 'round-1'),
    ).toBe('sweeping')
    expect(durableSettledCardState(null, null, null, null)).toBe('shown')
  })

  it('provides a locked display phase for passive marker observers', () => {
    expect(
      displayedDurableSettlement(null, {
        type: 'settlement',
        roundId: 'round-1',
      }),
    ).toEqual({ roundId: 'round-1', state: 'not-started' })
  })
})

describe('completeDurableSettlementPresentation', () => {
  it('commits the explicit completion mutation', () => {
    const pending = pendingSettlementEnvelope()
    const completed = {
      ...pending,
      revision: pending.revision + 1,
      lastMutation: 'complete-presentation' as const,
      presentationPending: null,
    }
    const { coordinator, harness } = completionCoordinator(pending, {
      status: 'committed',
      snapshot: completed,
    })

    expect(
      completeDurableSettlementPresentation(
        coordinator,
        pending.presentationPending!.roundId,
      ),
    ).toEqual({ status: 'committed', snapshot: completed })
    expect(harness.commit).toHaveBeenCalledOnce()
    expect(harness.commit.mock.calls[0]?.[2]).toBe('complete-presentation')
  })

  it('fails closed when the marker disappeared before its own commit', () => {
    const pending = pendingSettlementEnvelope()
    const withoutMarker = { ...pending, presentationPending: null }
    const { coordinator, harness } = completionCoordinator(withoutMarker)

    expect(
      completeDurableSettlementPresentation(
        coordinator,
        pending.presentationPending!.roundId,
      ),
    ).toMatchObject({ status: 'failed', reason: 'marker' })
    expect(harness.commit).not.toHaveBeenCalled()
  })

  it('accepts a canonical explicit completion before attempting another commit', () => {
    const pending = pendingSettlementEnvelope()
    const completed = {
      ...pending,
      revision: pending.revision + 1,
      lastMutation: 'complete-presentation' as const,
      presentationPending: null,
    }
    const { coordinator, harness } = completionCoordinator(completed)

    expect(
      completeDurableSettlementPresentation(
        coordinator,
        pending.presentationPending!.roundId,
      ),
    ).toEqual({ status: 'already-complete', snapshot: completed })
    expect(harness.commit).not.toHaveBeenCalled()
  })

  it('accepts only an explicit competing completion as idempotent', () => {
    const pending = pendingSettlementEnvelope()
    const roundId = pending.presentationPending!.roundId
    const completed = {
      ...pending,
      revision: pending.revision + 1,
      lastMutation: 'complete-presentation' as const,
      presentationPending: null,
    }
    const accepted = completionCoordinator(pending, {
      status: 'conflict',
      current: completed,
    })
    expect(
      completeDurableSettlementPresentation(accepted.coordinator, roundId),
    ).toEqual({ status: 'already-complete', snapshot: completed })

    const overwritten = { ...completed, lastMutation: 'reset' as const }
    const rejected = completionCoordinator(pending, {
      status: 'conflict',
      current: overwritten,
    })
    expect(
      completeDurableSettlementPresentation(rejected.coordinator, roundId),
    ).toMatchObject({ status: 'failed', reason: 'commit' })
  })
})

describe('durableSettlementSnapshotIntegrity', () => {
  it('only releases a failed round for its explicit completion', () => {
    const marked = pendingSettlementEnvelope()
    const roundId = marked.presentationPending!.roundId
    expect(durableSettlementSnapshotIntegrity(marked, roundId)).toBe(
      'recoverable-marker',
    )
    expect(
      durableSettlementSnapshotIntegrity(
        { ...marked, lastMutation: 'reset', presentationPending: null },
        roundId,
      ),
    ).toBe('reject')
    expect(
      durableSettlementSnapshotIntegrity(
        {
          ...marked,
          lastMutation: 'complete-presentation',
          presentationPending: null,
        },
        roundId,
      ),
    ).toBe('complete')
  })
})
