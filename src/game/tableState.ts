import type { PersistedGameState, PersistedPendingRound } from '../types'

export interface PersistedSettlementPresentationPending {
  type: 'settlement'
  roundId: string
}

export interface TableCoreState {
  game: PersistedGameState
  pending: PersistedPendingRound | null
  /**
   * Optional only so envelopes written before durable settlement presentation
   * remain readable. Every new commit normalizes an omitted value to null.
   */
  presentationPending?: PersistedSettlementPresentationPending | null
}

export type TableMutation =
  | 'bootstrap'
  | 'migrate-v1'
  | 'prepare-round'
  | 'reveal-card'
  | 'settle-round'
  | 'complete-presentation'
  | 'replace-shoe'
  | 'reset'

export interface TableVersion {
  revision: number
  commitId: string
}

export interface PersistedTableEnvelopeV2 extends TableCoreState {
  schemaVersion: 2
  revision: number
  commitId: string
  updatedAt: string
  lastWriterId: string
  lastMutation: TableMutation
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPersistedSettlementPresentationPending(
  value: unknown,
): value is PersistedSettlementPresentationPending {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  return (
    keys.length === 2 &&
    Object.hasOwn(value, 'type') &&
    Object.hasOwn(value, 'roundId') &&
    value.type === 'settlement' &&
    typeof value.roundId === 'string' &&
    value.roundId.trim().length > 0
  )
}

/**
 * A settlement presentation is an exclusive durable table phase: its round is
 * already in the ledger, no round remains pending, and it must be the latest
 * recorded hand so no later mutation can overtake the dealer procedure.
 */
export function settlementPresentationMatchesGame(
  game: PersistedGameState,
  pending: PersistedPendingRound | null,
  presentationPending: unknown,
): boolean {
  if (presentationPending === undefined || presentationPending === null) {
    return true
  }
  return (
    pending === null &&
    isPersistedSettlementPresentationPending(presentationPending) &&
    game.history.at(-1)?.id === presentationPending.roundId
  )
}

export function tableVersionOf(
  snapshot: PersistedTableEnvelopeV2,
): TableVersion {
  return {
    revision: snapshot.revision,
    commitId: snapshot.commitId,
  }
}
