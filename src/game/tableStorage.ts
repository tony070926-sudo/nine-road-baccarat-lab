import { pendingRoundMatchesGame } from './roundIntegrity'
import {
  isPersistedGameState,
  isPersistedPendingRound,
} from './stateValidation'
import type {
  PersistedTableEnvelopeV2,
  TableCoreState,
  TableMutation,
  TableVersion,
} from './tableState'

export const TABLE_STORAGE_KEY = 'nine-road-baccarat:table:v2'
export const LEGACY_GAME_STORAGE_KEY = 'nine-road-baccarat:v1'
export const LEGACY_PENDING_STORAGE_KEY = 'nine-road-baccarat:pending:v1'

const TABLE_ENVELOPE_KEYS = [
  'schemaVersion',
  'revision',
  'commitId',
  'updatedAt',
  'lastWriterId',
  'lastMutation',
  'game',
  'pending',
] as const

const TABLE_MUTATIONS = new Set<TableMutation>([
  'bootstrap',
  'migrate-v1',
  'prepare-round',
  'reveal-card',
  'settle-round',
  'replace-shoe',
  'reset',
])

type UnknownRecord = Record<string, unknown>

export type TableReadResult =
  | { status: 'ok'; snapshot: PersistedTableEnvelopeV2 }
  | { status: 'missing' }
  | { status: 'corrupt'; raw: string }
  | { status: 'unavailable' }

export type LegacyMigrationWarning =
  | 'invalid-pending-discarded'
  | 'stale-pending-discarded'

export type LegacyTableReadResult =
  | {
      status: 'ok'
      core: TableCoreState
      warning?: LegacyMigrationWarning
    }
  | { status: 'missing' }
  | { status: 'corrupt'; key: string; raw: string | null }
  | { status: 'unavailable' }

export interface CommitTableEnvelopeInput {
  expectedVersion: TableVersion | null
  next: TableCoreState
  writerId: string
  mutation: TableMutation
  commitId?: string
  updatedAt?: string
}

export type TableCommitResult =
  | { status: 'committed'; snapshot: PersistedTableEnvelopeV2 }
  | {
      status: 'conflict'
      current: PersistedTableEnvelopeV2 | null
    }
  | { status: 'corrupt'; raw: string }
  | { status: 'unavailable' }
  | { status: 'invalid'; reason: string }
  | { status: 'not-written' }
  | { status: 'indeterminate'; readback: TableReadResult }

export interface MigrateLegacyTableInput {
  writerId: string
  commitId?: string
  updatedAt?: string
}

