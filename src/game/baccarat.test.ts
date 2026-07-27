import { describe, expect, it } from 'vitest'
import type { Card, DealResult, Rank, ShoeState, Suit } from '../types'
import {
  EMPTY_BETS,
  bankerShouldDraw,
  cardPoint,
  createSeededRandomInt,
  createShoe,
  createUnshuffledDeck,
  dealRound,
  handTotal,
  settleBets,
  shuffleCards,
  validateBets,
} from './baccarat'

function card(rank: Rank, suit: Suit = 'spades', id = `${rank}-${suit}`): Card {
  return { id, rank, suit, deck: 1 }
}

function shoeWithTopCards(cards: Card[]): ShoeState {
  return {
    id: 'TEST-SHOE',
    cards: [...cards, ...createUnshuffledDeck().slice(cards.length)],
    cursor: 0,
    cutAtRemaining: 14,
    burnCard: card('A'),
    burnedCards: 0,
    handNumber: 0,
    shuffleVersion: 'test-sequence',
    needsShuffle: false,
  }
}

function result(overrides: Partial<DealResult>): DealResult {
  return {
    playerCards: [card('4'), card('3', 'hearts')],
    bankerCards: [card('5'), card('2', 'hearts')],
    dealOrder: [],
    playerTotal: 7,
    bankerTotal: 7,
    winner: 'tie',
    natural: false,
    playerPair: false,
    bankerPair: false,
    cardsUsed: 4,
    ...overrides,
  }
}

describe('eight-deck shoe', () => {
  it('contains 416 unique physical cards with eight copies of each rank/suit', () => {
    const cards = createUnshuffledDeck()
    expect(cards).toHaveLength(416)
    expect(new Set(cards.map((item) => item.id))).toHaveLength(416)

    const aceOfSpades = cards.filter(
      (item) => item.rank === 'A' && item.suit === 'spades',
    )
    expect(aceOfSpades).toHaveLength(8)
  })

  it('shuffles deterministically when a seeded test RNG is injected', () => {
    const first = shuffleCards(createUnshuffledDeck(), createSeededRandomInt(42))
    const second = shuffleCards(createUnshuffledDeck(), createSeededRandomInt(42))
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id))
    expect(first.map((item) => item.id)).not.toEqual(
      createUnshuffledDeck().map((item) => item.id),
    )
  })

  it('burns the exposed card and its baccarat burn value', () => {
    const shoe = createShoe(createSeededRandomInt(7), 'AUDIT-SHOE')
    const expectedBurn = 1 + (cardPoint(shoe.burnCard) || 10)
    expect(shoe.cursor).toBe(expectedBurn)
    expect(shoe.burnedCards).toBe(expectedBurn)
  })
})

describe('card values and draw rules', () => {
  it('scores A as one, faces as zero, and takes only the units digit', () => {
    expect(cardPoint(card('A'))).toBe(1)
    expect(cardPoint(card('K'))).toBe(0)
    expect(handTotal([card('8'), card('7')])).toBe(5)
    expect(handTotal([card('K'), card('Q')])).toBe(0)
  })

  it('implements the complete banker third-card matrix', () => {
    for (let third = 0; third <= 9; third += 1) {
      expect(bankerShouldDraw(0, third)).toBe(true)
      expect(bankerShouldDraw(1, third)).toBe(true)
      expect(bankerShouldDraw(2, third)).toBe(true)
      expect(bankerShouldDraw(3, third)).toBe(third !== 8)
      expect(bankerShouldDraw(4, third)).toBe(third >= 2 && third <= 7)
      expect(bankerShouldDraw(5, third)).toBe(third >= 4 && third <= 7)
      expect(bankerShouldDraw(6, third)).toBe(third === 6 || third === 7)
      expect(bankerShouldDraw(7, third)).toBe(false)
    }
    expect(bankerShouldDraw(5, null)).toBe(true)
    expect(bankerShouldDraw(6, null)).toBe(false)
  })

  it('stops both hands when either opening hand is a natural', () => {
    const testShoe = shoeWithTopCards([
      card('9', 'spades', 'p1'),
      card('7', 'spades', 'b1'),
      card('K', 'hearts', 'p2'),
      card('Q', 'hearts', 'b2'),
      card('2', 'clubs', 'unused'),
    ])
    const { result: dealt } = dealRound(testShoe)
    expect(dealt.natural).toBe(true)
    expect(dealt.cardsUsed).toBe(4)
    expect(dealt.playerTotal).toBe(9)
    expect(dealt.winner).toBe('player')
  })

  it('deals third cards in Player-then-Banker order', () => {
    const testShoe = shoeWithTopCards([
      card('2', 'spades', 'p1'),
      card('3', 'spades', 'b1'),
      card('3', 'hearts', 'p2'),
      card('2', 'hearts', 'b2'),
      card('4', 'clubs', 'p3'),
      card('3', 'clubs', 'b3'),
    ])
    const { result: dealt } = dealRound(testShoe)
    expect(dealt.dealOrder.map((item) => item.id)).toEqual([
      'p1',
      'b1',
      'p2',
      'b2',
      'p3',
      'b3',
    ])
    expect(dealt.playerCards).toHaveLength(3)
    expect(dealt.bankerCards).toHaveLength(3)
    expect(dealt.playerTotal).toBe(9)
    expect(dealt.bankerTotal).toBe(8)
    expect(dealt.winner).toBe('player')
  })
})

describe('settlement', () => {
  it('pays a Banker win at 1.95x including returned stake', () => {
    const settlement = settleBets(
      { ...EMPTY_BETS, banker: 100 },
      result({ winner: 'banker', bankerTotal: 8, playerTotal: 6 }),
    )
    expect(settlement.totalReturned).toBe(195)
    expect(settlement.net).toBe(95)
  })

  it('pushes Player and Banker stakes on a tie and pays Tie 8:1 net', () => {
    const settlement = settleBets(
      { ...EMPTY_BETS, player: 100, tie: 10 },
      result({ winner: 'tie' }),
    )
    expect(settlement.totalStake).toBe(110)
    expect(settlement.totalReturned).toBe(190)
    expect(settlement.net).toBe(80)
  })

  it('pays each qualifying pair independently at 11:1 net', () => {
    const settlement = settleBets(
      { ...EMPTY_BETS, playerPair: 10, bankerPair: 20 },
      result({ playerPair: true, bankerPair: true }),
    )
    expect(settlement.totalReturned).toBe(360)
    expect(settlement.net).toBe(330)
  })

  it('rejects conflicting main bets and out-of-range side bets', () => {
    expect(validateBets({ ...EMPTY_BETS, player: 10, banker: 10 }, 1_000)).toMatch(
      /同时下注/,
    )
    expect(validateBets({ ...EMPTY_BETS, tie: 1_010 }, 10_000)).toMatch(/上限/)
  })
})
