import type { MutableRefObject } from 'react'
import { casinoAudio } from '../audio/casinoAudio'
import type { DealMotionToken } from '../game/motion'
import { nextRevealCard, revealSideForCard } from '../game/reveal'
import type { DealResult, PendingRound } from '../types'
import type { RoundPreludeCompletionGate } from './roundPreludeGate'

interface PendingThirdCardDeal {
  round: PendingRound | null
  roundId: string
  revealedCount: number
  expectedRevealedCount: number
  cardId: string
  dealtCardIds: ReadonlySet<string>
}

interface LiveThirdCardDealInput {
  gate: RoundPreludeCompletionGate
  round: PendingRound
  revealedCount: number
  cardIds: readonly string[]
  pendingRoundRef: MutableRefObject<PendingRound | null>
  revealedCountRef: MutableRefObject<number>
  dealtCardIdsRef: MutableRefObject<Set<string>>
  activeDealMotionRef: MutableRefObject<DealMotionToken | null>
  dealQueueRef: MutableRefObject<string[]>
  announce: (message: string) => void
  startDealSequence: (
    round: PendingRound,
    cardIds: readonly string[],
    announcement: string,
  ) => void
}

export function thirdCardDealerCall(
  result: DealResult,
  cardId: string,
): string | null {
  const side = revealSideForCard(result, cardId)
  if (!side) return null
  const thirdCard =
    side === 'player' ? result.playerCards[2] : result.bankerCards[2]
  if (thirdCard?.id !== cardId) return null
  return `${side === 'player' ? '闲家' : '庄家'}补牌`
}

export function thirdCardDealIsPending({
  round,
  roundId,
  revealedCount,
  expectedRevealedCount,
  cardId,
  dealtCardIds,
}: PendingThirdCardDeal): boolean {
  return Boolean(
    round?.id === roundId &&
      revealedCount === expectedRevealedCount &&
      revealedCount >= 4 &&
      nextRevealCard(round.result, revealedCount)?.id === cardId &&
      !dealtCardIds.has(cardId),
  )
}

/**
 * Starts the live-table third-card call and releases the physical card only
 * after that call reaches a terminal state. The shared dealer gate rejects
 * cancelled/superseded callbacks and treats speech failure as completion.
 */
export function beginLiveThirdCardDeal({
  gate,
  round,
  revealedCount,
  cardIds,
  pendingRoundRef,
  revealedCountRef,
  dealtCardIdsRef,
  activeDealMotionRef,
  dealQueueRef,
  announce,
  startDealSequence,
}: LiveThirdCardDealInput): void {
  const cardId = cardIds[0]
  const dealerCall = cardId
    ? thirdCardDealerCall(round.result, cardId)
    : null
  if (!cardId || !dealerCall) {
    startDealSequence(
      round,
      cardIds,
      '荷官正在补发第三张牌，牌落桌后再继续开牌…',
    )
    return
  }

  casinoAudio.playRoundOpen(`${round.id}:third-card-cue`)
  announce(`荷官示意“${dealerCall}”，口令完成后再发牌…`)
  gate.start({
    dealerCall: casinoAudio.playDealerCall(
      `${round.id}:dealer-call:third-card:${revealedCount}`,
      dealerCall,
    ),
    visualDelayMs: 0,
    canComplete: () =>
      thirdCardDealIsPending({
        round: pendingRoundRef.current,
        roundId: round.id,
        revealedCount: revealedCountRef.current,
        expectedRevealedCount: revealedCount,
        cardId,
        dealtCardIds: dealtCardIdsRef.current,
      }) &&
      activeDealMotionRef.current === null &&
      dealQueueRef.current.length === 0,
    onComplete: () => {
      const active = pendingRoundRef.current
      if (!active) return
      startDealSequence(
        active,
        [cardId],
        `荷官已宣读“${dealerCall}”，正在补发第三张牌…`,
      )
    },
  })
}
