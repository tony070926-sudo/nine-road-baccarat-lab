import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AudioMixControls } from './AudioMixControls'

describe('AudioMixControls', () => {
  it('exposes four labelled, bounded audio channels', () => {
    const markup = renderToStaticMarkup(
      <AudioMixControls
        mix={{ master: 0.8, effects: 0.6, ambient: 0.25, voice: 0 }}
        onChange={vi.fn()}
      />,
    )

    expect(markup.match(/type="range"/g)).toHaveLength(4)
    expect(markup).toContain('data-audio-channel="master"')
    expect(markup).toContain('data-audio-channel="effects"')
    expect(markup).toContain('data-audio-channel="ambient"')
    expect(markup).toContain('data-audio-channel="voice"')
    expect(markup).toContain('aria-valuetext="80%"')
    expect(markup).toContain('aria-valuetext="0%"')
    expect(markup).toContain('不写入牌靴快照')
  })
})
