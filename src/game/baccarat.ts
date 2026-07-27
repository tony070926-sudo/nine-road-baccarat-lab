import type {
  Bets,
  Card,
  DealResult,
  Rank,
  Settlement,
  ShoeState,
  Suit,
  Winner,
} from '../types'

export const DECK_COUNT = 8
export const SHUFFLE_VERSION = 'crypto-fy-v1'
export const RULESET_VERSION = 'standard-commission-8d-v1'
export const CUT_CARDS_REMAINING = 14

export const THEORETICAL_PROBABILITIES: Record<Winner, number> = {
  banker: 0.458597423,
  player: 0.446246609,
  tie: 0.095155968,
}

export const PAIR_PROBABILITY = 0.074698795

export const HOUSE_EDGES = {
  banker: 0.010579058,
  player: 0.012350813,
  tie: 0.143596288,
  pair: 0.103614458,
} as const

export const EMPTY_BETS: Bets = {
  player: 0,
  banker: 0,
  tie: 0,
  playerPair: 0,
  bankerPair: 0,
}

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']
const RANKS: Rank[] = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
]

export type RandomInt = (maxExclusive: number) => number

let fallbackIdCounter = 0

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  fallbackIdCounter += 1
  return `shoe-${Date.now()}-${fallbackIdCounter}`
}

/**
 * Unbiased integer selection backed by Web Crypto. Rejection sampling avoids
 * modulo bias when maxExclusive does not divide 2^32.
 */
export const secureRandomInt: RandomInt = (maxExclusive) => {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError('maxExclusive must be a positive safe integer')
  }

  const range = 0x1_0000_0000
  const limit = range - (range % maxExclusive)
  const buffer = new Uint32Array(1)
  let value = range

  while (value >= limit) {
    crypto.getRandomValues(buffer)
    value = buffer[0]
  }

  return value % maxExclusive
}

export function createUnshuffledDeck(deckCount = DECK_COUNT): Card[] {
  const cards: Card[] = []

  for (let deck = 1; deck <= deckCount; deck += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({
          id: `${deck}-${suit}-${rank}`,
          suit,
          rank,
          deck,
        })
      }
    }
  }

  return cards
}

export function shuffleCards(cards: Card[], randomInt: RandomInt = secureRandomInt): Card[] {
  const shuffled = [...cards]

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1)
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }

  return shuffled
}

export function cardPoint(card: Card): number {
  if (card.rank === 'A') return 1
  if (card.rank === '10' || card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') {
    return 0
  }
  return Number(card.rank)
}

export function burnValue(card: Card): number {
  const value = cardPoint(card)
  return value === 0 ? 10 : value
}

export function handTotal(cards: Card[]): number {
  return cards.reduce((total, card) => total + cardPoint(card), 0) % 10
}

export function createShoe(
  randomInt: RandomInt = secureRandomInt,
  id = `S-${uuid().slice(0, 8).toUpperCase()}`,
): ShoeState {
  const cards = shuffleCards(createUnshuffledDeck(), randomInt)
  const burnCard = cards[0]
  const burnedCards = 1 + burnValue(burnCard)

  return {
    id,
    cards,
    cursor: burnedCards,
    cutAtRemaining: CUT_CARDS_REMAINING,
    burnCard,
    burnedCards,
    handNumber: 0,
    shuffleVersion: SHUFFLE_VERSION,
    needsShuffle: false,
  }
}

export function cardsRemaining(shoe: ShoeState): number {
  return shoe.cards.length - shoe.cursor
}

export function bankerShouldDraw(
  bankerTwoCardTotal: number,
  playerThirdCardPoint: number | null,
): boolean {
  if (playerThirdCardPoint === null) {
    return bankerTwoCardTotal <= 5
  }

  if (bankerTwoCardTotal <= 2) return true
  if (bankerTwoCardTotal === 3) return playerThirdCardPoint !== 8
  if (bankerTwoCardTotal === 4) return playerThirdCardPoint >= 2 && playerThirdCardPoint <= 7
  if (bankerTwoCardTotal === 5) return playerThirdCardPoint >= 4 && playerThirdCardPoint <= 7
  if (bankerTwoCardTotal === 6) return playerThirdCardPoint === 6 || playerThirdCardPoint === 7
  return false
}

