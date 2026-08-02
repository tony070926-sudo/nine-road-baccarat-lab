import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PersistedGameState,
  PersistedPendingRound,
  PlayMode,
} from '../types'
import {
  EMPTY_BETS,
  createSeededRandomInt,
  createShoe,
  dealRound,
} from '../game/baccarat'
import {
  advanceRevealState,
  prepareRoundState,
  settleRoundState,
} from '../game/tableEngine'
import { TABLE_STORAGE_KEY } from '../game/tableStorage'
import type { PersistedTableEnvelopeV2 } from '../game/tableState'
import { loadInitialSession, pendingRoundFromPersisted } from './tableSession'

function storedPending(playMode: PlayMode): PersistedPendingRound {
  const sourceShoe = createShoe(
    createSeededRandomInt(20260802),
    'SESSION-REVEAL-CONTROL',
  )
  const dealt = dealRound(sourceShoe)
  return {
    version: 1,
    id: `session-${playMode}`,
    playMode,
    bets:
      playMode === 'fly' ? { ...EMPTY_BETS } : { ...EMPTY_BETS, player: 100 },
    balanceBefore: 10_000,
    sourceShoeId: sourceShoe.id,
    sourceCursor: sourceShoe.cursor,
    shoeAfter: dealt.shoe,
    result: dealt.result,
    revealedCount: 0,
  }
}

function settledEnvelope(): PersistedTableEnvelopeV2 {
  const game: PersistedGameState = {
    version: 1,
    balance: 10_000,
    shoe: createShoe(
      createSeededRandomInt(20260803),
      'SESSION-SETTLEMENT-PRESENTATION',
    ),
    history: [],
    lastBets: { ...EMPTY_BETS },
    sessionStartedAt: '2026-08-02T00:00:00.000Z',
  }
  let state = prepareRoundState(
    { game, pending: null },
    {
      bets: { ...EMPTY_BETS, player: 100 },
      playMode: 'bet',
      revealControl: 'dealer-reveal',
      roundId: 'session-settlement-round',
    },
  )
  while (state.pending) {
    const nextRevealedCount = state.pending.revealedCount + 1
    if (nextRevealedCount > state.pending.result.dealOrder.length) break
    state = advanceRevealState(state, {
      roundId: state.pending.id,
      nextRevealedCount,
    })
  }
  const settled = settleRoundState(state, {
    roundId: 'session-settlement-round',
    settledAt: '2026-08-02T00:01:00.000Z',
  }).state
  return {
    schemaVersion: 2,
    revision: 2,
    commitId: 'session-settlement-commit',
    updatedAt: '2026-08-02T00:01:00.000Z',
    lastWriterId: 'session-writer',
    lastMutation: 'settle-round',
    ...settled,
  }
}

function installEnvelope(value: PersistedTableEnvelopeV2): void {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) =>
      key === TABLE_STORAGE_KEY ? JSON.stringify(value) : null,
    ),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pendingRoundFromPersisted', () => {
  it('normalizes legacy reveal control defaults by play mode', () => {
    expect(pendingRoundFromPersisted(storedPending('bet')).revealControl).toBe(
      'player-squeeze',
    )
    expect(pendingRoundFromPersisted(storedPending('fly')).revealControl).toBe(
      'dealer-reveal',
    )
  })

  it('preserves an explicit dealer reveal choice for a wagered round', () => {
    expect(
      pendingRoundFromPersisted({
        ...storedPending('bet'),
        revealControl: 'dealer-reveal',
      }).revealControl,
    ).toBe('dealer-reveal')
  })
})

describe('loadInitialSession', () => {
  it('restores a durable settlement marker for the presentation recovery loop', () => {
    const envelope = settledEnvelope()
    installEnvelope(envelope)

    const session = loadInitialSession()

    expect(session.pendingRound).toBeNull()
    expect(session.presentationPending).toEqual({
      type: 'settlement',
      roundId: 'session-settlement-round',
    })
    expect(session.game.history).toHaveLength(1)
  })

  it('normalizes a legacy marker-free v2 envelope to null in memory', () => {
    const envelope = settledEnvelope()
    delete envelope.presentationPending
    installEnvelope(envelope)

    expect(loadInitialSession().presentationPending).toBeNull()
  })
})
