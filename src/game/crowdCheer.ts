import type { Card, DealResult, Winner } from '../types'
import {
  bankerShouldDraw,
  cardPoint,
  handTotal,
} from './baccarat'

export type CrowdCheerSide = 'player' | 'banker'
export type CrowdCheerTone =
  | 'anticipation'
  | 'celebration'
  | 'reaction'
  | 'hush'

export interface CrowdCheer {
  side: CrowdCheerSide
  tone: CrowdCheerTone
  messages: readonly [string, string, string]
}

export interface CardRevealCheerInput {
  side: CrowdCheerSide
  /** The card the user has just turned face-up. */
  revealedCard: Card
  /** Cards on this side that are face-up after the current turn. */
  revealedCards: readonly Card[]
  /** Completion derived only from the public reveal state and draw rules. */
  isSideComplete: boolean
}

export interface SettlementCheerInput {
  winner: Winner
  settlementNet: number
  /** Sides that the player manually revealed for this wagered round. */
  manualSides: readonly CrowdCheerSide[]
}

const FACE_RANKS = new Set(['J', 'Q', 'K'])

function isFaceCard(card: Card): boolean {
  return FACE_RANKS.has(card.rank)
}

export function revealedCardsForSide(
  result: DealResult,
  cards: readonly Card[],
  side: CrowdCheerSide,
): Card[] {
  const sideIds = new Set(
    (side === 'player' ? result.playerCards : result.bankerCards).map(
      (card) => card.id,
    ),
  )
  return cards.filter((card) => sideIds.has(card.id))
}

/**
 * Decides whether the revealed side is visibly complete without consulting a
 * hidden card rank or a future card count.
 */
export function sideIsCompleteFromPublicCards(
  result: DealResult,
  publicCards: readonly Card[],
  side: CrowdCheerSide,
): boolean {
  const sideCards = revealedCardsForSide(result, publicCards, side)
  if (sideCards.length < 2) return false
  if (sideCards.length >= 3) return true

  const sideTotal = handTotal(sideCards)
  if (sideTotal >= 8) return true

  const initialCardIds = new Set(
    result.dealOrder.slice(0, 4).map((card) => card.id),
  )
  const visibleInitialCards = publicCards.filter((card) =>
    initialCardIds.has(card.id),
  )
  const initialHandsArePublic = visibleInitialCards.length === 4

  if (!initialHandsArePublic) {
    if (side === 'player') return sideTotal >= 6
    return sideTotal === 7
  }

  const publicPlayerCards = revealedCardsForSide(
    result,
    publicCards,
    'player',
  )
  const publicBankerCards = revealedCardsForSide(
    result,
    publicCards,
    'banker',
  )
  const playerTwoCardTotal = handTotal(publicPlayerCards.slice(0, 2))
  const bankerTwoCardTotal = handTotal(publicBankerCards.slice(0, 2))

  if (playerTwoCardTotal >= 8 || bankerTwoCardTotal >= 8) return true
  if (side === 'player') return playerTwoCardTotal >= 6

  if (playerTwoCardTotal >= 6) {
    return bankerTwoCardTotal >= 6
  }

  const publicPlayerThirdCard = publicPlayerCards[2]
  if (!publicPlayerThirdCard) return bankerTwoCardTotal === 7

  return !bankerShouldDraw(
    bankerTwoCardTotal,
    cardPoint(publicPlayerThirdCard),
  )
}

function normalizePublicCards(input: CardRevealCheerInput): Card[] {
  const publicCards = [...input.revealedCards]

  if (!publicCards.some((card) => card.id === input.revealedCard.id)) {
    publicCards.push(input.revealedCard)
  }

  return publicCards
}

function edgeMessage(card: Card): string {
  if (isFaceCard(card)) return '公仔亮相！'
  if (card.rank === '10') return '四边十！密面！'

  const point = cardPoint(card)
  if (point <= 3) return `无边${card.rank}！`
  if (point <= 5) return `两边${card.rank}！`
  if (point <= 8) return `三边${card.rank}！`
  return `四边${card.rank}！`
}

function callForNine(total: number): readonly [string, string] {
  const neededPoint = (9 - total + 10) % 10

  switch (neededPoint) {
    case 0:
      return ['公！公！公！', '来张公仔！']
    case 1:
      return ['A仔！A仔！', '无边A！']
    case 2:
      return ['二仔！二仔！', '无边二！']
    case 3:
      return ['三仔！三仔！', '无边三！']
    case 4:
      return ['四仔！四仔！', '两边四！']
    case 5:
      return ['五仔！五仔！', '两边五！']
    case 6:
      return ['六仔！六仔！', '三边六！']
    case 7:
      return ['七仔！七仔！', '三边七！']
    case 8:
      return ['八仔！八仔！', '三边八！']
    default:
      return ['九仔！九仔！', '四边九！']
  }
}

