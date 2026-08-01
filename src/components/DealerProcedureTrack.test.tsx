import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DealerProcedureTrack } from './DealerProcedureTrack'

describe('DealerProcedureTrack', () => {
  it('renders the complete standard casino procedure without player hit choices', () => {
    const markup = renderToStaticMarkup(
      <DealerProcedureTrack
        currentStage="open-betting"
      />,
    )

    expect(markup.match(/data-procedure-stage=/g)).toHaveLength(12)
    ;[
      '请下注',
      '停止下注',
      '初始牌',
      '报点',
      '闲家补牌',
      '庄家补牌',
      '开牌结果',
      '收取输注',
      '支付派彩',
      '路单记录',
      '收牌入盒',
      '下一局准备',
    ].forEach((call) => expect(markup).toContain(call))
    expect(markup).toContain('依牌例执行闲家补牌')
    expect(markup).not.toMatch(/玩家.{0,4}(?:选择|要牌|停牌)/)
  })

  it('marks completed, current and pending steps from the current stage', () => {
    const markup = renderToStaticMarkup(
      <DealerProcedureTrack
        currentStage="banker-third-card"
      />,
    )

    expect(markup.match(/data-procedure-state="completed"/g)).toHaveLength(5)
    expect(markup.match(/data-procedure-state="current"/g)).toHaveLength(1)
    expect(markup.match(/data-procedure-state="pending"/g)).toHaveLength(6)
    expect(markup.match(/aria-current="step"/g)).toHaveLength(1)
    expect(markup).toMatch(
      /data-procedure-stage="banker-third-card"[^>]*data-procedure-state="current"[^>]*aria-current="step"/,
    )
  })

  it('keeps only the current dealer call in one polite live region', () => {
    const markup = renderToStaticMarkup(
      <DealerProcedureTrack
        currentStage="announce-result"
      />,
    )

    expect(markup.match(/aria-live=/g)).toHaveLength(1)
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('aria-atomic="true"')
    expect(markup).toContain('荷官：开牌结果')
  })

  it('accepts a planner-provided round-specific sequence and announcement', () => {
    const steps = [
      { stage: 'bets-open', label: '请下注' },
      {
        stage: 'final-call',
        label: '停止下注',
        announcement: '本局停止下注',
      },
      { stage: 'result', label: '开牌结果' },
    ] as const
    const markup = renderToStaticMarkup(
      <DealerProcedureTrack
        currentStage="final-call"
        steps={steps}
        ariaLabel="高速桌荷官程序"
        className="table-overlay"
      />,
    )

    expect(markup).toContain(
      'class="dealer-procedure-track table-overlay"',
    )
    expect(markup).toContain('aria-label="高速桌荷官程序"')
    expect(markup).toContain('data-current-stage="final-call"')
    expect(markup).toContain('荷官：本局停止下注')
    expect(markup.match(/data-procedure-stage=/g)).toHaveLength(3)
  })

  it('leaves every step pending when no current stage is available', () => {
    const markup = renderToStaticMarkup(
      <DealerProcedureTrack
        currentStage={null}
      />,
    )

    expect(markup.match(/data-procedure-state="pending"/g)).toHaveLength(12)
    expect(markup).not.toContain('aria-current="step"')
    expect(markup).toContain('等待程序开始')
  })
})
