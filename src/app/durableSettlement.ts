import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { casinoAudio } from '../audio/casinoAudio'
import type { DealerSettlementMotion } from '../game/settlementMotion'
import { completeSettlementPresentationState } from '../game/tableEngine'
import type { TableCoordinator } from '../game/tableCoordinator'
import {
  tableVersionOf,
  type PersistedSettlementPresentationPending,
  type PersistedTableEnvelopeV2,
} from '../game/tableState'
import {
  rebuildWagerChipLedger,
  type WagerChipLedger,
} from '../game/chipPhysics'
import type { PersistedGameState, RoundRecord } from '../types'
import { OUTCOME_MOTION_MS } from './tableConfig'
import type { OutcomeMotion } from './tableTypes'
import {
  finalResultCall,
  formatNumber,
  outcomeLabel,
} from './tableUi'
import {
  settlementRecordIsVisible,
  type SettlementPresentation,
  type StartSettlementPresentationInput,
} from './useSettlementPresentation'

export interface DurableSettlementProjection {
  record: RoundRecord | null
  balance: number
  history: RoundRecord[]
}

export function initialDurableWagerLedger(
  game: PersistedGameState,
  marker: PersistedSettlementPresentationPending | null,
): WagerChipLedger | null {
  if (!marker) return null
  const record = game.history.at(-1)
  return record?.id === marker.roundId
    ? rebuildWagerChipLedger(record.bets)
    : null
}

export function displayedDurableSettlement(
  active: SettlementPresentation | null,
  marker: PersistedSettlementPresentationPending | null,
): SettlementPresentation | null {
  return active ??
    (marker ? { roundId: marker.roundId, state: 'not-started' } : null)
}

export function durableSettledCardState(
  sweepRoundId: string | null,
  settledRoundId: string | null,
  markerRoundId: string | null,
  clearedRoundId: string | null,
): 'sweeping' | 'shown' | 'cleared' {
  if (!settledRoundId) return 'shown'
  if (sweepRoundId === settledRoundId) return 'sweeping'
  if (markerRoundId === settledRoundId) return 'shown'
  return clearedRoundId === settledRoundId ? 'cleared' : 'shown'
}

export function visibleCurrentShoeRecords(
  game: PersistedGameState,
  presentation: SettlementPresentation | null,
  markerRoundId: string | null,
): RoundRecord[] {
  return game.history.filter(
    (record) =>
      record.shoeId === game.shoe.id &&
      settlementRecordIsVisible(record.id, presentation, markerRoundId),
  )
}

export function projectDurableSettlement(
  game: PersistedGameState,
  marker: PersistedSettlementPresentationPending | null | undefined,
): DurableSettlementProjection {
  if (!marker) {
    return { record: null, balance: game.balance, history: game.history }
  }
  const record = game.history.at(-1) ?? null
  if (!record || record.id !== marker.roundId) {
    return {
      record: null,
      balance: record?.balanceBefore ?? 0,
      history: game.history.slice(0, -1),
    }
  }
  return {
    record,
    balance: record.balanceBefore,
    history: game.history.slice(0, -1),
  }
}

export type DurableSettlementCompletion =
  | {
      status: 'committed' | 'already-complete'
      snapshot: PersistedTableEnvelopeV2
    }
  | {
      status: 'failed'
      snapshot?: PersistedTableEnvelopeV2
      reason: 'read' | 'marker' | 'transition' | 'commit'
    }

export type DurableSettlementSnapshotIntegrity =
  | 'complete'
  | 'recoverable-marker'
  | 'reject'

export function durableSettlementSnapshotIntegrity(
  snapshot: PersistedTableEnvelopeV2,
  roundId: string,
): DurableSettlementSnapshotIntegrity {
  const latestRoundMatches = snapshot.game.history.at(-1)?.id === roundId
  if (
    latestRoundMatches &&
    !snapshot.pending &&
    snapshot.presentationPending?.roundId === roundId
  ) {
    return 'recoverable-marker'
  }
  if (
    latestRoundMatches &&
    !snapshot.pending &&
    !snapshot.presentationPending &&
    snapshot.lastMutation === 'complete-presentation'
  ) {
    return 'complete'
  }
  return 'reject'
}