export type TableMigrationResult =
  | {
      status: 'migrated'
      snapshot: PersistedTableEnvelopeV2
      warning?: LegacyMigrationWarning
      legacyCleanupComplete: boolean
    }
  | {
      status: 'already-v2'
      snapshot: PersistedTableEnvelopeV2
      legacyCleanupComplete: boolean
    }
  | { status: 'missing' }
  | {
      status: 'corrupt'
      source: 'v2' | 'legacy'
      raw: string | null
      key?: string
    }
  | { status: 'unavailable' }
  | {
      status: 'conflict'
      current: PersistedTableEnvelopeV2 | null
    }
  | { status: 'invalid'; reason: string }
  | { status: 'not-written' }
  | { status: 'indeterminate'; readback: TableReadResult }

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyEnvelopeKeys(value: UnknownRecord): boolean {
  const allowed = new Set<string>(TABLE_ENVELOPE_KEYS)
  return (
    TABLE_ENVELOPE_KEYS.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isTableCoreState(value: unknown): value is TableCoreState {
  if (!isRecord(value)) return false
  const game = value.game
  const pending = value.pending
  if (!isPersistedGameState(game)) return false
  if (pending === null) return true
  return (
    isPersistedPendingRound(pending) && pendingRoundMatchesGame(game, pending)
  )
}

export function isPersistedTableEnvelopeV2(
  value: unknown,
): value is PersistedTableEnvelopeV2 {
  if (
    !isRecord(value) ||
    !hasOnlyEnvelopeKeys(value) ||
    value.schemaVersion !== 2 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !isNonEmptyString(value.commitId) ||
    !isIsoTimestamp(value.updatedAt) ||
    !isNonEmptyString(value.lastWriterId) ||
    !TABLE_MUTATIONS.has(value.lastMutation as TableMutation)
  ) {
    return false
  }

  return isTableCoreState({ game: value.game, pending: value.pending })
}

export function readTableEnvelope(): TableReadResult {
  let raw: string | null
  try {
    raw = localStorage.getItem(TABLE_STORAGE_KEY)
  } catch {
    return { status: 'unavailable' }
  }

  if (raw === null) return { status: 'missing' }

  try {
    const parsed: unknown = JSON.parse(raw)
    return isPersistedTableEnvelopeV2(parsed)
      ? { status: 'ok', snapshot: parsed }
      : { status: 'corrupt', raw }
  } catch {
    return { status: 'corrupt', raw }
  }
}

function readLegacyRawValues():
  | { status: 'ok'; gameRaw: string | null; pendingRaw: string | null }
  | { status: 'unavailable' } {
  try {
    return {
      status: 'ok',
      gameRaw: localStorage.getItem(LEGACY_GAME_STORAGE_KEY),
      pendingRaw: localStorage.getItem(LEGACY_PENDING_STORAGE_KEY),
    }
  } catch {
    return { status: 'unavailable' }
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

export function readLegacyTableState(): LegacyTableReadResult {
  const raw = readLegacyRawValues()
  if (raw.status === 'unavailable') return raw

  if (raw.gameRaw === null) {
    return raw.pendingRaw === null
      ? { status: 'missing' }
      : {
          status: 'corrupt',
          key: LEGACY_GAME_STORAGE_KEY,
          raw: null,
        }
  }

  const parsedGame = parseJson(raw.gameRaw)
  if (!isPersistedGameState(parsedGame)) {
    return {
      status: 'corrupt',
      key: LEGACY_GAME_STORAGE_KEY,
      raw: raw.gameRaw,
    }
  }

  if (raw.pendingRaw === null) {
    return {
      status: 'ok',
      core: { game: parsedGame, pending: null },
    }
  }

  const parsedPending = parseJson(raw.pendingRaw)
  if (!isPersistedPendingRound(parsedPending)) {
    return {
      status: 'ok',
      core: { game: parsedGame, pending: null },
      warning: 'invalid-pending-discarded',
    }
  }

  if (!pendingRoundMatchesGame(parsedGame, parsedPending)) {
    return {
      status: 'ok',
      core: { game: parsedGame, pending: null },
      warning: 'stale-pending-discarded',
    }
  }

  return {
    status: 'ok',
    core: { game: parsedGame, pending: parsedPending },
  }
}

function versionsMatch(
  expected: TableVersion,
  actual: PersistedTableEnvelopeV2,
): boolean {
  return (
    expected.revision === actual.revision &&
    expected.commitId === actual.commitId
  )
}

function defaultCommitId(): string {
  return globalThis.crypto.randomUUID()
}

export function commitTableEnvelope({
  expectedVersion,
  next,
  writerId,
  mutation,
  commitId = defaultCommitId(),
  updatedAt = new Date().toISOString(),
}: CommitTableEnvelopeInput): TableCommitResult {
  if (
    expectedVersion !== null &&
    (!Number.isSafeInteger(expectedVersion.revision) ||
      expectedVersion.revision < 1 ||
      !isNonEmptyString(expectedVersion.commitId))
  ) {
    return { status: 'invalid', reason: 'invalid expected table version' }
  }
  if (!isTableCoreState(next)) {
    return { status: 'invalid', reason: 'invalid table core state' }
  }

  const current = readTableEnvelope()
  if (current.status === 'unavailable') return current
  if (current.status === 'corrupt') return current

  if (current.status === 'missing') {
    if (expectedVersion !== null) {
      return { status: 'conflict', current: null }
    }
  } else if (
    expectedVersion === null ||
    !versionsMatch(expectedVersion, current.snapshot)
  ) {
    return { status: 'conflict', current: current.snapshot }
  }

  const currentRevision = current.status === 'ok' ? current.snapshot.revision : 0
  if (currentRevision >= Number.MAX_SAFE_INTEGER) {
    return { status: 'invalid', reason: 'table revision exhausted' }
  }

  const candidate: PersistedTableEnvelopeV2 = {
    schemaVersion: 2,
    revision: currentRevision + 1,
    commitId,
    updatedAt,
    lastWriterId: writerId,
    lastMutation: mutation,
    game: next.game,
    pending: next.pending,
  }
  if (!isPersistedTableEnvelopeV2(candidate)) {
    return { status: 'invalid', reason: 'invalid table envelope metadata' }
  }

  let serialized: string
  try {
    serialized = JSON.stringify(candidate)
  } catch {
    return { status: 'invalid', reason: 'table envelope is not serializable' }
  }

  try {
    localStorage.setItem(TABLE_STORAGE_KEY, serialized)
  } catch {
    return { status: 'not-written' }
  }

  const readback = readTableEnvelope()
  if (
    readback.status !== 'ok' ||
    JSON.stringify(readback.snapshot) !== serialized
  ) {
    return { status: 'indeterminate', readback }
  }

  return { status: 'committed', snapshot: readback.snapshot }
}

function cleanupLegacyStorage(): boolean {
  let complete = true
  for (const key of [LEGACY_GAME_STORAGE_KEY, LEGACY_PENDING_STORAGE_KEY]) {
    try {
      localStorage.removeItem(key)
    } catch {
      complete = false
    }
  }
  return complete
}

export function migrateLegacyTable({
  writerId,
  commitId,
  updatedAt,
}: MigrateLegacyTableInput): TableMigrationResult {
  const current = readTableEnvelope()
  if (current.status === 'ok') {
    return {
      status: 'already-v2',
      snapshot: current.snapshot,
      legacyCleanupComplete: cleanupLegacyStorage(),
    }
  }
  if (current.status === 'corrupt') {
    return { status: 'corrupt', source: 'v2', raw: current.raw }
  }
  if (current.status === 'unavailable') return current

  const legacy = readLegacyTableState()
  if (legacy.status === 'missing' || legacy.status === 'unavailable') {
    return legacy
  }
  if (legacy.status === 'corrupt') {
    return {
      status: 'corrupt',
      source: 'legacy',
      key: legacy.key,
      raw: legacy.raw,
    }
  }

  const committed = commitTableEnvelope({
    expectedVersion: null,
    next: legacy.core,
    writerId,
    mutation: 'migrate-v1',
    commitId,
    updatedAt,
  })
  if (committed.status === 'corrupt') {
    return { status: 'corrupt', source: 'v2', raw: committed.raw }
  }
  if (committed.status !== 'committed') return committed

  return {
    status: 'migrated',
    snapshot: committed.snapshot,
    warning: legacy.warning,
    legacyCleanupComplete: cleanupLegacyStorage(),
  }
}
