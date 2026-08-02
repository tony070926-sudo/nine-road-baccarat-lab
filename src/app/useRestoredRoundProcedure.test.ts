import { describe, expect, it } from 'vitest'
import { EMPTY_BETS } from '../game/baccarat'
import type { Card, PendingRound, PlayMode } from '../types'
import {
  restoredRoundAnnouncement,
  restoredRoundPresentationState,
} from './useRestoredRoundProcedure'

function card(id: string): Card {
  return { id, rank: 'A', suit: 'spades', deck: 1 }
}

function round(
  cardIds = ['p1', 'b1', 'p2', 'b2', 'p3', 'b3'],
  playMode: PlayMode = 'bet',
): PendingRound {
  const dealOrder = cardIds.map(card)
  return {
    id: 'recovery-round',
    playMode,
    revealControl: 'dealer-reveal',
    bets: { ...EMPTY_BETS, player: 100 },
    balanceBefore: 10_000,
    sourceShoeId: 'recovery-shoe',
    sourceCursor: 0,
    shoeAfter: {
      id: 'recovery-shoe',
      cards: [],
      cursor: cardIds.length,
      cutAtRemaining: 14,
      burnCard: card('burn'),
      burnedCards: 1,
      handNumber: 1,
      shuffleVersion: 'test-shuffle',
      needsShuffle: false,
    },
    result: {
      playerCards: [dealOrder[0], dealOrder[2], ...dealOrder.slice(4, 5)],
      bankerCards: [dealOrder[1], dealOrder[3], ...dealOrder.slice(5, 6)],
      dealOrder,
      playerTotal: 0,
      bankerTotal: 0,
      winner: 'tie',
      natural: cardIds.length === 4,
      playerPair: false,
      bankerPair: false,
      cardsUsed: cardIds.length,
    },
  }
}

describe('restored round presentation', () => {
  it.each([
    [0, 0, true, false, false],
    [1, 4, false, true, false],
    [2, 4, false, true, false],
    [3, 4, false, true, false],
    [4, 4, true, false, false],
    [5, 5, true, false, false],
    [6, 6, false, false, true],
  ])(
    'maps durable count %i to %i dealt cards',
    (revealedCount, dealtCount, resuming, ready, fullyRevealed) => {
      const state = restoredRoundPresentationState(round(), revealedCount, true)
      expect(state.dealtCardIds).toHaveLength(dealtCount)
      expect(state.isResumingProcedure).toBe(resuming)
      expect(state.roundReady).toBe(ready)
      expect(state.isFullyRevealed).toBe(fullyRevealed)
    },
  )

  it('replays the point call for a fully revealed four-card round', () => {
    const state = restoredRoundPresentationState(
      round(['p1', 'b1', 'p2', 'b2']),
      4,
      true,
    )
    expect(state).toMatchObject({
      isFullyRevealed: true,
      isResumingProcedure: true,
      roundReady: false,
      flipLocked: true,
    })
  })

  it('keeps observer snapshots locked without inventing completed calls', () => {
    const pending = round()
    const state = restoredRoundPresentationState(pending, 4, false)
    expect(state).toMatchObject({
      isFullyRevealed: false,
      isResumingProcedure: false,
      roundReady: false,
      flipLocked: true,
    })
    expect(restoredRoundAnnouncement(pending, false, false)).toContain(
      '另一标签页',
    )
  })

  it('describes fly, dealer reveal, player squeeze, and settled recovery', () => {
    expect(restoredRoundAnnouncement(round([], 'fly'), false, true)).toContain(
      '飞牌',
    )
    expect(restoredRoundAnnouncement(round(), false, true)).toContain(
      '荷官将继续开牌',
    )
    expect(
      restoredRoundAnnouncement(
        { ...round(), revealControl: 'player-squeeze' },
        false,
        true,
      ),
    ).toContain('继续咪牌')
    expect(restoredRoundAnnouncement(round(), true, true)).toContain('完成结算')
  })
})
