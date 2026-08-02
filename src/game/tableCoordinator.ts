import type { PersistedGameState } from '../types'
import {
  commitTableEnvelope,
  migrateLegacyTable,
  readTableEnvelope,
  TABLE_STORAGE_KEY,
  type LegacyMigrationWarning,
  type TableCommitResult,
  type TableReadResult,
} from './tableStorage'
import type {
  PersistedTableEnvelopeV2,
  TableCoreState,
  TableMutation,
  TableVersion,
} from './tableState'

const TABLE_CHANNEL_NAME = 'nine-road-baccarat:table:v2'

interface TableCommitHint {
  type: 'table-commit'
  schemaVersion: 2
  revision: number
  commitId: string
  writerId: string
}

export type TableSyncListener = (snapshot: PersistedTableEnvelopeV2) => void

export type TableBootstrapResult =
  | {
      status: 'ready'
      snapshot: PersistedTableEnvelopeV2
      warning?: LegacyMigrationWarning
    }
  | { status: 'corrupt'; source: 'v2' | 'legacy' }
  | { status: 'unavailable' | 'conflict' | 'not-written' | 'indeterminate' }
  | { status: 'invalid'; reason: string }

function createWriterId(): string {
  return globalThis.crypto.randomUUID()
}

function isCommitHint(value: unknown): value is TableCommitHint {
  if (typeof value !== 'object' || value === null) return false
  const hint = value as Partial<TableCommitHint>
  return (
    hint.type === 'table-commit' &&
    hint.schemaVersion === 2 &&
    Number.isSafeInteger(hint.revision) &&
    (hint.revision ?? 0) > 0 &&
    typeof hint.commitId === 'string' &&
    hint.commitId.length > 0 &&
    typeof hint.writerId === 'string' &&
    hint.writerId.length > 0
  )
}

/**
 * Owns durable revision commits and cross-tab revision hints. Web Locks remain
 * the exclusive-writer boundary in the App; notifications are never trusted as
 * state and always trigger a fresh canonical localStorage read.
 */
export class TableCoordinator {
  readonly writerId: string

  private channel: BroadcastChannel | null = null
  private listeners = new Set<TableSyncListener>()
  private lastSeenRevision = 0
  private started = false

  constructor(writerId = createWriterId()) {
    this.writerId = writerId
  }

  start(): void {
    if (this.started || typeof window === 'undefined') return
    this.started = true
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(TABLE_CHANNEL_NAME)
      this.channel.addEventListener('message', this.handleBroadcast)
    }
    window.addEventListener('storage', this.handleStorage)
  }

  dispose(): void {
    if (!this.started || typeof window === 'undefined') return
    window.removeEventListener('storage', this.handleStorage)
    if (this.channel) {
      this.channel.removeEventListener('message', this.handleBroadcast)
      this.channel.close()
      this.channel = null
    }
    this.listeners.clear()
    this.started = false
  }

  subscribe(listener: TableSyncListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  read(): TableReadResult {
    return readTableEnvelope()
  }

  bootstrap(createInitialGame: () => PersistedGameState): TableBootstrapResult {
    const migration = migrateLegacyTable({ writerId: this.writerId })
    if (migration.status === 'migrated' || migration.status === 'already-v2') {
      this.acceptLocalSnapshot(migration.snapshot, migration.status === 'migrated')
      return {
        status: 'ready',
        snapshot: migration.snapshot,
        warning: migration.status === 'migrated' ? migration.warning : undefined,
      }
    }
    if (migration.status === 'corrupt') {
      return { status: 'corrupt', source: migration.source }
    }
    if (migration.status !== 'missing') {
      if (migration.status === 'invalid') return migration
      return { status: migration.status }
    }

    const committed = this.commit(null, {
      game: createInitialGame(),
      pending: null,
    }, 'bootstrap')
    if (committed.status === 'committed') {
      return { status: 'ready', snapshot: committed.snapshot }
    }
    if (committed.status === 'corrupt') {
      return { status: 'corrupt', source: 'v2' }
    }
    if (committed.status === 'invalid') return committed
    return { status: committed.status }
  }

  commit(
    expectedVersion: TableVersion | null,
    next: TableCoreState,
    mutation: TableMutation,
  ): TableCommitResult {
    const result = commitTableEnvelope({
      expectedVersion,
      next,
      writerId: this.writerId,
      mutation,
    })
    if (result.status === 'committed') {
      this.acceptLocalSnapshot(result.snapshot, true)
    }
    return result
  }

  /** Marks an independently reread canonical snapshot as already adopted. */
  adopt(snapshot: PersistedTableEnvelopeV2): void {
    this.acceptLocalSnapshot(snapshot, false)
  }

  private acceptLocalSnapshot(
    snapshot: PersistedTableEnvelopeV2,
    announce: boolean,
  ): void {
    this.lastSeenRevision = Math.max(this.lastSeenRevision, snapshot.revision)
    if (!announce) return
    this.channel?.postMessage({
      type: 'table-commit',
      schemaVersion: 2,
      revision: snapshot.revision,
      commitId: snapshot.commitId,
      writerId: this.writerId,
    } satisfies TableCommitHint)
  }

  private refreshFromCanonical = (minimumRevision: number): void => {
    const current = readTableEnvelope()
    if (
      current.status !== 'ok' ||
      current.snapshot.revision < minimumRevision ||
      current.snapshot.revision <= this.lastSeenRevision
    ) {
      return
    }
    this.lastSeenRevision = current.snapshot.revision
    this.listeners.forEach((listener) => listener(current.snapshot))
  }

  private handleBroadcast = (event: MessageEvent<unknown>): void => {
    if (!isCommitHint(event.data) || event.data.writerId === this.writerId) return
    this.refreshFromCanonical(event.data.revision)
  }

  private handleStorage = (event: StorageEvent): void => {
    if (event.key !== TABLE_STORAGE_KEY || event.newValue === null) return
    try {
      const hint = JSON.parse(event.newValue) as { revision?: unknown }
      if (!Number.isSafeInteger(hint.revision)) return
      this.refreshFromCanonical(hint.revision as number)
    } catch {
      // A malformed external write is deliberately ignored here. The next
      // attempted mutation reads the canonical key and fails closed as corrupt.
    }
  }
}