function completedSideCheer(
  side: CrowdCheerSide,
  publicCards: readonly Card[],
  revealedCard: Card,
): CrowdCheer {
  const total = handTotal([...publicCards])
  const isPair =
    publicCards.length >= 2 && publicCards[0].rank === publicCards[1].rank

  if (publicCards.length === 2 && total === 9) {
    return {
      side,
      tone: 'celebration',
      messages: [
        '天九！',
        isPair ? '对子天九！' : '两张九点！',
        '全桌喝彩！',
      ],
    }
  }

  if (publicCards.length === 2 && total === 8) {
    return {
      side,
      tone: 'celebration',
      messages: [
        '天八！',
        isPair ? '对子天八！' : '两张八点！',
        '好牌亮清！',
      ],
    }
  }

  if (publicCards.length === 3 && total >= 8) {
    return {
      side,
      tone: 'celebration',
      messages: [
        `补成${total === 9 ? '九' : '八'}点！`,
        `三张${total === 9 ? '九' : '八'}点！`,
        '牌面亮清！',
      ],
    }
  }

  if (publicCards.length === 3 && isFaceCard(revealedCard)) {
    return {
      side,
      tone: 'reaction',
      messages: ['一公上太空…', `牌点仍是${total}点`, '本手已经亮清'],
    }
  }

  if (publicCards.length === 3 && revealedCard.rank === '10') {
    return {
      side,
      tone: 'reaction',
      messages: ['四边十！', '密面零点', `牌点仍是${total}点`],
    }
  }

  return {
    side,
    tone: total >= 6 ? 'reaction' : 'hush',
    messages: [
      edgeMessage(revealedCard),
      isPair ? '对子亮相！' : `${publicCards.length}张${total}点`,
      '牌面已经亮清',
    ],
  }
}

/**
 * Builds table-side reactions using only face-up cards and a completion flag
 * derived from publicly visible draw-rule information.
 */
export function buildCardRevealCheer(
  input: CardRevealCheerInput,
): CrowdCheer {
  const publicCards = normalizePublicCards(input)
  const total = handTotal(publicCards)

  if (input.isSideComplete) {
    return completedSideCheer(
      input.side,
      publicCards,
      input.revealedCard,
    )
  }

  const [primaryCall, secondaryCall] = callForNine(total)
  const pairRevealed =
    publicCards.length >= 2 && publicCards[0].rank === publicCards[1].rank

  if (publicCards.length === 1 && cardPoint(input.revealedCard) === 9) {
    return {
      side: input.side,
      tone: 'anticipation',
      messages: ['公！公！公！', '四边九！', '九点守住！'],
    }
  }

  return {
    side: input.side,
    tone: 'anticipation',
    messages: [
      edgeMessage(input.revealedCard),
      pairRevealed ? '对子！对子！' : primaryCall,
      secondaryCall,
    ],
  }
}

function winnerLabel(winner: Winner): string {
  if (winner === 'player') return '闲家'
  if (winner === 'banker') return '庄家'
  return '和局'
}

/**
 * Returns a final table reaction only for wagered rounds with a manually
 * revealed side. It describes the settled hand and never prompts another bet.
 */
export function buildSettlementCheer(
  input: SettlementCheerInput,
): CrowdCheer | null {
  const manualSides = [...new Set(input.manualSides)]
  if (manualSides.length === 0) return null

  const side =
    input.winner !== 'tie' && manualSides.includes(input.winner)
      ? input.winner
      : manualSides[0]
  const label = winnerLabel(input.winner)

  if (input.settlementNet > 0) {
    return {
      side,
      tone: 'celebration',
      messages: [
        '本局得彩！',
        input.winner === 'tie' ? '和局开出！' : `${label}赢出！`,
        '筹码已经结算',
      ],
    }
  }

  if (input.settlementNet === 0) {
    return {
      side,
      tone: 'reaction',
      messages: [
        input.winner === 'tie' ? '和局！' : '本局持平',
        input.winner === 'tie' ? '原注退回' : `${label}赢出`,
        '筹码已经结算',
      ],
    }
  }

  return {
    side,
    tone: 'hush',
    messages: [
      '本局未中',
      input.winner === 'tie' ? '开出和局' : `${label}赢出`,
      '结果已经结算',
    ],
  }
}
