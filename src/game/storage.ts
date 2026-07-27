import type { PersistedGameState, PersistedPendingRound } from '../types'
import { resolvePlayMode } from './records'

const STORAGE_KEY = 'nine-road-baccarat:v1'
const PENDING_STORAGE_KEY = 'nine-road-baccarat:pending:v1'
const MAX_HISTORY = 500

export function loadGameState(): PersistedGameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedGameState
    if (parsed.version !== 1 || !parsed.shoe || !Array.isArray(parsed.history)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveGameState(state: PersistedGameState): boolean {
  try {
    const compactState: PersistedGameState = {
      ...state,
      history: state.history.slice(-MAX_HISTORY),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(compactState))
    return true
  } catch {
    // Storage can be unavailable in private browsing or under a strict policy.
    return false
  }
}

export function loadPendingRound(): PersistedPendingRound | null {
  try {
    const raw = localStorage.getItem(PENDING_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedPendingRound
    if (
      parsed.version !== 1 ||
      !parsed.result ||
      !parsed.shoeAfter ||
      !Number.isInteger(parsed.revealedCount)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function savePendingRound(state: PersistedPendingRound): boolean {
  try {
    localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    // The round remains playable in memory if storage is unavailable.
    return false
  }
}

export function clearPendingRound(): void {
  try {
    localStorage.removeItem(PENDING_STORAGE_KEY)
  } catch {
    // Storage can be unavailable in private browsing or under a strict policy.
  }
}

export function clearGameState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(PENDING_STORAGE_KEY)
  } catch {
    // Storage can be unavailable in private browsing or under a strict policy.
  }
}

function escapeCsv(value: string | number | boolean): string {
  const text = String(value)
  if (!/[",\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

export function historyToCsv(history: PersistedGameState['history']): string {
  const headers = [
    'shoe_id',
    'hand_number',
    'timestamp',
    'play_mode',
    'winner',
    'player_cards',
    'banker_cards',
    'player_total',
    'banker_total',
    'natural',
    'player_pair',
    'banker_pair',
    'total_stake',
    'net',
    'balance_after',
    'cards_remaining',
    'ruleset_version',
    'shuffle_version',
  ]

  const rows = history.map((record) => [
    record.shoeId,
    record.handNumber,
    record.timestamp,
    resolvePlayMode(record),
    record.winner,
    record.playerCards.map((card) => `${card.rank}-${card.suit}`).join('|'),
    record.bankerCards.map((card) => `${card.rank}-${card.suit}`).join('|'),
    record.playerTotal,
    record.bankerTotal,
    record.natural,
    record.playerPair,
    record.bankerPair,
    record.settlement.totalStake,
    record.settlement.net,
    record.balanceAfter,
    record.cardsRemaining,
    record.rulesetVersion,
    record.shuffleVersion,
  ])

  return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n')
}

export function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
