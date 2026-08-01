import { describe, expect, it } from 'vitest'
import { AUDIO_SAMPLE_MANIFEST } from './audioAssets'

describe('audio sample manifest', () => {
  it('keeps source and CC0 provenance on every deployed recording', () => {
    for (const asset of Object.values(AUDIO_SAMPLE_MANIFEST)) {
      expect(asset.license).toBe('CC0-1.0')
      expect(asset.licenseUrl).toBe(
        'https://creativecommons.org/publicdomain/zero/1.0/',
      )
      expect(asset.source).toMatch(/^https:\/\//)
      expect(asset.originalFilename.length).toBeGreaterThan(0)
    }
  })

  it('prefers PCM WAV for short effects and keeps room ambience isolated', () => {
    const effects = Object.values(AUDIO_SAMPLE_MANIFEST).filter(
      (asset) => asset.channel === 'effects',
    )
    expect(effects.length).toBeGreaterThan(0)
    expect(effects.every((asset) => asset.urls[0].endsWith('.wav'))).toBe(
      true,
    )
    expect(
      effects.every((asset) => asset.urls.some((url) => url.endsWith('.ogg'))),
    ).toBe(true)

    expect(AUDIO_SAMPLE_MANIFEST['room-crowd-loop']).toMatchObject({
      channel: 'ambient',
      urls: ['/assets/audio/room-crowd-loop.ogg'],
    })
  })
})
