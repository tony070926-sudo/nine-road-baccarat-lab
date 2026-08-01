import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ExperienceSettings } from './ExperienceSettings'

describe('ExperienceSettings', () => {
  it('renders an accessible native radio group for all pace profiles', () => {
    const markup = renderToStaticMarkup(
      <ExperienceSettings
        motionProfile="standard"
        onMotionProfileChange={vi.fn()}
      />,
    )

    expect(markup).toContain('data-experience-settings="true"')
    expect(markup).toContain('aria-labelledby=')
    expect(markup).toContain('<fieldset')
    expect(markup).toContain('<legend>牌桌节奏</legend>')
    expect(markup.match(/type="radio"/g)).toHaveLength(3)
    expect(markup).toContain('data-motion-profile-option="cinematic"')
    expect(markup).toContain('data-motion-profile-option="standard"')
    expect(markup).toContain('data-motion-profile-option="fast"')
    expect(markup).toMatch(/<input[^>]*checked=""[^>]*value="standard"/)
    expect(markup).toContain('完整呈现发牌动作与结果停留')
  })

  it('announces reduced motion while retaining the chosen pace', () => {
    const markup = renderToStaticMarkup(
      <ExperienceSettings
        motionProfile="cinematic"
        effectiveMotionProfile="reduced"
        onMotionProfileChange={vi.fn()}
      />,
    )

    expect(markup).toContain('data-effective-motion-profile="reduced"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('所选节奏仍会保存')
    expect(markup).toMatch(/<input[^>]*checked=""[^>]*value="cinematic"/)
  })

  it('accepts nested controls and propagates the disabled state', () => {
    const markup = renderToStaticMarkup(
      <ExperienceSettings
        motionProfile="fast"
        disabled
        onMotionProfileChange={vi.fn()}
      >
        <section aria-label="牌桌声音分轨">音频设置</section>
      </ExperienceSettings>,
    )

    expect(markup).toContain('<fieldset disabled=""')
    expect(markup).toContain('data-experience-settings-extra="true"')
    expect(markup).toContain('aria-label="牌桌声音分轨"')
    expect(markup).toContain('音频设置')
  })
})
