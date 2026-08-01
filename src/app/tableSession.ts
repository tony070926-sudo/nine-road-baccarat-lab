import { EMPTY_BETS, createShoe } from '../game/baccarat'
import { resolveRevealControl } from '../game/reveal'
import { tableVersionOf, type TableVersion } from '../game/tableState'
import {
  readLegacyTableState,
  readTableEnvelope,
} from '../game/tableStorage'
import type {
  PendingRound,
  PersistedGameState,
  PersistedPendingRound,
} from '../types'
import { STARTING_BALANCE } from './tableConfig'

export interface InitialTableSession {
  game: PersistedGameState
  pendingRound: PendingRound | null
  revealedCount: number
  tableVersion: TableVersion | null
  storageFault: boolean
}

export function makeInitialState(): PersistedGameState {
  return {
    version: 1,
    balance: STARTING_BALANCE,
    shoe: createShoe(),
    history: [],
    lastBets: { ...EMPTY_BETS },
    sessionStartedAt: new Date().toISOString(),
  }
}

export function pendingRoundFromPersisted(
  storedPending: PersistedPendingRound,
): PendingRound {
  return {
    id: storedPending.id,
    playMode: storedPending.playMode,
    revealControl: resolveRevealControl(storedPending),
    bets: storedPending.bets,
    balanceBefore: storedPending.balanceBefore,
    sourceShoeId: storedPending.sourceShoeId,
    sourceCursor: storedPending.sourceCursor,
    shoeAfter: storedPending.shoeAfter,
    result: storedPending.result,
  }
}

export function loadInitialSession(): InitialTableSession {
  const v2 = readTableEnvelope()
  if (v2.status === 'ok') {
    return {
      game: v2.snapshot.game,
      pendingRound: v2.snapshot.pending
        ? pendingRoundFromPersisted(v2.snapshot.pending)
        : null,
      revealedCount: v2.snapshot.pending?.revealedCount ?? 0,
      tableVersion: tableVersionOf(v2.snapshot),
      storageFault: false,
    }
  }

  if (v2.status === 'corrupt' || v2.status === 'unavailable') {
    return {
      game: makeInitialState(),
      pendingRound: null,
      revealedCount: 0,
      tableVersion: null,
      storageFault: true,
    }
  }

  const legacy = readLegacyTableState()
  if (legacy.status === 'ok') {
    return {
      game: legacy.core.game,
      pendingRound: legacy.core.pending
        ? pendingRoundFromPersisted(legacy.core.pending)
        : null,
      revealedCount: legacy.core.pending?.revealedCount ?? 0,
      tableVersion: null,
      storageFault: false,
    }
  }

  return {
    game: makeInitialState(),
    pendingRound: null,
    revealedCount: 0,
    tableVersion: null,
    storageFault:
      legacy.status === 'corrupt' || legacy.status === 'unavailable',
  }
}
