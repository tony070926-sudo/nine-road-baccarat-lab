import { handTotal } from '../game/baccarat'
import {
  manualRevealSides,
  nextRevealCard,
  revealedCards,
  revealSideForCard,
  visibleRevealCardIds,
  type RevealSide,
} from '../game/reveal'
import { tableLeaseIsSupported } from '../game/tableLease'
import type {
  Card,
  DealResult,
  PendingRound,
  RoundRecord,
  Winner,
} from '../types'

export interface ShoeRecordSummary {
  count: number
  banker: number
  player: number
  tie: number
  naturals: number
  pairs: number
}

export interface PendingRoundView {
  visibleCardIds: Set<string>
  completedCardIds: Set<string>
  completedCards: Card[]
  nextCard: Card | null
  manualSides: RevealSide[]
  nextSide: RevealSide | null
  nextRequiresUser: boolean
  playerTotal: number | null
  bankerTotal: number | null
  displayTotal: number
}

export interface PendingPresentationFlags {
  pointCallActive: boolean
  physicalDealActive: boolean
}

export function summarizeShoeRecords(
  records: readonly RoundRecord[],
): ShoeRecordSummary {
  const byWinner = (winner: Winner) =>
    records.filter((record) => record.winner === winner).length

  return {
    count: records.length,
    banker: byWinner('banker'),
    player: byWinner('player'),
    tie: byWinner('tie'),
    naturals: records.filter((record) => record.natural).length,
    pairs: records.filter((record) => record.playerPair || record.bankerPair)
      .length,
  }
}

export function derivePendingRoundView(
  round: PendingRound | null,
  revealedCount: number,
): PendingRoundView {
  if (!round) {
    return {
      visibleCardIds: new Set(),
      completedCardIds: new Set(),
      completedCards: [],
      nextCard: null,
      manualSides: [],
      nextSide: null,
      nextRequiresUser: false,
      playerTotal: null,
      bankerTotal: null,
      displayTotal: 0,
    }
  }

  const visibleCardIds = new Set(
    visibleRevealCardIds(round.result, revealedCount),
  )
  const completedCards = revealedCards(round.result, revealedCount)
  const completedCardIds = new Set(completedCards.map((card) => card.id))
  const nextCard = nextRevealCard(round.result, revealedCount)
  const manualSides = manualRevealSides(
    round.bets,
    round.playMode,
    round.revealControl,
  )
  const nextSide = nextCard
    ? revealSideForCard(round.result, nextCard.id)
    : null
  const playerCards = completedCards.filter((card) =>
    round.result.playerCards.some((playerCard) => playerCard.id === card.id),
  )
  const bankerCards = completedCards.filter((card) =>
    round.result.bankerCards.some((bankerCard) => bankerCard.id === card.id),
  )

  return {
    visibleCardIds,
    completedCardIds,
    completedCards,
    nextCard,
    manualSides,
    nextSide,
    nextRequiresUser: nextSide !== null && manualSides.includes(nextSide),
    playerTotal: playerCards.length > 0 ? handTotal(playerCards) : null,
    bankerTotal: bankerCards.length > 0 ? handTotal(bankerCards) : null,
    displayTotal: visibleCardIds.size,
  }
}

export function derivePendingPresentationFlags(
  round: PendingRound | null,
  revealedCount: number,
  dealtCardIds: ReadonlySet<string>,
  announcedRoundId: string | null,
): PendingPresentationFlags {
  if (!round) return { pointCallActive: false, physicalDealActive: false }
  const pointCallActive = revealedCount === 4 && announcedRoundId !== round.id
  return {
    pointCallActive,
    physicalDealActive:
      !pointCallActive &&
      visibleRevealCardIds(round.result, revealedCount).some(
        (cardId) => !dealtCardIds.has(cardId),
      ),
  }
}

export function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: value % 1 === 0 ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function tableLeaseUnavailableMessage(action: string): string {
  return tableLeaseIsSupported()
    ? `另一标签页正在控制牌桌，暂时无法${action}。`
    : `此浏览器缺少 Web Locks，无法安全${action}。`
}

export function outcomeLabel(winner: Winner): string {
  if (winner === 'banker') return '庄家胜'
  if (winner === 'player') return '闲家胜'
  return '和局'
}

export function openingResultCall(result: DealResult): string {
  const naturalCall = result.natural ? '，天然牌' : ''
  return `闲家 ${handTotal(result.playerCards.slice(0, 2))} 点，庄家 ${handTotal(result.bankerCards.slice(0, 2))} 点${naturalCall}`
}

export function finalResultCall(result: DealResult): string {
  return `闲家 ${handTotal(result.playerCards)} 点，庄家 ${handTotal(result.bankerCards)} 点，${outcomeLabel(result.winner)}`
}

export function revealSideLabel(side: RevealSide): string {
  return side === 'player' ? '闲家' : '庄家'
}

export function revealScopeLabel(sides: RevealSide[]): string {
  if (sides.length === 0) return '荷官开牌'
  if (sides.length === 1) return `只翻${revealSideLabel(sides[0])}`
  return '翻开双方'
}

export function statPercent(count: number, total: number): string {
  return total ? `${((count / total) * 100).toFixed(1)}%` : '—'
}

export function createRoundId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `round-${Date.now()}`
}

export function roundRevealInstruction(round: PendingRound): string {
  const revealSides = manualRevealSides(
    round.bets,
    round.playMode,
    round.revealControl,
  )
  if (round.playMode === 'fly') {
    return '飞牌进行中，本局无下注，荷官将自动开牌并写入路单。'
  }
  if (round.revealControl === 'dealer-reveal') {
    return '下注已锁定。本局已拒绝接牌，双方牌面均由荷官依次开出。'
  }
  if (revealSides.length === 0) {
    return '下注已锁定。本局没有庄/闲主注，双方牌面由荷官依次开出。'
  }
  if (revealSides.length === 1) {
    return `下注已锁定。本局由你翻开${revealSideLabel(
      revealSides[0],
    )}，另一方由荷官自动翻开。`
  }
  return '下注已锁定。本局下注涉及双方，请按亮起顺序翻牌。'
}