export function completeDurableSettlementPresentation(
  coordinator: TableCoordinator,
  roundId: string,
): DurableSettlementCompletion {
  const canonical = coordinator.read()
  if (canonical.status !== 'ok') return { status: 'failed', reason: 'read' }

  const marker = canonical.snapshot.presentationPending
  if (!marker) {
    if (
      durableSettlementSnapshotIntegrity(canonical.snapshot, roundId) ===
      'complete'
    ) {
      return { status: 'already-complete', snapshot: canonical.snapshot }
    }
    return { status: 'failed', reason: 'marker', snapshot: canonical.snapshot }
  }
  if (marker.roundId !== roundId) {
    return { status: 'failed', reason: 'marker', snapshot: canonical.snapshot }
  }

  let next
  try {
    next = completeSettlementPresentationState(canonical.snapshot, { roundId })
  } catch {
    return { status: 'failed', reason: 'transition', snapshot: canonical.snapshot }
  }
  const committed = coordinator.commit(
    tableVersionOf(canonical.snapshot),
    next,
    'complete-presentation',
  )
  if (committed.status === 'committed') {
    return { status: 'committed', snapshot: committed.snapshot }
  }
  if (
    committed.status === 'conflict' &&
    committed.current &&
    committed.current.lastMutation === 'complete-presentation' &&
    !committed.current.presentationPending &&
    committed.current.game.history.at(-1)?.id === roundId
  ) {
    return { status: 'already-complete', snapshot: committed.current }
  }
  return {
    status: 'failed',
    reason: 'commit',
    snapshot:
      committed.status === 'conflict'
        ? (committed.current ?? undefined)
        : undefined,
  }
}

export function focusFirstBetZone(): void {
  window.requestAnimationFrame(() => {
    if (document.querySelector('[role="dialog"]')) return
    document
      .querySelector<HTMLButtonElement>('.bet-zone:not(:disabled)')
      ?.focus({ preventScroll: true })
  })
}

interface StartDurableSettlementPresentationInput {
  record: RoundRecord
  wagerChipLedger: WagerChipLedger
  profile: StartSettlementPresentationInput['profile']
  startPresentation: (input: StartSettlementPresentationInput) => boolean
  onComplete: () => void
  setMotion: Dispatch<SetStateAction<DealerSettlementMotion | null>>
  setWagerLedger: Dispatch<SetStateAction<WagerChipLedger | null>>
  setOutcome: Dispatch<SetStateAction<OutcomeMotion | null>>
  outcomeTimerRef: MutableRefObject<number | null>
  scaleDuration: (durationMs: number, minimumMs?: number) => number
  announce: (message: string) => void
}

export function startDurableSettlementPresentation({
  record,
  wagerChipLedger,
  profile,
  startPresentation,
  onComplete,
  setMotion,
  setWagerLedger,
  setOutcome,
  outcomeTimerRef,
  scaleDuration,
  announce,
}: StartDurableSettlementPresentationInput): boolean {
  const shouldAnimate =
    record.playMode !== 'fly' && record.settlement.totalStake > 0
  setWagerLedger(shouldAnimate ? wagerChipLedger : null)
  setMotion(
    shouldAnimate
      ? {
          id: record.id,
          net: record.settlement.net,
          bets: { ...record.bets },
          returns: { ...record.settlement.breakdown },
          wagerChipLedger,
        }
      : null,
  )
  setOutcome({ id: record.id, winner: record.winner })
  if (outcomeTimerRef.current !== null) {
    window.clearTimeout(outcomeTimerRef.current)
  }
  outcomeTimerRef.current = window.setTimeout(
    () => {
      outcomeTimerRef.current = null
      setOutcome(null)
    },
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 30
      : scaleDuration(OUTCOME_MOTION_MS, 30),
  )

  casinoAudio.playSettlement(
    `${record.id}:settlement`,
    record.winner,
    record.settlement.net,
    record.playMode === 'fly',
  )
  const resultCall = casinoAudio.playDealerCall(
    `${record.id}:dealer-call:result`,
    finalResultCall(record),
  )
  announce(
    `本局${outcomeLabel(record.winner)}，净输赢${
      record.settlement.net > 0
        ? `正 ${formatNumber(record.settlement.net)}`
        : formatNumber(record.settlement.net)
    } 教学分。`,
  )
  const started = startPresentation({
    roundId: record.id,
    cardIds: record.dealOrder.map((card) => card.id),
    profile,
    awaitDealerSettlement: shouldAnimate,
    startAfter: resultCall,
    onComplete,
  })
  if (!started) {
    casinoAudio.cancelDealerCalls()
    setMotion(null)
    setWagerLedger(null)
  }
  return started
}
