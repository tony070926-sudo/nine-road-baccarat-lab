import { describe, expect, it } from 'vitest'
import type { Card, DealResult, PendingRound } from '../types'
import {
  thirdCardDealerCall,
  thirdCardDealIsPending,
} from './thirdCardCallGate'

function card(id: string): Card {
  return { id, rank: 'A', suit: 'spades', deck: 1 }
}

function result(): DealResult {
  const [p1, b1, p2, b2, p3, b3] = [
    card('p1'),
    card('b1'),
    card('p2'),
    card('b2'),
    card('p3'),
    card('b3'),
  ]
  return {
    playerCards: [p1, p2, p3],
    bankerCards: [b1, b2, b3],
    dealOrder: [p1, b1, p2, b2, p3, b3],
    playerTotal: 3,
    bankerTotal: 3,
    winner: 'tie',
    natural: false,
    playerPair: false,
    bankerPair: false,
    cardsUsed: 6,
  }
}

function round(): PendingRound {
  return {
    id: 'round-third-card-call',
    playMode: 'bet',
    revealControl: 'dealer-reveal',
    bets: { player: 100, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 },
    balanceBefore: 10_000,
    sourceShoeId: 'shoe-third-card-call',
    sourceCursor: 0,
    shoeAfter: {
      id: 'shoe-third-card-call',
      cards: [],
      cursor: 6,
      cutAtRemaining: 14,
      burnCard: card('burn'),
      burnedCards: 1,
      handNumber: 1,
      shuffleVersion: 'test',
      needsShuffle: false,
    },
    result: result(),
  }
}

describe('third-card dealer call gate', () => {
  it('names the hand that receives the third card', () => {
    const deal = result()
    expect(thirdCardDealerCall(deal, 'p3')).toBe('闲家补牌')
    expect(thirdCardDealerCall(deal, 'b3')).toBe('庄家补牌')
    expect(thirdCardDealerCall(deal, 'p1')).toBeNull()
    expect(thirdCardDealerCall(deal, 'missing')).toBeNull()
  })

  it('accepts only the still-current, not-yet-dealt next card', () => {
    const pending = round()
    const input = {
      round: pending,
      roundId: pending.id,
      revealedCount: 4,
      expectedRevealedCount: 4,
      cardId: 'p3',
      dealtCardIds: new Set(['p1', 'b1', 'p2', 'b2']),
    }
    expect(thirdCardDealIsPending(input)).toBe(true)
    expect(thirdCardDealIsPending({ ...input, revealedCount: 5 })).toBe(false)
    expect(
      thirdCardDealIsPending({
        ...input,
        dealtCardIds: new Set([...input.dealtCardIds, 'p3']),
      }),
    ).toBe(false)
  })

})
