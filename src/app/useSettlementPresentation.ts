import { useCallback, useEffect, useRef, useState } from 'react'
import { casinoAudio } from '../audio/casinoAudio'
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

export interface StartSettlementPresentationInput
  extends Omit<ActiveSettlementPresentation, 'state'> {
  awaitDealerSettlement: boolean
  startAfter: Promise<unknown>
}

interface MutableValue<T> {
  current: T
}

interface StartCardSweepAudioRuntimeInput {
  roundId: string
  advancePresentation: (
    roundId: string,
    state: 'discarding-cards',
  ) => boolean
  playCardSweep: (eventId: string) => void
}

interface CancelSettlementPresentationRuntimeInput<T> {
  activeRef: MutableValue<T | null>
  timerRef: MutableValue<number | null>
  clearTimeout: (timerId: number) => void
  clearCardSweepMotion: () => void
  clearPresentation: () => void
  clearReadyRound: () => void
}

// Exported for the DOM-free unit harness. The production hook uses the same
// primitive so an authoritative external snapshot can invalidate every local
// continuation without accidentally completing the interrupted presentation.
export function cancelSettlementPresentationRuntime<T>({
  activeRef,
  timerRef,
  clearTimeout,
  clearCardSweepMotion,
  clearPresentation,
  clearReadyRound,
}: CancelSettlementPresentationRuntimeInput<T>): void {
  if (timerRef.current !== null) {
    clearTimeout(timerRef.current)
    timerRef.current = null
  }
  activeRef.current = null
  clearCardSweepMotion()
  clearPresentation()
  clearReadyRound()
}

export function startCardSweepAudioRuntime({
  roundId,
  advancePresentation,
  playCardSweep,
}: StartCardSweepAudioRuntimeInput): boolean {
  if (!advancePresentation(roundId, 'discarding-cards')) return false
  playCardSweep(`${roundId}:card-sweep`)
  return true
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
    return { heading: '荷官正在宣读本局点数与胜方', status: '报点中' }
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

export function settlementRecordIsVisible(
  roundId: string,
  presentation: SettlementPresentation | null,
  durablePresentationRoundId?: string | null,
): boolean {
  if (presentation?.roundId === roundId) {
    return (
      PRESENTATION_STATE_RANK[presentation.state] >=
      PRESENTATION_STATE_RANK['recording-road']
    )
  }

  return durablePresentationRoundId !== roundId
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
  const [readyRoundId, setReadyRoundId] = useState<string | null>(null)
  const activeRef = useRef<ActiveSettlementPresentation | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const cancelPresentation = useCallback(() => {
    cancelSettlementPresentationRuntime({
      activeRef,
      timerRef,
      clearTimeout: (timerId) => window.clearTimeout(timerId),
      clearCardSweepMotion: () => setCardSweepMotion(null),
      clearPresentation: () => setPresentation(null),
      clearReadyRound: () => setReadyRoundId(null),
    })
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
      setReadyRoundId(null)
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
      if (!startCardSweepAudioRuntime({
        roundId,
        advancePresentation,
        playCardSweep: (eventId) => casinoAudio.playCardSweep(eventId),
      })) return
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
      startAfter,
      onComplete,
    }: StartSettlementPresentationInput): boolean => {
      if (activeRef.current) return false

      const active: ActiveSettlementPresentation = {
        roundId,
        cardIds: [...cardIds],
        profile,
        state: 'not-started',
        onComplete,
      }
      activeRef.current = active
      setCardSweepMotion(null)
      setClearedRoundId((current) => (current === roundId ? null : current))
      setReadyRoundId(null)
      setPresentation({ roundId, state: 'not-started' })
      const beginPhysicalSettlement = () => {
        if (activeRef.current !== active) return
        if (awaitDealerSettlement) {
          setReadyRoundId(roundId)
        } else {
          startRoadRecording(roundId)
        }
      }
      void startAfter.then(beginPhysicalSettlement, beginPhysicalSettlement)
      return true
    },
    [startRoadRecording],
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
    readyRoundId,
    cancelPresentation,
    startSettlementPresentation,
    handleDealerSettlementStep,
    handleDealerSettlementComplete,
  }
}
