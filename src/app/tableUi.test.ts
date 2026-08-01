import { describe, expect, it } from 'vitest'
import {
  EMPTY_BETS,
  createSeededRandomInt,
  createShoe,
  dealRound,
} from '../game/baccarat'
import type { PendingRound, RoundRecord, Winner } from '../types'
import {
  derivePendingRoundView,
  roundRevealInstruction,
  summarizeShoeRecords,
} from './tableUi'

function pendingRound(): PendingRound {
  const shoe = createShoe(createSeededRandomInt(42), 'TABLE-UI-SHOE')
  const dealt = dealRound(shoe)
  return {
    id: 'table-ui-round',
    playMode: 'bet',
    revealControl: 'player-squeeze',
    bets: { ...EMPTY_BETS, player: 100 },
    balanceBefore: 10_000,
    sourceShoeId: shoe.id,
    sourceCursor: shoe.cursor,
    shoeAfter: dealt.shoe,
    result: dealt.result,
  }
}

function record(
  id: string,
  winner: Winner,
  options: { natural?: boolean; playerPair?: boolean; bankerPair?: boolean } = {},
): RoundRecord {
  return {
    id,
    shoeId: 'summary-shoe',
    handNumber: Number(id.at(-1)) || 1,
    timestamp: '2026-08-01T00:00:00.000Z',
    playMode: 'fly',
    bets: { ...EMPTY_BETS },
    playerCards: [],
    bankerCards: [],
    dealOrder: [],
    playerTotal: 0,
    bankerTotal: 0,
    winner,
    natural: options.natural ?? false,
    playerPair: options.playerPair ?? false,
    bankerPair: options.bankerPair ?? false,
    cardsUsed: 4,
    settlement: {
      totalStake: 0,
      totalReturned: 0,
      commissionCharged: 0,
      net: 0,
      breakdown: {},
    },
    balanceBefore: 10_000,
    balanceAfter: 10_000,
    cardsRemaining: 400,
    rulesetVersion: 'test',
    shuffleVersion: 'test',
  }
}

describe('table UI selectors', () => {
  it('derives the visible and completed card view without mutating the round', () => {
    const round = pendingRound()
    const opening = derivePendingRoundView(round, 0)

    expect(opening.visibleCardIds.size).toBe(4)
    expect(opening.completedCardIds.size).toBe(0)
    expect(opening.nextCard?.id).toBe(round.result.playerCards[0].id)
    expect(opening.nextRequiresUser).toBe(true)
    expect(opening.playerTotal).toBeNull()

    const afterPlayerOpening = derivePendingRoundView(round, 2)
    expect(afterPlayerOpening.completedCardIds.size).toBe(2)
    expect(afterPlayerOpening.playerTotal).not.toBeNull()
    expect(afterPlayerOpening.nextSide).toBe('banker')
    expect(afterPlayerOpening.nextRequiresUser).toBe(false)
  })

  it('returns a stable empty shape outside a pending round', () => {
    const view = derivePendingRoundView(null, 9)
    expect(view.visibleCardIds.size).toBe(0)
    expect(view.completedCards).toEqual([])
    expect(view.nextCard).toBeNull()
    expect(view.displayTotal).toBe(0)
  })

  it('keeps a wagered dealer-reveal round fully automatic', () => {
    const round = { ...pendingRound(), revealControl: 'dealer-reveal' as const }
    const view = derivePendingRoundView(round, 0)

    expect(view.manualSides).toEqual([])
    expect(view.nextRequiresUser).toBe(false)
    expect(roundRevealInstruction(round)).toContain('已拒绝接牌')
  })

  it('summarizes winners, naturals and pairs in one selector', () => {
    expect(
      summarizeShoeRecords([
        record('round-1', 'banker', { natural: true }),
        record('round-2', 'player', { playerPair: true }),
        record('round-3', 'tie', { bankerPair: true }),
      ]),
    ).toEqual({
      count: 3,
      banker: 1,
      player: 1,
      tie: 1,
      naturals: 1,
      pairs: 2,
    })
  })
})
