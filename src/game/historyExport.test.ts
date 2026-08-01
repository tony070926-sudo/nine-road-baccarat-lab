import { describe, expect, it } from 'vitest'
import type { Card, RoundRecord } from '../types'
import { historyToCsv } from './historyExport'

function card(id: string, rank: Card['rank'], suit: Card['suit']): Card {
  return { id, rank, suit, deck: 1 }
}

describe('historyToCsv', () => {
  it('exports enough wager and balance fields to audit settlement', () => {
    const playerCards = [
      card('p1', '2', 'spades'),
      card('p2', '3', 'hearts'),
    ]
    const bankerCards = [
      card('b1', '4', 'clubs'),
      card('b2', '4', 'diamonds'),
    ]
    const record: RoundRecord = {
      id: 'round-audit-1',
      shoeId: 'shoe-audit-1',
      handNumber: 1,
      timestamp: '2026-07-31T00:00:00.000Z',
      playMode: 'bet',
      bets: {
        player: 0,
        banker: 100,
        tie: 0,
        playerPair: 0,
        bankerPair: 10,
      },
      playerCards,
      bankerCards,
      dealOrder: [
        playerCards[0],
        bankerCards[0],
        playerCards[1],
        bankerCards[1],
      ],
      playerTotal: 5,
      bankerTotal: 8,
      winner: 'banker',
      natural: true,
      playerPair: false,
      bankerPair: true,
      cardsUsed: 4,
      settlement: {
        totalStake: 110,
        totalReturned: 315,
        net: 205,
        commissionCharged: 5,
        breakdown: { banker: 195, bankerPair: 120 },
      },
      balanceBefore: 10_000,
      balanceAfter: 10_205,
      cardsRemaining: 400,
      rulesetVersion: 'test-rules',
      shuffleVersion: 'test-shuffle',
    }

    const [header, row] = historyToCsv([record]).split('\n')
    expect(header).toContain('round_id')
    expect(header).toContain('bet_banker')
    expect(header).toContain('total_returned')
    expect(header).toContain('commission_charged')
    expect(header).toContain('balance_before')
    expect(row).toContain('round-audit-1')
    expect(row).toContain(',100,0,0,10,110,315,5,205,10000,10205,')
  })
})
