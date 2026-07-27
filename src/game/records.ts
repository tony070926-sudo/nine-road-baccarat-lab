import type { PlayMode, RoundRecord } from '../types'

/**
 * Older browser records did not persist a play mode. A zero-stake legacy
 * round is equivalent to today's explicit fly mode and remains auditable.
 */
export function resolvePlayMode(record: RoundRecord): PlayMode {
  if (record.playMode) return record.playMode
  return record.settlement.totalStake === 0 ? 'fly' : 'bet'
}

export function isFlyRound(record: RoundRecord): boolean {
  return resolvePlayMode(record) === 'fly'
}
