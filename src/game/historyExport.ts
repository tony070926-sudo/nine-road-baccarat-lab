import type { PersistedGameState } from '../types'
import { resolvePlayMode } from './records'

function escapeCsv(value: string | number | boolean): string {
  const text = String(value)
  if (!/[",\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

export function historyToCsv(history: PersistedGameState['history']): string {
  const headers = [
    'round_id',
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
    'bet_player',
    'bet_banker',
    'bet_tie',
    'bet_player_pair',
    'bet_banker_pair',
    'total_stake',
    'total_returned',
    'commission_charged',
    'net',
    'balance_before',
    'balance_after',
    'cards_remaining',
    'ruleset_version',
    'shuffle_version',
  ]

  const rows = history.map((record) => [
    record.id,
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
    record.bets.player,
    record.bets.banker,
    record.bets.tie,
    record.bets.playerPair,
    record.bets.bankerPair,
    record.settlement.totalStake,
    record.settlement.totalReturned,
    record.settlement.commissionCharged ??
      (record.winner === 'banker' ? record.bets.banker * 0.05 : 0),
    record.settlement.net,
    record.balanceBefore,
    record.balanceAfter,
    record.cardsRemaining,
    record.rulesetVersion,
    record.shuffleVersion,
  ])

  return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n')
}

export function downloadTextFile(
  filename: string,
  content: string,
  type: string,
): void {
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
