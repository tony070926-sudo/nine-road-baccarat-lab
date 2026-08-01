import type { PersistedGameState, PersistedPendingRound } from '../types'

export interface TableCoreState {
  game: PersistedGameState
  pending: PersistedPendingRound | null
}

export type TableMutation =
  | 'bootstrap'
  | 'migrate-v1'
  | 'prepare-round'
  | 'reveal-card'
  | 'settle-round'
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

export function tableVersionOf(
  snapshot: PersistedTableEnvelopeV2,
): TableVersion {
  return {
    revision: snapshot.revision,
    commitId: snapshot.commitId,
  }
}
