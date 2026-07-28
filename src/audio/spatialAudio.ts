import type { CrowdCheerTone } from '../game/crowdCheer'

export type AudioSide = 'player' | 'banker' | 'center'

export function panForSide(side: AudioSide): number {
  if (side === 'player') return -0.55
  if (side === 'banker') return 0.55
  return 0
}

export function crowdIntensity(tone: CrowdCheerTone): number {
  if (tone === 'celebration') return 1
  if (tone === 'anticipation') return 0.72
  if (tone === 'reaction') return 0.58
  return 0.34
}