function determineWinner(playerTotal: number, bankerTotal: number): Winner {
  if (playerTotal === bankerTotal) return 'tie'
  return playerTotal > bankerTotal ? 'player' : 'banker'
}

/**
 * Deals one Punto Banco round from the current shoe in the casino order:
 * Player, Banker, Player, Banker, then any mandatory third cards.
 */
export function dealRound(shoe: ShoeState): { shoe: ShoeState; result: DealResult } {
  if (cardsRemaining(shoe) < 6) {
    throw new Error('The shoe does not contain enough cards to complete a round')
  }

  const nextShoe: ShoeState = {
    ...shoe,
  }

  const dealOrder: Card[] = []
  const draw = (): Card => {
    const card = nextShoe.cards[nextShoe.cursor]
    if (!card) throw new Error('Unexpected end of shoe')
    nextShoe.cursor += 1
    dealOrder.push(card)
    return card
  }

  const playerCards = [draw()]
  const bankerCards = [draw()]
  playerCards.push(draw())
  bankerCards.push(draw())

  const initialPlayerTotal = handTotal(playerCards)
  const initialBankerTotal = handTotal(bankerCards)
  const natural = initialPlayerTotal >= 8 || initialBankerTotal >= 8

  if (!natural) {
    let playerThirdPoint: number | null = null

    if (initialPlayerTotal <= 5) {
      const playerThirdCard = draw()
      playerCards.push(playerThirdCard)
      playerThirdPoint = cardPoint(playerThirdCard)
    }

    if (bankerShouldDraw(initialBankerTotal, playerThirdPoint)) {
      bankerCards.push(draw())
    }
  }

  const playerTotal = handTotal(playerCards)
  const bankerTotal = handTotal(bankerCards)

  nextShoe.handNumber += 1
  nextShoe.needsShuffle = cardsRemaining(nextShoe) <= nextShoe.cutAtRemaining

  return {
    shoe: nextShoe,
    result: {
      playerCards,
      bankerCards,
      dealOrder,
      playerTotal,
      bankerTotal,
      winner: determineWinner(playerTotal, bankerTotal),
      natural,
      playerPair: playerCards[0].rank === playerCards[1].rank,
      bankerPair: bankerCards[0].rank === bankerCards[1].rank,
      cardsUsed: dealOrder.length,
    },
  }
}

export function totalBets(bets: Bets): number {
  return Object.values(bets).reduce((total, bet) => total + bet, 0)
}

export function validateBets(bets: Bets, balance: number): string | null {
  const values = Object.values(bets)
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    return '下注金额无效'
  }
  if (bets.player > 0 && bets.banker > 0) {
    return '标准牌桌不可同时下注庄与闲'
  }

  const total = totalBets(bets)
  if (total <= 0) return '请先放置至少一个筹码'
  if (total > balance) return '教学分余额不足'
  if (bets.player > 10_000 || bets.banker > 10_000) return '庄/闲单项上限为 10,000 分'
  if (bets.tie > 1_000 || bets.playerPair > 1_000 || bets.bankerPair > 1_000) {
    return '和/对子单项上限为 1,000 分'
  }
  return null
}

/**
 * Returns include the original stake. A Banker win returns 1.95× because its
 * net win is 0.95:1 after the traditional 5% commission.
 */
export function settleBets(bets: Bets, result: DealResult): Settlement {
  const totalStake = totalBets(bets)
  const breakdown: Settlement['breakdown'] = {}

  if (result.winner === 'player') {
    breakdown.player = bets.player * 2
  } else if (result.winner === 'banker') {
    breakdown.banker = bets.banker * 1.95
  } else {
    breakdown.player = bets.player
    breakdown.banker = bets.banker
    breakdown.tie = bets.tie * 9
  }

  if (result.playerPair) breakdown.playerPair = bets.playerPair * 12
  if (result.bankerPair) breakdown.bankerPair = bets.bankerPair * 12

  const totalReturned = Object.values(breakdown).reduce(
    (total, amount) => total + (amount ?? 0),
    0,
  )

  return {
    totalStake,
    totalReturned,
    net: totalReturned - totalStake,
    breakdown,
  }
}

export function createSeededRandomInt(seed = 0x12345678): RandomInt {
  let state = seed >>> 0

  return (maxExclusive) => {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError('maxExclusive must be a positive safe integer')
    }

    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    const unit = ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
    return Math.floor(unit * maxExclusive)
  }
}
