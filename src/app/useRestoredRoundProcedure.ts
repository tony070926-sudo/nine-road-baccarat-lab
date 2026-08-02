import type { MutableRefObject } from 'react'
import { casinoAudio } from '../audio/casinoAudio'
import {
  nextRevealCard,
  openingDealCardIds,
  resolveRevealControl,
  restoredDealtCardIds,
  revealIsComplete,
} from '../game/reveal'
import {
  motionDuration,
  type EffectiveMotionProfile,
} from '../game/motionProfile'
import type { PendingRound } from '../types'
import type { RoundPreludeCompletionGate } from './roundPreludeGate'
import {
  thirdCardDealerCall,
  thirdCardDealIsPending,
} from './thirdCardCallGate'
import { openingResultCall } from './tableUi'
import type { BeginInitialPointCallInput } from './useInitialPointCall'

export interface RestoredRoundPresentationState {
  dealtCardIds: string[]
  isFullyRevealed: boolean
  isResumingProcedure: boolean
  roundReady: boolean
  flipLocked: boolean
}

export function restoredRoundPresentationState(
  round: PendingRound,
  revealedCount: number,
  ownsLease: boolean,
): RestoredRoundPresentationState {
  const isFullyRevealed = revealIsComplete(round.result, revealedCount)
  const isResumingProcedure = Boolean(
    ownsLease &&
    (revealedCount === 0 ||
      revealedCount === 4 ||
      (revealedCount > 4 && !isFullyRevealed)),
  )
  return {
    dealtCardIds: restoredDealtCardIds(round.result, revealedCount),
    isFullyRevealed,
    isResumingProcedure,
    roundReady: ownsLease && !isFullyRevealed && !isResumingProcedure,
    flipLocked: !ownsLease || isFullyRevealed || isResumingProcedure,
  }
}

export function restoredRoundAnnouncement(
  round: PendingRound,
  isFullyRevealed: boolean,
  ownsLease: boolean,
): string {
  if (!ownsLease) {
    return '另一标签页正在控制这局牌；当前页面只读取单一权威快照并等待同步。'
  }
  if (isFullyRevealed) return '完整牌面与锁定下注已恢复，正在完成结算。'
  if (round.playMode === 'fly') return '飞牌对局已恢复，荷官将继续自动开牌。'
  return resolveRevealControl(round) === 'dealer-reveal'
    ? '已锁定下注对局已恢复，荷官将继续开牌。'
    : '已锁定下注对局已恢复，将按下注侧继续咪牌。'
}

interface ResumeRestoredRoundProcedureInput {
  round: PendingRound
  revealedCount: number
  pendingRoundRef: MutableRefObject<PendingRound | null>
  revealedCountRef: MutableRefObject<number>
  finalizeLockRef: MutableRefObject<boolean>
  settleTimerRef: MutableRefObject<number | null>
  finalizeRoundRef: MutableRefObject<(roundId: string) => void>
  motionProfile: EffectiveMotionProfile
  roundPreludeGate: RoundPreludeCompletionGate
  dealtCardIdsRef: MutableRefObject<Set<string>>
  beginInitialPointCall: (input: BeginInitialPointCallInput) => void
  startDealSequence: (
    round: PendingRound,
    cardIds: readonly string[],
    announcement: string,
  ) => void
  announce: (message: string) => void
}

export function resumeRestoredRoundProcedure({
  round: restoredRound,
  revealedCount: restoredCount,
  pendingRoundRef,
  revealedCountRef,
  finalizeLockRef,
  settleTimerRef,
  finalizeRoundRef,
  motionProfile,
  roundPreludeGate,
  dealtCardIdsRef,
  beginInitialPointCall,
  startDealSequence,
  announce,
}: ResumeRestoredRoundProcedureInput): void {
  const resumeOpeningDeal = () => {
    const active = pendingRoundRef.current
    if (active?.id !== restoredRound.id || revealedCountRef.current !== 0)
      return
    startDealSequence(
      active,
      openingDealCardIds(active.result),
      '恢复牌局：荷官正在重新发出尚未确认落桌的四张开局牌…',
    )
  }

  const resumeThirdCardDeal = () => {
    const active = pendingRoundRef.current
    if (
      active?.id !== restoredRound.id ||
      revealedCountRef.current !== restoredCount
    )
      return
    const nextCard = nextRevealCard(active.result, restoredCount)
    if (!nextCard) return
    const dealerCall = thirdCardDealerCall(active.result, nextCard.id)
    if (!dealerCall) {
      startDealSequence(
        active,
        [nextCard.id],
        '恢复牌局：荷官正在重新补发尚未确认落桌的第三张牌…',
      )
      return
    }
    casinoAudio.playRoundOpen(`${active.id}:third-card-cue`)
    announce(`恢复牌局：荷官重新示意“${dealerCall}”，口令完成后再发牌。`)
    roundPreludeGate.start({
      dealerCall: casinoAudio.playDealerCall(
        `${active.id}:dealer-call:third-card:${restoredCount}`,
        dealerCall,
      ),
      visualDelayMs: 0,
      canComplete: () =>
        thirdCardDealIsPending({
          round: pendingRoundRef.current,
          roundId: active.id,
          revealedCount: revealedCountRef.current,
          expectedRevealedCount: restoredCount,
          cardId: nextCard.id,
          dealtCardIds: dealtCardIdsRef.current,
        }),
      onComplete: () => {
        const current = pendingRoundRef.current
        if (!current) return
        startDealSequence(
          current,
          [nextCard.id],
          `恢复牌局：荷官已宣读“${dealerCall}”，正在重新补发第三张牌…`,
        )
      },
    })
  }

  if (restoredCount === 0) {
    announce('恢复牌局：荷官重新示意停止下注后再发出四张开局牌。')
    casinoAudio.playRoundOpen(`${restoredRound.id}:round-open:restored`)
    roundPreludeGate.start({
      dealerCall: casinoAudio.playDealerCall(
        `${restoredRound.id}:dealer-call:no-more-bets:restored`,
        '停止下注',
      ),
      visualDelayMs: Math.max(
        20,
        motionDuration(
          restoredRound.playMode === 'fly' ? 540 : 720,
          motionProfile,
        ),
      ),
      canComplete: () =>
        pendingRoundRef.current?.id === restoredRound.id &&
        revealedCountRef.current === 0,
      onComplete: resumeOpeningDeal,
    })
    return
  }

  if (restoredCount !== 4) {
    resumeThirdCardDeal()
    return
  }

  const pointCall = openingResultCall(restoredRound.result)
  announce(`恢复牌局：荷官重新宣读开局点数：${pointCall}。`)
  beginInitialPointCall({
    roundId: restoredRound.id,
    profile: motionProfile,
    completion: casinoAudio.playDealerCall(
      `${restoredRound.id}:dealer-call:initial-points`,
      pointCall,
    ),
    onComplete: () => {
      if (
        pendingRoundRef.current?.id !== restoredRound.id ||
        revealedCountRef.current !== restoredCount
      )
        return
      if (revealIsComplete(restoredRound.result, restoredCount)) {
        announce('恢复牌局：完整牌面已确认，荷官正在核对最终点数…')
        finalizeLockRef.current = true
        settleTimerRef.current = window.setTimeout(
          () => finalizeRoundRef.current(restoredRound.id),
          80,
        )
        return
      }
      resumeThirdCardDeal()
    },
  })
}
