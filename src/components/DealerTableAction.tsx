import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import {
  DEALER_SETTLEMENT_PRELUDE_MS,
  DEALER_SETTLEMENT_STEP_MS,
  dealerSettlementContactDelay,
  dealerSettlementSteps,
  type DealerSettlementMotion,
} from '../game/settlementMotion'
import { casinoAudio } from '../audio/casinoAudio'
import { ChipStackVisual } from './ChipStackVisual'

interface DealerTableActionProps {
  motion: DealerSettlementMotion | null
  stageRef: RefObject<HTMLElement | null>
}

interface Point {
  x: number
  y: number
}

function pointFromRect(rect: DOMRect, stageRect: DOMRect): Point {
  return {
    x: rect.left + rect.width / 2 - stageRect.left,
    y: rect.top + rect.height / 2 - stageRect.top,
  }
}

function payoutPoint(point: Point, mobile: boolean): Point {
  return {
    x: point.x - (mobile ? 24 : 30),
    y: point.y - (mobile ? 1 : 3),
  }
}

/**
 * Visual-only settlement choreography. App commits the balance and history
 * before this sequence begins, so animation timing can never duplicate or
 * delay a financial state transition.
 */
export function DealerTableAction({
  motion,
  stageRef,
}: DealerTableActionProps) {
  const actionRef = useRef<HTMLDivElement>(null)
  const [hasStarted, setHasStarted] = useState(false)
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const steps = useMemo(
    () => (motion ? dealerSettlementSteps(motion) : []),
    [motion],
  )
  const activeStep = hasStarted ? (steps[activeStepIndex] ?? null) : null
  const resolvedPaySteps = hasStarted
    ? steps
        .slice(0, activeStepIndex)
        .filter((step) => step.kind === 'pay')
    : []
  const activeChipAmount = activeStep
    ? activeStep.kind === 'pay'
      ? Math.max(0, activeStep.returned - activeStep.amount)
      : activeStep.amount
    : 0

  useEffect(() => {
    if (!motion) return

    const timer = window.setTimeout(
      () => setHasStarted(true),
      DEALER_SETTLEMENT_PRELUDE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [motion])

  useEffect(() => {
    if (
      !motion ||
      !hasStarted ||
      activeStepIndex >= steps.length - 1
    ) {
      return
    }

    const timer = window.setTimeout(
      () => setActiveStepIndex((current) => current + 1),
      DEALER_SETTLEMENT_STEP_MS,
    )
    return () => window.clearTimeout(timer)
  }, [activeStepIndex, hasStarted, motion, steps.length])

  useEffect(() => {
    if (!motion || !activeStep) return

    const side =
      activeStep.target === 'player' || activeStep.target === 'playerPair'
        ? 'player'
        : activeStep.target === 'banker' ||
            activeStep.target === 'bankerPair'
          ? 'banker'
          : 'center'
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    casinoAudio.playSettlementStep(
      `${motion.id}:settlement:${activeStepIndex}:${activeStep.target}:${activeStep.kind}`,
      activeStep.kind,
      side,
      dealerSettlementContactDelay(activeStep.kind, reducedMotion),
    )
  }, [activeStep, activeStepIndex, motion])

  useLayoutEffect(() => {
    if (!motion || !activeStep) return

    const stage = stageRef.current
    const action = actionRef.current
    if (!stage || !action) return

    const target = stage.querySelector<HTMLElement>(
      `[data-bet-target="${activeStep.target}"]`,
    )
    if (!target) return

    const markedTargets: HTMLElement[] = []
    steps.slice(0, activeStepIndex).forEach((step) => {
      const resolvedTarget = stage.querySelector<HTMLElement>(
        `[data-bet-target="${step.target}"]`,
      )
      if (!resolvedTarget) return
      resolvedTarget.dataset.settlementResolved = step.kind
      markedTargets.push(resolvedTarget)
    })
    target.dataset.settlementActive = activeStep.kind
    markedTargets.push(target)

    const stageRect = stage.getBoundingClientRect()
    const mobile = stageRect.width <= 760
    const stackAnchor = target.querySelector<HTMLElement>(
      '[data-chip-stack-anchor]',
    )
    const anchorPoint = pointFromRect(
      (stackAnchor ?? target).getBoundingClientRect(),
      stageRect,
    )
    const targetPoint =
      activeStep.kind === 'pay'
        ? payoutPoint(anchorPoint, mobile)
        : anchorPoint

    action
      .querySelectorAll<HTMLElement>('[data-dealer-resolved-pay]')
      .forEach((resolvedStack) => {
        const resolvedTargetName = resolvedStack.dataset.dealerResolvedPay
        const resolvedTarget = resolvedTargetName
          ? stage.querySelector<HTMLElement>(
              `[data-bet-target="${resolvedTargetName}"]`,
            )
          : null
        const resolvedAnchor = resolvedTarget?.querySelector<HTMLElement>(
          '[data-chip-stack-anchor]',
        )
        if (!resolvedTarget || !resolvedAnchor) return
        const resolvedPoint = payoutPoint(
          pointFromRect(resolvedAnchor.getBoundingClientRect(), stageRect),
          mobile,
        )
        resolvedStack.style.left = `${resolvedPoint.x}px`
        resolvedStack.style.top = `${resolvedPoint.y}px`
      })
    const dealerPoint = {
      x: stageRect.width * (mobile ? 0.62 : 0.61),
      y: stageRect.height * (mobile ? 0.245 : 0.23),
    }
    const deltaX = targetPoint.x - dealerPoint.x
    const deltaY = targetPoint.y - dealerPoint.y
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI)
    const reach = Math.max(
      0.45,
      Math.hypot(deltaX, deltaY) / (mobile ? 210 : 330),
    )

    action.style.setProperty('--settle-dealer-x', `${dealerPoint.x}px`)
    action.style.setProperty('--settle-dealer-y', `${dealerPoint.y}px`)
    action.style.setProperty('--settle-target-x', `${targetPoint.x}px`)
    action.style.setProperty('--settle-target-y', `${targetPoint.y}px`)
    action.style.setProperty('--settle-delta-x', `${deltaX}px`)
    action.style.setProperty('--settle-delta-y', `${deltaY}px`)
    action.style.setProperty('--settle-return-x', `${-deltaX}px`)
    action.style.setProperty('--settle-return-y', `${-deltaY}px`)
    action.style.setProperty('--settle-arm-angle', `${angle}deg`)
    action.style.setProperty('--settle-arm-reach', String(reach))
    action.classList.add('is-ready')

    return () => {
      action.classList.remove('is-ready')
      markedTargets.forEach((markedTarget) => {
        delete markedTarget.dataset.settlementActive
        delete markedTarget.dataset.settlementResolved
      })
    }
  }, [activeStep, activeStepIndex, motion, stageRef, steps])

  if (!motion || !activeStep) return null

  return (
    <div className="dealer-table-action-sequence" aria-hidden="true">
      <div
        key={`${motion.id}:${activeStepIndex}:${activeStep.target}`}
        ref={actionRef}
        className={`dealer-table-action dealer-table-action-${activeStep.kind}`}
        data-dealer-settlement-state={activeStep.kind}
        data-dealer-settlement-target={activeStep.target}
        data-dealer-settlement-step={`${activeStepIndex + 1}/${steps.length}`}
      >
        <span className="dealer-settle-target-ring">
          <i />
        </span>
        {resolvedPaySteps.map((step) => (
          <span
            className="dealer-resolved-pay-stack"
            data-dealer-resolved-pay={step.target}
            key={`${motion.id}:resolved-pay:${step.target}`}
          >
            <ChipStackVisual
              amount={Math.max(0, step.returned - step.amount)}
              maximumVisible={4}
              label={`+${step.returned - step.amount}`}
            />
          </span>
        ))}
        <ChipStackVisual
          amount={activeChipAmount}
          className="dealer-settle-chip-stack"
          maximumVisible={activeStep.kind === 'pay' ? 4 : 6}
          chips={
            activeStep.kind === 'pay'
              ? undefined
              : motion.wagerChipLedger?.[activeStep.target]
          }
          label={
            activeStep.kind === 'collect'
              ? `−${activeStep.amount}`
              : activeStep.kind === 'pay'
                ? `+${activeStep.returned - activeStep.amount}`
                : '退'
          }
        />
        {activeStep.commission > 0 && (
          <span
            className="dealer-commission-chip"
            data-dealer-commission={activeStep.commission}
          >
            <i>5%</i>
            <strong>
              佣{' '}
              {activeStep.commission.toLocaleString('zh-CN', {
                maximumFractionDigits: 2,
              })}
            </strong>
          </span>
        )}
      </div>
    </div>
  )
}
