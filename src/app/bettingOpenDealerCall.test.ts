import { describe, expect, it } from 'vitest'
import {
  EMPTY_BETS,
  RULESET_VERSION,
  cardsRemaining,
  createSeededRandomInt,
  createShoe,
  dealRound,
  settleBets,
} from '../game/baccarat'
import type { PersistedTableEnvelopeV2 } from '../game/tableState'
import type { PersistedPendingRound, RoundRecord } from '../types'
import {
  BETTING_OPEN_DEALER_CALL_HISTORY_LIMIT,
  consumeBettingOpenDealerCallEvent,
  createBettingOpenDealerCallState,
} from './bettingOpenDealerCall'

function completedPresentationSnapshot(): PersistedTableEnvelopeV2 {
  const dealt = dealRound(
    createShoe(createSeededRandomInt(42), 'BETTING-OPEN-SHOE'),
  )
  const roundId = 'BETTING-OPEN-ROUND'
  const settlement = settleBets(EMPTY_BETS, dealt.result)
  const record: RoundRecord = {
    ...dealt.result,
    id: roundId,
    shoeId: dealt.shoe.id,
    handNumber: dealt.shoe.handNumber,
    timestamp: '2026-08-02T00:00:00.000Z',
    playMode: 'fly',
    bets: { ...EMPTY_BETS },
    settlement,
    balanceBefore: 10_000,
    balanceAfter: 10_000,
    cardsRemaining: cardsRemaining(dealt.shoe),
    rulesetVersion: RULESET_VERSION,
    shuffleVersion: dealt.shoe.shuffleVersion,
  }

  return {
    schemaVersion: 2,
    revision: 7,
    commitId: 'BETTING-OPEN-COMPLETION-7',
    updatedAt: '2026-08-02T00:00:00.000Z',
    lastWriterId: 'local-writer',
    lastMutation: 'complete-presentation',
    pending: null,
    presentationPending: null,
    game: {
      version: 1,
      balance: 10_000,
      shoe: dealt.shoe,
      history: [record],
      lastBets: { ...EMPTY_BETS },
      sessionStartedAt: '2026-08-01T00:00:00.000Z',
    },
  }
}

function pendingRound(
  snapshot: PersistedTableEnvelopeV2,
): PersistedPendingRound {
  const record = snapshot.game.history.at(-1)
  if (!record) throw new Error('Test snapshot has no completed round')
  return {
    version: 1,
    id: 'BETTING-OPEN-PENDING',
    playMode: 'fly',
    revealControl: 'dealer-reveal',
    bets: { ...EMPTY_BETS },
    balanceBefore: snapshot.game.balance,
    sourceShoeId: snapshot.game.shoe.id,
    sourceCursor: snapshot.game.shoe.cursor,
    shoeAfter: snapshot.game.shoe,
    result: record,
    revealedCount: 0,
  }
}

type CallCandidate = Parameters<
  typeof consumeBettingOpenDealerCallEvent
>[1]

