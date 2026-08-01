import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProbabilityLab } from './ProbabilityLab'

describe('ProbabilityLab', () => {
  it('offers only the supported exact sample sizes and discloses isolation', () => {
    const markup = renderToStaticMarkup(<ProbabilityLab initialRounds={1_000} />)

    expect(markup).toContain('data-probability-lab="true"')
    expect(markup).toContain('data-lab-status="idle"')
    expect(markup).toContain('100 局')
    expect(markup).toContain('1,000 局')
    expect(markup).toContain('10,000 局')
    expect(markup).toContain('不读取或写入正式牌局')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('取消')
  })

  it('can select a different supported initial size without running a Worker during render', () => {
    const markup = renderToStaticMarkup(
      <ProbabilityLab
        initialRounds={10_000}
        workerFactory={() => {
          throw new Error('must not run during server render')
        }}
      />,
    )

    expect(markup).toMatch(/aria-pressed="true"[^>]*>10,000 局/)
    expect(markup).toContain('请选择 100、1,000 或 10,000 局。')
    expect(markup).not.toContain('must not run during server render')
  })
})
