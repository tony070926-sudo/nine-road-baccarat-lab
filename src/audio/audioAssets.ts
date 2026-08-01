export type AudioAssetChannel = 'effects' | 'ambient'

export interface AudioSampleAsset {
  urls: readonly string[]
  channel: AudioAssetChannel
  license: 'CC0-1.0'
  licenseUrl: string
  source: string
  originalFilename: string
}

const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/'
const KENNEY_SOURCE = 'https://kenney.nl/assets/casino-audio'

function kenneyEffect(stem: string): AudioSampleAsset {
  return {
    urls: [
      `/assets/audio/${stem}.wav`,
      `/assets/audio/${stem}.ogg`,
    ],
    channel: 'effects',
    license: 'CC0-1.0',
    licenseUrl: CC0_URL,
    source: KENNEY_SOURCE,
    originalFilename: `Audio/${stem}.ogg`,
  }
}

export const AUDIO_SAMPLE_MANIFEST = {
  'card-fan-1': kenneyEffect('card-fan-1'),
  'card-place-1': kenneyEffect('card-place-1'),
  'card-place-2': kenneyEffect('card-place-2'),
  'card-shove-1': kenneyEffect('card-shove-1'),
  'card-shove-2': kenneyEffect('card-shove-2'),
  'card-shuffle': kenneyEffect('card-shuffle'),
  'card-slide-1': kenneyEffect('card-slide-1'),
  'card-slide-2': kenneyEffect('card-slide-2'),
  'chip-lay-1': kenneyEffect('chip-lay-1'),
  'chip-lay-2': kenneyEffect('chip-lay-2'),
  'chips-collide-1': kenneyEffect('chips-collide-1'),
  'chips-collide-2': kenneyEffect('chips-collide-2'),
  'chips-handle-1': kenneyEffect('chips-handle-1'),
  'chips-handle-2': kenneyEffect('chips-handle-2'),
  'chips-stack-1': kenneyEffect('chips-stack-1'),
  'chips-stack-2': kenneyEffect('chips-stack-2'),
  'room-crowd-loop': {
    urls: ['/assets/audio/room-crowd-loop.ogg'],
    channel: 'ambient',
    license: 'CC0-1.0',
    licenseUrl: CC0_URL,
    source: 'https://freesound.org/people/Breviceps/sounds/457043/',
    originalFilename: '457043_9159316-lq.ogg',
  },
} as const satisfies Record<string, AudioSampleAsset>

export type AudioSampleId = keyof typeof AUDIO_SAMPLE_MANIFEST

export const CARD_FAN_SAMPLES = ['card-fan-1'] as const
export const CARD_PLACE_SAMPLES = [
  'card-place-1',
  'card-place-2',
] as const
export const CARD_SHOVE_SAMPLES = [
  'card-shove-1',
  'card-shove-2',
] as const
export const CARD_SLIDE_SAMPLES = [
  'card-slide-1',
  'card-slide-2',
] as const
export const CHIP_LAY_SAMPLES = ['chip-lay-1', 'chip-lay-2'] as const
export const CHIP_COLLIDE_SAMPLES = [
  'chips-collide-1',
  'chips-collide-2',
] as const
export const CHIP_HANDLE_SAMPLES = [
  'chips-handle-1',
  'chips-handle-2',
] as const
export const CHIP_STACK_SAMPLES = [
  'chips-stack-1',
  'chips-stack-2',
] as const

export const AUDIO_PRELOAD_SAMPLE_IDS = Object.freeze(
  Object.keys(AUDIO_SAMPLE_MANIFEST) as AudioSampleId[],
)

export function sampleForEvent(
  eventId: string,
  candidates: readonly AudioSampleId[],
): AudioSampleId {
  let hash = 2_166_136_261
  for (let index = 0; index < eventId.length; index += 1) {
    hash ^= eventId.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return candidates[(hash >>> 0) % candidates.length]
}