describe('betting-open dealer call state', () => {
  it('atomically consumes one stable event per completed hand', () => {
    const state = createBettingOpenDealerCallState()
    const snapshot = completedPresentationSnapshot()
    const input: CallCandidate = {
      completionStatus: 'committed',
      roundId: snapshot.game.history.at(-1)!.id,
      writerId: snapshot.lastWriterId,
      snapshot,
    }

    expect(consumeBettingOpenDealerCallEvent(state, input)).toBe(
      `betting-open:${snapshot.game.shoe.id}:hand-${snapshot.game.shoe.handNumber}:${input.roundId}:${snapshot.revision}:${snapshot.commitId}`,
    )
    expect(consumeBettingOpenDealerCallEvent(state, input)).toBeNull()
    expect(
      consumeBettingOpenDealerCallEvent(state, {
        ...input,
        snapshot: {
          ...snapshot,
          revision: snapshot.revision + 1,
          commitId: 'BETTING-OPEN-COMPLETION-RETRY',
        },
      }),
    ).toBeNull()
    expect(state.completionTokens.size).toBe(1)
    expect(state.roundKeys.size).toBe(1)
  })

  it('keeps only bounded recent events and still rejects a recent duplicate', () => {
    const state = createBettingOpenDealerCallState()
    const baseSnapshot = completedPresentationSnapshot()
    const baseRecord = baseSnapshot.game.history.at(-1)!
    let latestInput: CallCandidate | null = null

    for (
      let index = 0;
      index < BETTING_OPEN_DEALER_CALL_HISTORY_LIMIT * 4;
      index += 1
    ) {
      const roundId = `BETTING-OPEN-ROUND-${index}`
      const shoeId = `BETTING-OPEN-SHOE-${Math.floor(index / 60)}`
      const handNumber = (index % 60) + 1
      const snapshot: PersistedTableEnvelopeV2 = {
        ...baseSnapshot,
        revision: index + 1,
        commitId: `BETTING-OPEN-COMPLETION-${index}`,
        game: {
          ...baseSnapshot.game,
          shoe: {
            ...baseSnapshot.game.shoe,
            id: shoeId,
            handNumber,
          },
          history: [
            {
              ...baseRecord,
              id: roundId,
              shoeId,
              handNumber,
            },
          ],
        },
      }
      latestInput = {
        completionStatus: 'committed',
        roundId,
        writerId: snapshot.lastWriterId,
        snapshot,
      }

      expect(consumeBettingOpenDealerCallEvent(state, latestInput)).not.toBeNull()
      expect(state.completionTokens.size).toBeLessThanOrEqual(
        BETTING_OPEN_DEALER_CALL_HISTORY_LIMIT,
      )
      expect(state.roundKeys.size).toBeLessThanOrEqual(
        BETTING_OPEN_DEALER_CALL_HISTORY_LIMIT,
      )
    }

    expect(state.completionTokens.size).toBe(
      BETTING_OPEN_DEALER_CALL_HISTORY_LIMIT,
    )
    expect(state.roundKeys.size).toBe(BETTING_OPEN_DEALER_CALL_HISTORY_LIMIT)
    expect(latestInput).not.toBeNull()
    expect(consumeBettingOpenDealerCallEvent(state, latestInput!)).toBeNull()
    expect(state.completionTokens.size).toBe(
      BETTING_OPEN_DEALER_CALL_HISTORY_LIMIT,
    )
    expect(state.roundKeys.size).toBe(BETTING_OPEN_DEALER_CALL_HISTORY_LIMIT)
  })

  it('rejects hydration, foreign writers and incomplete snapshots', () => {
    const snapshot = completedPresentationSnapshot()
    const roundId = snapshot.game.history.at(-1)!.id
    const valid: CallCandidate = {
      completionStatus: 'committed',
      roundId,
      writerId: snapshot.lastWriterId,
      snapshot,
    }
    const cases: Array<{ name: string; input: CallCandidate }> = [
      {
        name: 'already-complete hydration',
        input: { ...valid, completionStatus: 'already-complete' },
      },
      {
        name: 'foreign writer',
        input: { ...valid, writerId: 'another-writer' },
      },
      {
        name: 'wrong mutation',
        input: {
          ...valid,
          snapshot: { ...snapshot, lastMutation: 'reset' },
        },
      },
      {
        name: 'uncleared marker',
        input: {
          ...valid,
          snapshot: {
            ...snapshot,
            presentationPending: { type: 'settlement', roundId },
          },
        },
      },
      {
        name: 'pending round',
        input: {
          ...valid,
          snapshot: { ...snapshot, pending: pendingRound(snapshot) },
        },
      },
      {
        name: 'stale history',
        input: { ...valid, roundId: 'another-round' },
      },
    ]

    for (const testCase of cases) {
      const state = createBettingOpenDealerCallState()
      expect(
        consumeBettingOpenDealerCallEvent(state, testCase.input),
        testCase.name,
      ).toBeNull()
      expect(state.completionTokens.size, testCase.name).toBe(0)
      expect(state.roundKeys.size, testCase.name).toBe(0)
    }
  })
})
