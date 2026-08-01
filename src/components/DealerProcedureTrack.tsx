import { useEffect, useRef } from 'react'
import type {
  DealerProcedureAnnouncement,
  DealerProcedurePlan,
  DealerProcedureSide,
  DealerProcedureStep,
  DealerProcedureStepKind,
  DealerProcedureStepStatus,
} from '../game/dealerProcedure'
import './DealerProcedureTrack.css'

interface ProcedureCopy {
  label: string
  detail: string
  announcement?: string
}

const SIDE_LABELS: Readonly<Record<DealerProcedureSide, string>> = {
  player: '闲家',
  banker: '庄家',
}

const STEP_COPY: Readonly<
  Record<Exclude<DealerProcedureStepKind, 'deal-opening-card'>, ProcedureCopy>
> = {
  'place-bets': {
    label: '请下注',
    detail: '开放本局下注',
  },
  'no-more-bets': {
    label: '停止下注',
    detail: '锁定本局下注区',
  },
  'reveal-opening-hands': {
    label: '公开开局手牌',
    detail: '依牌桌程序公开双方两张手牌',
  },
  'announce-initial-points': {
    label: '宣读开局点数',
    detail: '只宣读已经公开的两张牌点数',
  },
  'deal-player-third-card': {
    label: '闲家补牌',
    detail: '依牌例执行闲家补牌',
  },
  'deal-banker-third-card': {
    label: '庄家补牌',
    detail: '待闲家第三张公开后依牌例执行',
  },
  'announce-final-result': {
    label: '宣读最终结果',
    detail: '宣读双方最终点数与庄、闲或和',
  },
  'collect-losing-wagers': {
    label: '收取输注',
    detail: '先收取本局输注',
  },
  'return-pushed-wagers': {
    label: '退回和注',
    detail: '原额退回本局和注',
  },
  'pay-winning-wagers': {
    label: '支付派彩',
    detail: '再支付赢注与对子',
  },
  'record-road': {
    label: '路单记录',
    detail: '将本局结果写入路单',
  },
  'sweep-cards-to-discard-tray': {
    label: '收牌入盒',
    detail: '牌面集中移入弃牌盒',
  },
  'open-next-round': {
    label: '下一局准备',
    detail: '确认桌面后开放下一局',
  },
}

const STATUS_LABELS: Readonly<Record<DealerProcedureStepStatus, string>> = {
  complete: '已完成',
  active: '进行中',
  pending: '待进行',
}

const STATUS_CLASS_NAMES: Readonly<
  Record<DealerProcedureStepStatus, string>
> = {
  complete: 'completed',
  active: 'current',
  pending: 'pending',
}

function outcomeLabel(winner: 'player' | 'banker' | 'tie'): string {
  if (winner === 'player') return '闲家胜'
  if (winner === 'banker') return '庄家胜'
  return '和局'
}

function announcementText(
  announcement: DealerProcedureAnnouncement,
): string {
  const points = `闲家 ${announcement.playerTotal} 点，庄家 ${announcement.bankerTotal} 点`
  if (announcement.kind === 'initial-points') {
    return announcement.natural ? `${points}，天然牌` : points
  }
  return `${points}，${outcomeLabel(announcement.winner)}`
}

function dealerProcedureStepCopy(
  step: DealerProcedureStep,
): ProcedureCopy {
  if (step.kind === 'deal-opening-card') {
    const sideLabel = step.side ? SIDE_LABELS[step.side] : '牌桌'
    const cardNumber = step.handCardNumber ?? 1
    return {
      label: `${sideLabel}第 ${cardNumber} 张`,
      detail: '按闲、庄、闲、庄次序发牌',
    }
  }

  const standardCopy = STEP_COPY[step.kind]
  const announcement = step.announcement
    ? announcementText(step.announcement)
    : undefined
  const revealProgress =
    step.kind === 'reveal-opening-hands' && step.progress
      ? `已公开 ${step.progress.completed} / ${step.progress.total} 张开局牌`
      : undefined

  return {
    ...standardCopy,
    detail: announcement ?? revealProgress ?? standardCopy.detail,
    announcement,
  }
}

// Exported for the DOM-free unit harness; production calls it only from the
// component effect below.
// eslint-disable-next-line react-refresh/only-export-components
export function scrollDealerProcedureStepIntoView(
  element: Pick<HTMLElement, 'scrollIntoView'>,
  reducedMotion: boolean,
): void {
  element.scrollIntoView({
    block: 'nearest',
    inline: 'center',
    behavior: reducedMotion ? 'auto' : 'smooth',
  })
}

function reducedMotionIsPreferred(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export interface DealerProcedureTrackProps {
  plan: DealerProcedurePlan
  ariaLabel?: string
  className?: string
  /** Opt in only when no other dealer-call live region is mounted. */
  announceCurrentStep?: boolean
  autoScrollCurrentStep?: boolean
}

export function DealerProcedureTrack({
  plan,
  ariaLabel = '本局荷官程序',
  className = '',
  announceCurrentStep = false,
  autoScrollCurrentStep = true,
}: DealerProcedureTrackProps) {
  const currentStepRef = useRef<HTMLLIElement>(null)
  const currentIndex = plan.steps.findIndex(
    (step) => step.id === plan.activeStepId,
  )
  const currentStep = currentIndex >= 0 ? plan.steps[currentIndex] : null
  const currentCopy = currentStep ? dealerProcedureStepCopy(currentStep) : null

  useEffect(() => {
    const element = currentStepRef.current
    if (
      !autoScrollCurrentStep ||
      !element ||
      typeof element.scrollIntoView !== 'function'
    ) {
      return
    }

    scrollDealerProcedureStepIntoView(element, reducedMotionIsPreferred())
  }, [autoScrollCurrentStep, plan.activeStepId])

  return (
    <section
      className={`dealer-procedure-track ${className}`.trim()}
      aria-label={ariaLabel}
      data-dealer-procedure-track="true"
      data-current-step-id={currentStep?.id}
      data-current-index={currentIndex >= 0 ? currentIndex : undefined}
    >
      <header className="dealer-procedure-track__header">
        <strong>荷官程序</strong>
        <small data-current-call={currentCopy?.label}>
          {currentCopy ? `当前 · ${currentCopy.label}` : '等待程序开始'}
        </small>
      </header>

      {announceCurrentStep && (
        <p
          className="dealer-procedure-track__live"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {currentCopy
            ? `荷官：${currentCopy.announcement ?? currentCopy.label}`
            : ''}
        </p>
      )}

      <ol
        className="dealer-procedure-track__steps"
        aria-label="荷官程序进度"
        tabIndex={0}
      >
        {plan.steps.map((step, index) => {
          const copy = dealerProcedureStepCopy(step)
          const statusLabel = STATUS_LABELS[step.status]
          const statusClassName = STATUS_CLASS_NAMES[step.status]
          const isCurrent = step.id === plan.activeStepId

          return (
            <li
              ref={isCurrent ? currentStepRef : undefined}
              className={`dealer-procedure-track__step dealer-procedure-track__step--${statusClassName}`}
              data-procedure-step-id={step.id}
              data-procedure-kind={step.kind}
              data-procedure-state={step.status}
              aria-current={isCurrent ? 'step' : undefined}
              key={step.id}
            >
              <span className="dealer-procedure-track__marker" aria-hidden="true">
                {step.status === 'complete' ? '✓' : index + 1}
              </span>
              <span className="dealer-procedure-track__copy">
                <strong>{copy.label}</strong>
                <small>{copy.detail}</small>
              </span>
              <span className="dealer-procedure-track__state">{statusLabel}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
