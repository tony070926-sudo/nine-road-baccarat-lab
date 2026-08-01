import './DealerProcedureTrack.css'

export type DealerProcedureStage =
  | 'open-betting'
  | 'close-betting'
  | 'initial-deal'
  | 'opening-points'
  | 'player-third-card'
  | 'banker-third-card'
  | 'announce-result'
  | 'collect-losing-bets'
  | 'pay-winning-bets'
  | 'record-road'
  | 'sweep-cards'
  | 'prepare-next-round'

export interface DealerProcedureStep {
  stage: string
  label: string
  detail?: string
  announcement?: string
}

const STANDARD_DEALER_PROCEDURE_STEPS = [
  {
    stage: 'open-betting',
    label: '请下注',
    detail: '开放本局下注',
  },
  {
    stage: 'close-betting',
    label: '停止下注',
    detail: '锁定本局下注区',
  },
  {
    stage: 'initial-deal',
    label: '初始牌',
    detail: '按闲、庄、闲、庄次序发牌',
  },
  {
    stage: 'opening-points',
    label: '报点',
    detail: '宣读双方已公开点数',
  },
  {
    stage: 'player-third-card',
    label: '闲家补牌',
    detail: '依牌例执行闲家补牌',
  },
  {
    stage: 'banker-third-card',
    label: '庄家补牌',
    detail: '依第三张牌规则执行',
  },
  {
    stage: 'announce-result',
    label: '开牌结果',
    detail: '宣读庄、闲或和',
  },
  {
    stage: 'collect-losing-bets',
    label: '收取输注',
    detail: '先收取本局输注',
  },
  {
    stage: 'pay-winning-bets',
    label: '支付派彩',
    detail: '再支付赢注与对子',
  },
  {
    stage: 'record-road',
    label: '路单记录',
    detail: '将本局结果写入路单',
  },
  {
    stage: 'sweep-cards',
    label: '收牌入盒',
    detail: '牌面集中移入弃牌盒',
  },
  {
    stage: 'prepare-next-round',
    label: '下一局准备',
    detail: '确认桌面后开放下一局',
  },
] as const satisfies readonly (DealerProcedureStep & {
  stage: DealerProcedureStage
})[]

type ProcedureState = 'completed' | 'current' | 'pending'

export interface DealerProcedureTrackProps {
  currentStage: string | null
  steps?: readonly DealerProcedureStep[]
  ariaLabel?: string
  className?: string
}

const STATE_LABELS: Readonly<Record<ProcedureState, string>> = {
  completed: '已完成',
  current: '进行中',
  pending: '待进行',
}

function stateAt(index: number, currentIndex: number): ProcedureState {
  if (currentIndex < 0 || index > currentIndex) return 'pending'
  if (index < currentIndex) return 'completed'
  return 'current'
}

export function DealerProcedureTrack({
  currentStage,
  steps = STANDARD_DEALER_PROCEDURE_STEPS,
  ariaLabel = '本局荷官程序',
  className = '',
}: DealerProcedureTrackProps) {
  const currentIndex =
    currentStage === null
      ? -1
      : steps.findIndex((step) => step.stage === currentStage)
  const currentStep = currentIndex >= 0 ? steps[currentIndex] : null

  return (
    <section
      className={`dealer-procedure-track ${className}`.trim()}
      aria-label={ariaLabel}
      data-dealer-procedure-track="true"
      data-current-stage={currentStep?.stage}
      data-current-index={currentIndex >= 0 ? currentIndex : undefined}
    >
      <header className="dealer-procedure-track__header">
        <strong>荷官程序</strong>
        <small data-current-call={currentStep?.label}>
          {currentStep ? `当前 · ${currentStep.label}` : '等待程序开始'}
        </small>
      </header>

      <p
        className="dealer-procedure-track__live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {currentStep
          ? `荷官：${currentStep.announcement ?? currentStep.label}`
          : ''}
      </p>

      <ol className="dealer-procedure-track__steps" aria-label="荷官程序进度">
        {steps.map((step, index) => {
          const state = stateAt(index, currentIndex)
          const statusLabel = STATE_LABELS[state]

          return (
            <li
              className={`dealer-procedure-track__step dealer-procedure-track__step--${state}`}
              data-procedure-stage={step.stage}
              data-procedure-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
              key={step.stage}
            >
              <span className="dealer-procedure-track__marker" aria-hidden="true">
                {state === 'completed' ? '✓' : index + 1}
              </span>
              <span className="dealer-procedure-track__copy">
                <strong>{step.label}</strong>
                {step.detail && <small>{step.detail}</small>}
              </span>
              <span className="dealer-procedure-track__state">{statusLabel}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
