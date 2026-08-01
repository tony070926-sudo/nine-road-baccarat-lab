import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cardSweepMotionDuration,
  createCardSweepMotionToken,
  type CardSweepMotionToken,
} from '../game/cardSweepMotion'
import type { DealerProcedureSettlementState } from '../game/dealerProcedure'
import {
  motionDuration,
  type EffectiveMotionProfile,
} from '../game/motionProfile'
import type { SettlementActionKind } from '../game/settlementMotion'

export const ROAD_RECORD_HOLD_MS = 420
export const NEXT_ROUND_HOLD_MS = 160
export const MIN_PRESENTATION_HOLD_MS = 30

export interface SettlementPresentation {
  roundId: string
  state: DealerProcedureSettlementState
}

export interface SettlementPresentationCopy {
  heading: string | null
  status: string | null
}

interface ActiveSettlementPresentation {
  roundId: string
  cardIds: readonly string[]
  profile: EffectiveMotionProfile
  state: DealerProcedureSettlementState
  onComplete: () => void
}

interface StartSettlementPresentationInput
  extends Omit<ActiveSettlementPresentation, 'state'> {
  awaitDealerSettlement: boolean
}

export function settlementPresentationHold(
  baseDurationMs: number,
  profile: EffectiveMotionProfile,
): number {
  return Math.max(
    MIN_PRESENTATION_HOLD_MS,
    motionDuration(baseDurationMs, profile),
  )
}

export function settlementStateForAction(
  action: SettlementActionKind,
): DealerProcedureSettlementState {
  if (action === 'collect') return 'collecting-losing-wagers'
  if (action === 'push') return 'returning-pushed-wagers'
  return 'paying-winners'
}

export function settlementPresentationCopy(
  state: DealerProcedureSettlementState | null,
  cardSweepActive: boolean,
): SettlementPresentationCopy {
  if (!state) return { heading: null, status: null }
  if (state === 'not-started') {
    return { heading: '荷官正在核对本局筹码', status: '核对中' }
  }
  if (state === 'collecting-losing-wagers') {
    return { heading: '荷官正在收取输注', status: '收注中' }
  }
  if (state === 'returning-pushed-wagers') {
    return { heading: '荷官正在退回和注', status: '退注中' }
  }
  if (state === 'paying-winners') {
    return { heading: '荷官正在支付赢注', status: '派彩中' }
  }
  if (state === 'recording-road') {
    return { heading: '荷官正在记录路单', status: '录单中' }
  }
  if (state === 'discarding-cards') {
    return {
      heading: '荷官正在收牌',
      status: cardSweepActive ? '收牌中' : '清桌中',
    }
  }
  if (state === 'complete') {
    return { heading: '荷官正在开放下一局', status: '开桌中' }
  }
  return { heading: '荷官正在逐区结算', status: '结算中' }
}

const PRESENTATION_STATE_RANK: Readonly<
  Record<DealerProcedureSettlementState, number>
> = {
  'not-started': 0,
  'collecting-losing-wagers': 1,
  'returning-pushed-wagers': 2,
  'paying-winners': 3,
  'recording-road': 4,
  'discarding-cards': 5,
  complete: 6,
}

/**
 * Owns only the post-commit table presentation. The caller remains responsible
 * for the durable settlement and keeps the table lease until `onComplete`.
 */
export function useSettlementPresentation(latestRoundId: string | null) {
  const [presentation, setPresentation] =
    useState<SettlementPresentation | null>(null)
  const [cardSweepMotion, setCardSweepMotion] =
    useState<CardSweepMotionToken | null>(null)
  const [clearedRoundId, setClearedRoundId] = useState(latestRoundId)
  const activeRef = useRef<ActiveSettlementPresentation | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const advancePresentation = useCallback(
    (roundId: string, state: DealerProcedureSettlementState): boolean => {
      const active = activeRef.current
      if (
        !active ||
        active.roundId !== roundId ||
        PRESENTATION_STATE_RANK[state] <=
          PRESENTATION_STATE_RANK[active.state]
      ) {
        return false
      }
      active.state = state
      setPresentation({ roundId, state })
      return true
    },
    [],
  )

  const finishPresentation = useCallback(
    (roundId: string) => {
      const active = activeRef.current
      if (!active || active.roundId !== roundId) return

      clearTimer()
      activeRef.current = null
      setCardSweepMotion(null)
      setClearedRoundId(roundId)
      setPresentation(null)
      active.onComplete()
    },
    [clearTimer],
  )

  const startCardSweep = useCallback(
    (roundId: string) => {
      const active = activeRef.current
      if (!active || active.roundId !== roundId) return

      const token = createCardSweepMotionToken({
        roundId,
        cardIds: active.cardIds,
        profile: active.profile,
      })
      if (!advancePresentation(roundId, 'discarding-cards')) return
      setCardSweepMotion(token)
      clearTimer()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        if (activeRef.current?.roundId !== roundId) return
        setCardSweepMotion(null)
        setClearedRoundId(roundId)
        if (!advancePresentation(roundId, 'complete')) return
        timerRef.current = window.setTimeout(
          () => finishPresentation(roundId),
          settlementPresentationHold(NEXT_ROUND_HOLD_MS, active.profile),
        )
      }, cardSweepMotionDuration(token))
    },
    [advancePresentation, clearTimer, finishPresentation],
  )

  const startRoadRecording = useCallback(
    (roundId: string) => {
      const active = activeRef.current
      if (!active || active.roundId !== roundId) return

      if (!advancePresentation(roundId, 'recording-road')) return
      clearTimer()
      timerRef.current = window.setTimeout(
        () => startCardSweep(roundId),
        settlementPresentationHold(ROAD_RECORD_HOLD_MS, active.profile),
      )
    },
    [advancePresentation, clearTimer, startCardSweep],
  )

  const startSettlementPresentation = useCallback(
    ({
      roundId,
      cardIds,
      profile,
      awaitDealerSettlement,
      onComplete,
    }: StartSettlementPresentationInput): boolean => {
      if (activeRef.current) return false

      const active: ActiveSettlementPresentation = {
        roundId,
        cardIds: [...cardIds],
        profile,
        state: awaitDealerSettlement ? 'not-started' : 'recording-road',
        onComplete,
      }
      activeRef.current = active
      setCardSweepMotion(null)
      setPresentation({
        roundId,
        state: awaitDealerSettlement ? 'not-started' : 'recording-road',
      })
      if (!awaitDealerSettlement) {
        timerRef.current = window.setTimeout(
          () => startCardSweep(roundId),
          settlementPresentationHold(ROAD_RECORD_HOLD_MS, profile),
        )
      }
      return true
    },
    [startCardSweep],
  )

  const handleDealerSettlementStep = useCallback(
    (roundId: string, action: SettlementActionKind) => {
      if (activeRef.current?.roundId !== roundId) return
      advancePresentation(roundId, settlementStateForAction(action))
    },
    [advancePresentation],
  )

  const handleDealerSettlementComplete = useCallback(
    (roundId: string) => startRoadRecording(roundId),
    [startRoadRecording],
  )

  useEffect(() => {
    if (!activeRef.current && latestRoundId) {
      setClearedRoundId(latestRoundId)
    }
  }, [latestRoundId])

  useEffect(
    () => () => {
      clearTimer()
      activeRef.current = null
    },
    [clearTimer],
  )

  return {
    presentation,
    cardSweepMotion,
    clearedRoundId,
    startSettlementPresentation,
    handleDealerSettlementStep,
    handleDealerSettlementComplete,
  }
}
