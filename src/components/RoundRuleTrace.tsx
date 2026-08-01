import type { DealResult } from '../types'
import { buildDrawExplanation } from '../game/drawExplanation'

interface RoundRuleTraceProps {
  result: DealResult
  revealedCount: number
}

export function RoundRuleTrace({
  result,
  revealedCount,
}: RoundRuleTraceProps) {
  const steps = buildDrawExplanation(result, revealedCount)

  return (
    <section
      className="round-rule-trace"
      data-round-rule-trace="true"
      data-revealed-count={Math.max(0, Math.trunc(revealedCount))}
      aria-label="本局补牌规则解释"
      aria-live="polite"
    >
      <header>
        <strong>本局规则轨迹</strong>
        <small>只根据已公开牌面解释</small>
      </header>
      <ol>
        {steps.map((step) => (
          <li
            key={step.id}
            data-rule-stage={step.stage}
            data-rule-decision={step.decision}
          >
            <strong>{step.title}</strong>
            <span>{step.explanation}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
