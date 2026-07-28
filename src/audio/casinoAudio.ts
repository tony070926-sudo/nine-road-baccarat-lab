import type { CrowdCheerTone } from '../game/crowdCheer'
import type { Winner } from '../types'
import {
  crowdIntensity,
  panForSide,
  type AudioSide,
} from './spatialAudio'

const SOUND_PREFERENCE_KEY = 'nine-road-baccarat:table-audio'
const AMBIENT_LEVEL = 0.018
const MAX_EVENT_IDS = 128

export function loadAudioPreference(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(SOUND_PREFERENCE_KEY) === 'on'
  } catch {
    return false
  }
}

function saveAudioPreference(enabled: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SOUND_PREFERENCE_KEY, enabled ? 'on' : 'off')
  } catch {
    // Audio remains usable for this page even if storage is blocked.
  }
}

interface AudioGraph {
  context: AudioContext
  master: GainNode
  effects: GainNode
  ambient: GainNode
  compressor: DynamicsCompressorNode
}

class CasinoAudioDirector {
  private graph: AudioGraph | null = null
  private enabled = false
  private ambientSource: AudioBufferSourceNode | null = null
  private ambientLfo: OscillatorNode | null = null
  private ambientLfoGain: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private recentEventIds: string[] = []
  private recentEventSet = new Set<string>()
  private lastSqueezeAt = 0
  private pageVisible = true
  private lifecycleEpoch = 0
  private suspendTimer: number | null = null
  private suspendPromise: Promise<void> | null = null

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) {
      saveAudioPreference(enabled)
      return
    }

    this.enabled = enabled
    this.lifecycleEpoch += 1
    saveAudioPreference(enabled)

    if (!enabled) {
      this.fadeMaster(0)
      this.stopAmbient()
      this.scheduleSuspend(this.lifecycleEpoch)
    } else {
      this.cancelSuspend()
    }
  }

  isEnabled() {
    return this.enabled
  }

  async unlock(): Promise<boolean> {
    if (
      !this.enabled ||
      !this.pageVisible ||
      typeof window === 'undefined'
    ) {
      return false
    }

    const epoch = this.lifecycleEpoch
    try {
      this.cancelSuspend()
      const graph = this.ensureGraph()
      const pendingSuspend = this.suspendPromise
      if (pendingSuspend) {
        await pendingSuspend
      }
      if (
        !this.enabled ||
        !this.pageVisible ||
        epoch !== this.lifecycleEpoch
      ) {
        return false
      }
      if (graph.context.state === 'suspended') {
        await graph.context.resume()
      }
      if (
        graph.context.state !== 'running' ||
        epoch !== this.lifecycleEpoch
      ) {
        if (!this.enabled || !this.pageVisible) {
          this.fadeMaster(0)
          this.stopAmbient()
          this.scheduleSuspend(this.lifecycleEpoch)
        }
        return false
      }
      if (!this.enabled || !this.pageVisible) {
        this.fadeMaster(0)
        this.stopAmbient()
        this.scheduleSuspend(this.lifecycleEpoch)
        return false
      }

      const now = graph.context.currentTime
      graph.master.gain.cancelScheduledValues(now)
      graph.master.gain.setValueAtTime(graph.master.gain.value, now)
      graph.master.gain.linearRampToValueAtTime(0.72, now + 0.035)
      this.startAmbient()
      return true
    } catch {
      return false
    }
  }

  async setPageVisible(visible: boolean) {
    if (this.pageVisible === visible) return

    this.pageVisible = visible
    this.lifecycleEpoch += 1
    const graph = this.graph
    if (!graph) return

    if (!visible) {
      this.fadeMaster(0)
      this.stopAmbient()
      this.scheduleSuspend(this.lifecycleEpoch)
      return
    }

    this.cancelSuspend()
    if (this.enabled) {
      await this.unlock()
    }
  }

  playChip(eventId: string, side: AudioSide = 'center') {
    this.schedule(eventId, (graph) => {
      const now = graph.context.currentTime
      const pan = panForSide(side)
      ;[690, 930, 1_270].forEach((frequency, index) => {
        const oscillator = graph.context.createOscillator()
        const gain = graph.context.createGain()
        oscillator.type = index === 0 ? 'sine' : 'triangle'
        oscillator.frequency.setValueAtTime(frequency, now + index * 0.012)
        oscillator.frequency.exponentialRampToValueAtTime(
          frequency * 0.72,
          now + 0.075 + index * 0.012,
        )
        gain.gain.setValueAtTime(0.0001, now + index * 0.012)
        gain.gain.exponentialRampToValueAtTime(
          0.085 / (index + 1),
          now + 0.006 + index * 0.012,
        )
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + 0.085 + index * 0.012,
        )
        oscillator.connect(gain)
        this.connectWithPan(graph, gain, pan)
        oscillator.start(now + index * 0.012)
        oscillator.stop(now + 0.1 + index * 0.012)
      })
      this.noiseBurst(graph, now, 0.035, 2_900, pan, 0.025)
    })
  }

  playRoundOpen(eventId: string) {
    this.schedule(eventId, (graph) => {
      this.duckAmbient(graph, 0.55)
      const now = graph.context.currentTime
      this.tone(graph, now, 392, 0.16, 0, 0.08)
      this.tone(graph, now + 0.09, 587, 0.22, 0, 0.065)
    })
  }

  playDealStart(eventId: string, side: Exclude<AudioSide, 'center'>) {
    this.schedule(eventId, (graph) => {
      const context = graph.context
      const now = context.currentTime
      const source = context.createBufferSource()
      const bandpass = context.createBiquadFilter()
      const gain = context.createGain()
      const panner = this.createPanner(context, 0.35)
      source.buffer = this.ensureNoiseBuffer(context)
      bandpass.type = 'bandpass'
      bandpass.frequency.setValueAtTime(2_400, now)
      bandpass.frequency.exponentialRampToValueAtTime(850, now + 0.24)
      bandpass.Q.value = 0.75
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.095, now + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.27)
      if (panner) {
        panner.pan.setValueAtTime(0.35, now)
        panner.pan.linearRampToValueAtTime(panForSide(side), now + 0.24)
        source.connect(bandpass).connect(gain).connect(panner).connect(graph.effects)
      } else {
        source.connect(bandpass).connect(gain).connect(graph.effects)
      }
      source.start(now)
      source.stop(now + 0.29)
    })
  }

  playCardLand(eventId: string, side: Exclude<AudioSide, 'center'>) {
    this.schedule(eventId, (graph) => {
      const now = graph.context.currentTime
      const pan = panForSide(side)
      this.noiseBurst(graph, now, 0.055, 780, pan, 0.06)
      this.tone(graph, now, 118, 0.065, pan, 0.04)
    })
  }

  playRevealStart(
    eventId: string,
    side: Exclude<AudioSide, 'center'>,
    automatic: boolean,
  ) {
    this.schedule(eventId, (graph) => {
      const now = graph.context.currentTime
      this.noiseBurst(
        graph,
        now,
        automatic ? 0.08 : 0.13,
        automatic ? 1_650 : 1_180,
        panForSide(side),
        automatic ? 0.045 : 0.058,
      )
    })
  }

  playRevealComplete(
    eventId: string,
    side: Exclude<AudioSide, 'center'>,
  ) {
    this.schedule(eventId, (graph) => {
      const now = graph.context.currentTime
      const pan = panForSide(side)
      this.noiseBurst(graph, now, 0.045, 2_250, pan, 0.055)
      this.tone(graph, now + 0.018, 760, 0.07, pan, 0.025)
    })
  }

  playCrowd(
    eventId: string,
    tone: CrowdCheerTone,
    side: Exclude<AudioSide, 'center'>,
  ) {
    this.schedule(eventId, (graph) => {
      const intensity = crowdIntensity(tone)
      const now = graph.context.currentTime
      const basePan = panForSide(side)
      const voices = tone === 'celebration' ? 4 : tone === 'hush' ? 1 : 3

      for (let index = 0; index < voices; index += 1) {
        this.noiseBurst(
          graph,
          now + index * 0.055,
          0.18 + index * 0.035,
          420 + index * 95,
          Math.max(-0.9, Math.min(0.9, basePan + (index - 1) * 0.12)),
          0.028 * intensity,
        )
      }
    })
  }

  playSettlement(
    eventId: string,
    winner: Winner,
    net: number,
    fly: boolean,
  ) {
    this.schedule(eventId, (graph) => {
      this.duckAmbient(graph, 0.7)
      const now = graph.context.currentTime
      const resultPan =
        winner === 'tie' ? 0 : panForSide(winner === 'player' ? 'player' : 'banker')
      const frequencies =
        winner === 'tie'
          ? [440, 440]
          : net >= 0 || fly
            ? [392, 523, 659]
            : [440, 349, 294]

      frequencies.forEach((frequency, index) => {
        this.tone(
          graph,
          now + index * 0.09,
          frequency,
          0.18,
          resultPan,
          0.052,
        )
      })

      this.noiseBurst(graph, now + 0.2, 0.04, 2_600, resultPan, 0.035)
      if (!fly && net !== 0) {
        this.playChip(`${eventId}:chips`, net > 0 ? 'player' : 'banker')
      }
    })
  }

  playNewShoe(eventId: string) {
    this.schedule(eventId, (graph) => {
      const now = graph.context.currentTime
      this.noiseBurst(graph, now, 0.22, 1_300, 0.25, 0.06)
      this.noiseBurst(graph, now + 0.11, 0.18, 1_850, -0.2, 0.045)
    })
  }

  playSqueeze(side: Exclude<AudioSide, 'center'>, progress: number) {
    const graph = this.graph
    if (
      !this.enabled ||
      !graph ||
      graph.context.state !== 'running' ||
      progress <= 0.02
    ) {
      return
    }

    const nowMs = performance.now()
    if (nowMs - this.lastSqueezeAt < 54) return
    this.lastSqueezeAt = nowMs

    const now = graph.context.currentTime
    this.noiseBurst(
      graph,
      now,
      0.035,
      760 + progress * 1_200,
      panForSide(side),
      0.018 + progress * 0.018,
    )
  }

  playSqueezeRelease(
    eventId: string,
    side: Exclude<AudioSide, 'center'>,
    committed: boolean,
  ) {
    this.schedule(eventId, (graph) => {
      const now = graph.context.currentTime
      const pan = panForSide(side)
      this.noiseBurst(
        graph,
        now,
        committed ? 0.075 : 0.045,
        committed ? 1_850 : 620,
        pan,
        committed ? 0.055 : 0.026,
      )
      if (committed) this.tone(graph, now + 0.02, 680, 0.07, pan, 0.022)
    })
  }

  private schedule(eventId: string, render: (graph: AudioGraph) => void) {
    if (
      !this.enabled ||
      !this.pageVisible ||
      this.recentEventSet.has(eventId)
    ) {
      return
    }

    const epoch = this.lifecycleEpoch
    void this.unlock().then((ready) => {
      if (
        !ready ||
        !this.enabled ||
        !this.pageVisible ||
        epoch !== this.lifecycleEpoch ||
        this.recentEventSet.has(eventId) ||
        !this.graph
      ) {
        return
      }
      this.rememberEvent(eventId)
      render(this.graph)
    })
  }

  private rememberEvent(eventId: string) {
    this.recentEventSet.add(eventId)
    this.recentEventIds.push(eventId)
    if (this.recentEventIds.length <= MAX_EVENT_IDS) return

    const oldest = this.recentEventIds.shift()
    if (oldest) this.recentEventSet.delete(oldest)
  }

  private ensureGraph(): AudioGraph {
    if (this.graph) return this.graph

    const AudioContextConstructor =
      window.AudioContext ||
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext
        }
      ).webkitAudioContext
    if (!AudioContextConstructor) {
      throw new Error('Web Audio API is unavailable')
    }

    const context = new AudioContextConstructor()
    const master = context.createGain()
    const effects = context.createGain()
    const ambient = context.createGain()
    const compressor = context.createDynamicsCompressor()
    master.gain.value = 0
    effects.gain.value = 0.72
    ambient.gain.value = AMBIENT_LEVEL
    compressor.threshold.value = -16
    compressor.knee.value = 14
    compressor.ratio.value = 5
    compressor.attack.value = 0.006
    compressor.release.value = 0.18
    effects.connect(compressor)
    ambient.connect(compressor)
    compressor.connect(master)
    master.connect(context.destination)
    this.graph = { context, master, effects, ambient, compressor }
    return this.graph
  }

  private ensureNoiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer

    const length = Math.ceil(context.sampleRate * 1.4)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    let seed = 0x9e3779b9
    let previous = 0
    for (let index = 0; index < data.length; index += 1) {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      const white = ((seed >>> 0) / 0xffffffff) * 2 - 1
      previous = previous * 0.78 + white * 0.22
      data[index] = previous
    }
    this.noiseBuffer = buffer
    return buffer
  }

  private startAmbient() {
    const graph = this.graph
    if (!graph || this.ambientSource || graph.context.state !== 'running') return

    const context = graph.context
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const panner = this.createPanner(context, 0)
    const lfo = context.createOscillator()
    const lfoGain = context.createGain()
    source.buffer = this.ensureNoiseBuffer(context)
    source.loop = true
    filter.type = 'lowpass'
    filter.frequency.value = 520
    filter.Q.value = 0.45
    if (panner) {
      source.connect(filter).connect(panner).connect(graph.ambient)
    } else {
      source.connect(filter).connect(graph.ambient)
    }
    lfo.type = 'sine'
    lfo.frequency.value = 0.085
    lfoGain.gain.value = 0.004
    lfo.connect(lfoGain).connect(graph.ambient.gain)
    source.start()
    lfo.start()
    this.ambientSource = source
    this.ambientLfo = lfo
    this.ambientLfoGain = lfoGain
  }

  private stopAmbient() {
    try {
      this.ambientSource?.stop()
      this.ambientLfo?.stop()
    } catch {
      // Nodes may already be stopped after a visibility transition.
    }
    this.ambientSource?.disconnect()
    this.ambientLfo?.disconnect()
    this.ambientLfoGain?.disconnect()
    this.ambientSource = null
    this.ambientLfo = null
    this.ambientLfoGain = null
  }

  private cancelSuspend() {
    if (this.suspendTimer === null) return
    window.clearTimeout(this.suspendTimer)
    this.suspendTimer = null
  }

  private scheduleSuspend(epoch: number) {
    const graph = this.graph
    if (!graph || typeof window === 'undefined') return

    this.cancelSuspend()
    this.suspendTimer = window.setTimeout(() => {
      this.suspendTimer = null
      if (
        epoch !== this.lifecycleEpoch ||
        (this.enabled && this.pageVisible) ||
        graph.context.state !== 'running'
      ) {
        return
      }
      const suspendPromise = graph.context.suspend().catch(() => undefined)
      this.suspendPromise = suspendPromise
      void suspendPromise.finally(() => {
        if (this.suspendPromise === suspendPromise) {
          this.suspendPromise = null
        }
      })
    }, 45)
  }

  private fadeMaster(target: number) {
    const graph = this.graph
    if (!graph) return
    const now = graph.context.currentTime
    graph.master.gain.cancelScheduledValues(now)
    graph.master.gain.setValueAtTime(graph.master.gain.value, now)
    graph.master.gain.linearRampToValueAtTime(target, now + 0.035)
  }

  private duckAmbient(graph: AudioGraph, duration: number) {
    const now = graph.context.currentTime
    graph.ambient.gain.cancelScheduledValues(now)
    graph.ambient.gain.setValueAtTime(graph.ambient.gain.value, now)
    graph.ambient.gain.linearRampToValueAtTime(0.007, now + 0.025)
    graph.ambient.gain.linearRampToValueAtTime(AMBIENT_LEVEL, now + duration)
  }

  private createPanner(
    context: AudioContext,
    pan: number,
  ): StereoPannerNode | null {
    if (!('createStereoPanner' in context)) return null
    const panner = context.createStereoPanner()
    panner.pan.value = pan
    return panner
  }

  private connectWithPan(
    graph: AudioGraph,
    node: AudioNode,
    pan: number,
  ) {
    const panner = this.createPanner(graph.context, pan)
    if (panner) {
      node.connect(panner).connect(graph.effects)
    } else {
      node.connect(graph.effects)
    }
  }

  private noiseBurst(
    graph: AudioGraph,
    start: number,
    duration: number,
    frequency: number,
    pan: number,
    volume: number,
  ) {
    const context = graph.context
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = this.ensureNoiseBuffer(context)
    filter.type = 'bandpass'
    filter.frequency.value = frequency
    filter.Q.value = 0.65
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008)
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      start + Math.max(0.018, duration),
    )
    source.connect(filter).connect(gain)
    this.connectWithPan(graph, gain, pan)
    source.start(start)
    source.stop(start + duration + 0.015)
  }

  private tone(
    graph: AudioGraph,
    start: number,
    frequency: number,
    duration: number,
    pan: number,
    volume: number,
  ) {
    const oscillator = graph.context.createOscillator()
    const gain = graph.context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, start)
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(40, frequency * 0.92),
      start + duration,
    )
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    oscillator.connect(gain)
    this.connectWithPan(graph, gain, pan)
    oscillator.start(start)
    oscillator.stop(start + duration + 0.02)
  }
}

export const casinoAudio = new CasinoAudioDirector()
