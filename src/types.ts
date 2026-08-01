export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs'
export type Rank =
  | 'A'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K'

export interface Card {
  id: string
  suit: Suit
  rank: Rank
  deck: number
}

export type Winner = 'player' | 'banker' | 'tie'

export interface DealResult {
  playerCards: Card[]
  bankerCards: Card[]
  dealOrder: Card[]
  playerTotal: number
  bankerTotal: number
  winner: Winner
  natural: boolean
  playerPair: boolean
  bankerPair: boolean
  cardsUsed: number
}

export interface ShoeState {
  id: string
  cards: Card[]
  cursor: number
  cutAtRemaining: number
  burnCard: Card
  burnedCards: number
  handNumber: number
  shuffleVersion: string
  needsShuffle: boolean
}

export interface Bets {
  player: number
  banker: number
  tie: number
  playerPair: number
  bankerPair: number
}

export interface Settlement {
  totalStake: number
  totalReturned: number
  net: number
  /**
   * Optional for records created before commission was exported explicitly.
   * New settlements always persist the amount deducted from a winning Banker
   * wager.
   */
  commissionCharged?: number
  breakdown: Partial<Record<keyof Bets, number>>
}

export type PlayMode = 'bet' | 'fly'
export type RevealControl = 'player-squeeze' | 'dealer-reveal'

export interface PendingRound {
  id: string
  playMode: PlayMode
  revealControl: RevealControl
  bets: Bets
  balanceBefore: number
  sourceShoeId: string
  sourceCursor: number
  shoeAfter: ShoeState
  result: DealResult
}

/**
 * The reveal-control field is optional only while reading legacy v1 journals.
 * Newly prepared rounds always persist it explicitly, and presentation state
 * resolves the legacy default before use.
 */
export type PersistedPendingRound = Omit<PendingRound, 'revealControl'> & {
  version: 1
  revealControl?: RevealControl
  revealedCount: number
}

export interface RoundRecord extends DealResult {
  id: string
  shoeId: string
  handNumber: number
  timestamp: string
  /**
   * Optional for backwards compatibility with records created before the
   * dedicated no-bet fly mode was introduced.
   */
  playMode?: PlayMode
  bets: Bets
  settlement: Settlement
  balanceBefore: number
  balanceAfter: number
  cardsRemaining: number
  rulesetVersion: string
  shuffleVersion: string
}

export interface PersistedGameState {
  version: 1
  balance: number
  shoe: ShoeState
  history: RoundRecord[]
  lastBets: Bets
  sessionStartedAt: string
}

export type RoadColor = 'red' | 'blue'

export interface RoadCell<T = Winner | RoadColor> {
  row: number
  col: number
  value: T
  sourceIndex: number
}

export interface BigRoadCell extends RoadCell<Winner> {
  tieCount: number
  playerPair: boolean
  bankerPair: boolean
  roundIds: string[]
}
