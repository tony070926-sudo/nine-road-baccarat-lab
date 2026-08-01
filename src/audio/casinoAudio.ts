import type { CrowdCheerTone } from '../game/crowdCheer'
import type { SettlementActionKind } from '../game/settlementMotion'
import type { Winner } from '../types'
import {
  AUDIO_PRELOAD_SAMPLE_IDS,
  AUDIO_SAMPLE_MANIFEST,
  CARD_FAN_SAMPLES,
  CARD_PLACE_SAMPLES,
  CARD_SHOVE_SAMPLES,
  CARD_SLIDE_SAMPLES,
  CHIP_COLLIDE_SAMPLES,
  CHIP_HANDLE_SAMPLES,
  CHIP_LAY_SAMPLES,
  CHIP_STACK_SAMPLES,
  sampleForEvent,
  type AudioSampleId,
} from './audioAssets'
import {
  crowdIntensity,
  panForSide,
  type AudioSide,
} from './spatialAudio'

const SOUND_PREFERENCE_KEY = 'nine-road-baccarat:table-audio'
const AUDIO_MIX_KEY = 'nine-road-baccarat:audio-mix-v1'
const AMBIENT_LEVEL = 0.018
const MASTER_LEVEL = 0.72
const MAX_EVENT_IDS = 128
export const AUDIO_SAMPLE_RETRY_MS = 600_000

export type CasinoAudioMixChannel =
  | 'master'
  | 'effects'
  | 'ambient'
  | 'voice'

export interface CasinoAudioMix {
  master: number
  effects: number
  ambient: number
  voice: number
}

export const DEFAULT_CASINO_AUDIO_MIX: Readonly<CasinoAudioMix> =
  Object.freeze({
    master: 1,
    effects: 1,
    ambient: 1,
    voice: 1,
  })

function normalizeMixLevel(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback
}

function normalizeAudioMix(value: unknown): CasinoAudioMix {
  const candidate =
    value && typeof value === 'object'
      ? (value as Partial<Record<CasinoAudioMixChannel, unknown>>)
      : {}
  return {
    master: normalizeMixLevel(
      candidate.master,
      DEFAULT_CASINO_AUDIO_MIX.master,
    ),
    effects: normalizeMixLevel(
      candidate.effects,
      DEFAULT_CASINO_AUDIO_MIX.effects,
    ),
    ambient: normalizeMixLevel(
      candidate.ambient,
      DEFAULT_CASINO_AUDIO_MIX.ambient,
    ),
    voice: normalizeMixLevel(
      candidate.voice,
      DEFAULT_CASINO_AUDIO_MIX.voice,
    ),
  }
}

export function loadAudioMix(): CasinoAudioMix {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_CASINO_AUDIO_MIX }
  }
  try {
    const stored = window.localStorage.getItem(AUDIO_MIX_KEY)
    return stored
      ? normalizeAudioMix(JSON.parse(stored) as unknown)
      : { ...DEFAULT_CASINO_AUDIO_MIX }
  } catch {
    return { ...DEFAULT_CASINO_AUDIO_MIX }
  }
}

function saveAudioMix(mix: CasinoAudioMix) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AUDIO_MIX_KEY, JSON.stringify(mix))
  } catch {
    // Mix changes still apply for this page when storage is unavailable.
  }
}

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
  voice: GainNode
  compressor: DynamicsCompressorNode
}

export class CasinoAudioDirector {
  private graph: AudioGraph | null = null
  private enabled = false
  private ambientSource: AudioBufferSourceNode | null = null
  private ambientLfo: OscillatorNode | null = null
  private ambientLfoGain: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private noiseBufferContext: AudioContext | null = null
  private sampleBufferContext: AudioContext | null = null
  private sampleBuffers = new Map<AudioSampleId, AudioBuffer>()
  private sampleLoads = new Map<AudioSampleId, Promise<AudioBuffer | null>>()
  private failedSamples = new Map<AudioSampleId, number>()
  private sampleRetryTimer: ReturnType<typeof globalThis.setTimeout> | null =
    null
  private recentEventIds: string[] = []
  private recentEventSet = new Set<string>()
  private pendingEventIds = new Set<string>()
  private lastSqueezeAt = 0
  private pageVisible = true
  private lifecycleEpoch = 0
  private suspendTimer: number | null = null
  private suspendPromise: Promise<void> | null = null
  private mix = loadAudioMix()

  setEnabled(enabled: boolean) {
    if (!enabled) {
      this.cancelDealerCall()
    }

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

  getMix(): CasinoAudioMix {
    return { ...this.mix }
  }

  setMix(update: Partial<CasinoAudioMix>): CasinoAudioMix {
    this.mix = normalizeAudioMix({ ...this.mix, ...update })
    saveAudioMix(this.mix)
    this.applyMix()
    return this.getMix()
  }

  setMixChannel(
    channel: CasinoAudioMixChannel,
    level: number,
  ): CasinoAudioMix {
    return this.setMix({ [channel]: level })
  }

  /** Retry recorded samples immediately after connectivity is confirmed. */
  retryFailedSamples() {
    if (this.failedSamples.size === 0) return

    const context = this.graph?.context
    const sampleIds = [...this.failedSamples.keys()]
    this.clearSampleRetryTimer()
    this.failedSamples.clear()
    if (
      !context ||
      context.state === 'closed' ||
      !this.enabled ||
      !this.pageVisible
    ) {
      return
    }

    void Promise.all(
      sampleIds.map((sampleId) => this.loadSample(context, sampleId)),
    )
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
      graph.master.gain.linearRampToValueAtTime(
        MASTER_LEVEL * this.mix.master,
        now + 0.035,
      )
      void this.preloadSamples(graph.context)
      this.startAmbient()
      return true
    } catch {
      return false
    }
  }

  async setPageVisible(visible: boolean) {
    if (!visible) {
      this.cancelDealerCall()
    }

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

  playChip(
    eventId: string,
    side: AudioSide = 'center',
    delayMs = 0,
  ) {
    this.schedule(eventId, (graph, requestedAt) => {
      const now =
        requestedAt + Math.max(0, delayMs) / 1_000
      const pan = panForSide(side)
      if (
        this.playSample(
          graph,
          eventId,
          CHIP_LAY_SAMPLES,
          now,
          pan,
          0.19,
        )
      ) {
        return
      }
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
      if (
        this.playSample(
          graph,
          eventId,
          CARD_SLIDE_SAMPLES,
          now,
          panForSide(side),
          0.2,
        )
      ) {
        return
      }
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

  playCardLand(
    eventId: string,
    side: Exclude<AudioSide, 'center'>,
    delayMs = 0,
  ) {
    this.schedule(eventId, (graph, requestedAt) => {
      const now =
        requestedAt + Math.max(0, delayMs) / 1_000
      const pan = panForSide(side)
      if (
        this.playSample(
          graph,
          eventId,
          CARD_PLACE_SAMPLES,
          now,
          pan,
          0.22,
        )
      ) {
        return
      }
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
      if (
        this.playSample(
          graph,
          eventId,
          CARD_FAN_SAMPLES,
          now,
          panForSide(side),
          automatic ? 0.15 : 0.2,
          automatic ? 1.08 : 0.94,
        )
      ) {
        return
      }
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
      if (
        this.playSample(
          graph,
          eventId,
          CARD_PLACE_SAMPLES,
          now,
          pan,
          0.18,
          1.08,
        )
      ) {
        return
      }
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
    })
  }

  playSettlementStep(
    eventId: string,
    kind: SettlementActionKind,
    side: AudioSide,
    delayMs = 0,
  ) {
    this.schedule(eventId, (graph, requestedAt) => {
      const start =
        requestedAt + Math.max(0, delayMs) / 1_000
      const targetPan = panForSide(side)
      const firstPan = kind === 'pay' ? 0 : targetPan
      const finalPan = kind === 'collect' ? 0 : targetPan
      const volume = kind === 'push' ? 0.034 : 0.05
      const samples =
        kind === 'pay'
          ? CHIP_HANDLE_SAMPLES
          : kind === 'collect'
            ? CHIP_COLLIDE_SAMPLES
            : CHIP_STACK_SAMPLES

      if (
        this.playSample(
          graph,
          eventId,
          samples,
          start,
          (firstPan + finalPan) / 2,
          kind === 'push' ? 0.15 : 0.2,
        )
      ) {
        return
      }

      this.noiseBurst(graph, start, 0.038, 2_650, firstPan, volume * 0.72)
      this.tone(
        graph,
        start + 0.008,
        kind === 'collect' ? 760 : kind === 'pay' ? 980 : 690,
        0.055,
        firstPan,
        volume,
      )
      this.tone(
        graph,
        start + 0.052,
        kind === 'collect' ? 610 : kind === 'pay' ? 840 : 650,
        0.06,
        finalPan,
        volume * 0.72,
      )
      if (kind !== 'push') {
        this.noiseBurst(
          graph,
          start + 0.046,
          0.034,
          3_100,
          finalPan,
          volume * 0.42,
        )
      }
    })
  }

  playNewShoe(eventId: string) {
    this.schedule(eventId, (graph) => {
      const now = graph.context.currentTime
      if (
        this.playSample(
          graph,
          eventId,
          ['card-shuffle'],
          now,
          0,
          0.18,
        )
      ) {
        return
      }
      this.noiseBurst(graph, now, 0.22, 1_300, 0.25, 0.06)
      this.noiseBurst(graph, now + 0.11, 0.18, 1_850, -0.2, 0.045)
    })
  }

  playDealerCall(eventId: string, text: string) {
    const message = text.trim()
    const dealerEventId = `dealer-call:${eventId}`
    if (
      !message ||
      !this.enabled ||
      !this.pageVisible ||
      typeof window === 'undefined' ||
      typeof SpeechSynthesisUtterance === 'undefined' ||
      this.recentEventSet.has(dealerEventId)
    ) {
      return
    }

    try {
      const synthesis = window.speechSynthesis
      if (
        !synthesis ||
        typeof synthesis.speak !== 'function' ||
        typeof synthesis.cancel !== 'function'
      ) {
        return
      }

      const utterance = new SpeechSynthesisUtterance(message)
      utterance.lang = 'zh-CN'
      utterance.rate = 0.86
      utterance.pitch = 0.72
      utterance.volume = 0.58 * this.mix.voice * this.mix.master
      const chineseVoice = synthesis
        .getVoices()
        .find((voice) => voice.lang.toLowerCase().startsWith('zh'))
      if (chineseVoice) utterance.voice = chineseVoice

      synthesis.cancel()
      synthesis.speak(utterance)
      this.rememberEvent(dealerEventId)
    } catch {
      // Speech synthesis is an optional enhancement; table audio stays usable.
    }
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
      if (
        this.playSample(
          graph,
          eventId,
          CARD_SHOVE_SAMPLES,
          now,
          pan,
          committed ? 0.2 : 0.12,
          committed ? 1 : 0.92,
        )
      ) {
        return
      }
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

  private schedule(
    eventId: string,
    render: (graph: AudioGraph, requestedAt: number) => void,
  ) {
    if (
      !this.enabled ||
      !this.pageVisible ||
      this.recentEventSet.has(eventId) ||
      this.pendingEventIds.has(eventId)
    ) {
      return
    }

    const requestedContext =
      this.graph?.context.state === 'closed' ? null : this.graph?.context
    const requestedAt = requestedContext?.currentTime ?? null
    const epoch = this.lifecycleEpoch
    this.pendingEventIds.add(eventId)
    void (async () => {
      try {
        const ready = await this.unlock()
        const graph = this.graph
        if (
          !ready ||
          !this.enabled ||
          !this.pageVisible ||
          epoch !== this.lifecycleEpoch ||
          this.recentEventSet.has(eventId) ||
          !graph
        ) {
          return
        }

        const renderAt =
          requestedAt !== null && requestedContext === graph.context
            ? requestedAt
            : graph.context.currentTime
        this.rememberEvent(eventId)
        render(graph, renderAt)
      } catch {
        // Web Audio is optional; a failed node must not reject into the UI.
      } finally {
        this.pendingEventIds.delete(eventId)
      }
    })()
  }

  private rememberEvent(eventId: string) {
    this.recentEventSet.add(eventId)
    this.recentEventIds.push(eventId)
    if (this.recentEventIds.length <= MAX_EVENT_IDS) return

    const oldest = this.recentEventIds.shift()
    if (oldest) this.recentEventSet.delete(oldest)
  }

  private cancelDealerCall() {
    if (typeof window === 'undefined') return
    try {
      window.speechSynthesis?.cancel()
    } catch {
      // Browsers may expose speechSynthesis before the implementation is ready.
    }
  }

  private ensureGraph(): AudioGraph {
    if (this.graph?.context.state === 'closed') {
      const closedGraph = this.graph
      this.stopAmbient()
      ;[
        closedGraph.effects,
        closedGraph.ambient,
        closedGraph.voice,
        closedGraph.compressor,
        closedGraph.master,
      ].forEach((node) => {
        try {
          node.disconnect()
        } catch {
          // A closed context may have already detached its graph.
        }
      })
      this.graph = null
      this.noiseBuffer = null
      this.noiseBufferContext = null
      this.sampleBufferContext = null
      this.sampleBuffers.clear()
      this.sampleLoads.clear()
      this.clearSampleRetryTimer()
      this.failedSamples.clear()
      this.suspendPromise = null
    }

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
    const voice = context.createGain()
    const compressor = context.createDynamicsCompressor()
    master.gain.value = 0
    effects.gain.value = MASTER_LEVEL * this.mix.effects
    ambient.gain.value = AMBIENT_LEVEL * this.mix.ambient
    voice.gain.value = MASTER_LEVEL * this.mix.voice
    compressor.threshold.value = -16
    compressor.knee.value = 14
    compressor.ratio.value = 5
    compressor.attack.value = 0.006
    compressor.release.value = 0.18
    effects.connect(compressor)
    ambient.connect(compressor)
    voice.connect(compressor)
    compressor.connect(master)
    master.connect(context.destination)
    this.graph = { context, master, effects, ambient, voice, compressor }
    return this.graph
  }

  private ensureNoiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBufferContext === context) {
      return this.noiseBuffer
    }

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
    this.noiseBufferContext = context
    return buffer
  }

  private prepareSampleContext(context: AudioContext) {
    if (this.sampleBufferContext === context) return
    this.sampleBufferContext = context
    this.sampleBuffers.clear()
    this.sampleLoads.clear()
    this.clearSampleRetryTimer()
    this.failedSamples.clear()
  }

  private clearSampleRetryTimer() {
    if (this.sampleRetryTimer === null) return
    globalThis.clearTimeout(this.sampleRetryTimer)
    this.sampleRetryTimer = null
  }

  private scheduleSampleRetry(context: AudioContext, delayMs: number) {
    if (this.sampleRetryTimer !== null || context.state === 'closed') return

    const timer = globalThis.setTimeout(() => {
      this.sampleRetryTimer = null
      void this.retryExpiredSamples(context)
    }, Math.max(0, delayMs))
    ;(timer as unknown as { unref?: () => void }).unref?.()
    this.sampleRetryTimer = timer
  }

  private async retryExpiredSamples(context: AudioContext) {
    if (
      this.sampleBufferContext !== context ||
      context.state === 'closed' ||
      !this.enabled ||
      !this.pageVisible
    ) {
      return
    }

    const now = Date.now()
    const expiredSampleIds = [...this.failedSamples.entries()]
      .filter(([, failedAt]) => now - failedAt >= AUDIO_SAMPLE_RETRY_MS)
      .map(([sampleId]) => sampleId)

    expiredSampleIds.forEach((sampleId) => this.failedSamples.delete(sampleId))
    await Promise.all(
      expiredSampleIds.map((sampleId) => this.loadSample(context, sampleId)),
    )

    if (this.sampleRetryTimer !== null || this.failedSamples.size === 0) return
    const nextDelay = Math.min(
      ...[...this.failedSamples.values()].map((failedAt) =>
        Math.max(0, failedAt + AUDIO_SAMPLE_RETRY_MS - Date.now()),
      ),
    )
    this.scheduleSampleRetry(context, nextDelay)
  }

  private loadSample(
    context: AudioContext,
    sampleId: AudioSampleId,
  ): Promise<AudioBuffer | null> {
    this.prepareSampleContext(context)
    const ready = this.sampleBuffers.get(sampleId)
    if (ready) return Promise.resolve(ready)
    if (context.state === 'closed') {
      return Promise.resolve(null)
    }
    const failedAt = this.failedSamples.get(sampleId)
    if (failedAt !== undefined) {
      const retryDelay = failedAt + AUDIO_SAMPLE_RETRY_MS - Date.now()
      if (retryDelay > 0) {
        this.scheduleSampleRetry(context, retryDelay)
        return Promise.resolve(null)
      }
      this.failedSamples.delete(sampleId)
    }
    const pending = this.sampleLoads.get(sampleId)
    if (pending) return pending

    const load = (async () => {
      try {
        for (const url of AUDIO_SAMPLE_MANIFEST[sampleId].urls) {
          try {
            const response = await fetch(url)
            if (!response.ok) {
              throw new Error(`Audio sample HTTP ${response.status}`)
            }
            const encoded = await response.arrayBuffer()
            const buffer = await context.decodeAudioData(encoded)
            if (
              this.sampleBufferContext !== context ||
              context.state === 'closed'
            ) {
              return null
            }
            this.sampleBuffers.set(sampleId, buffer)
            this.failedSamples.delete(sampleId)
            return buffer
          } catch {
            // Try the next declared encoding before using synthesized audio.
          }
        }
        throw new Error('No compatible audio sample encoding')
      } catch {
        if (this.sampleBufferContext === context) {
          this.failedSamples.set(sampleId, Date.now())
          this.scheduleSampleRetry(context, AUDIO_SAMPLE_RETRY_MS)
        }
        return null
      } finally {
        if (this.sampleBufferContext === context) {
          this.sampleLoads.delete(sampleId)
        }
      }
    })()
    this.sampleLoads.set(sampleId, load)
    return load
  }

  private async preloadSamples(context: AudioContext) {
    await Promise.all(
      AUDIO_PRELOAD_SAMPLE_IDS.map((sampleId) =>
        this.loadSample(context, sampleId),
      ),
    )
  }

  private playSample(
    graph: AudioGraph,
    eventId: string,
    candidates: readonly AudioSampleId[],
    start: number,
    pan: number,
    volume: number,
    playbackRate = 1,
  ): boolean {
    const context = graph.context
    this.prepareSampleContext(context)
    const sampleId = sampleForEvent(eventId, candidates)
    const buffer = this.sampleBuffers.get(sampleId)
    if (!buffer) {
      void this.loadSample(context, sampleId)
      return false
    }

    try {
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = buffer
      source.playbackRate.setValueAtTime(playbackRate, start)
      gain.gain.setValueAtTime(volume, start)
      source.connect(gain)
      this.connectWithPan(graph, gain, pan)
      source.start(start)
      return true
    } catch {
      return false
    }
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
    this.prepareSampleContext(context)
    const recordedRoom = this.sampleBuffers.get('room-crowd-loop')
    source.buffer = recordedRoom ?? this.ensureNoiseBuffer(context)
    source.loop = true
    filter.type = 'lowpass'
    filter.frequency.value = recordedRoom ? 3_400 : 520
    filter.Q.value = recordedRoom ? 0.3 : 0.45
    if (panner) {
      source.connect(filter).connect(panner).connect(graph.ambient)
    } else {
      source.connect(filter).connect(graph.ambient)
    }
    lfo.type = 'sine'
    lfo.frequency.value = 0.085
    lfoGain.gain.value = 0.004 * this.mix.ambient
    lfo.connect(lfoGain).connect(graph.ambient.gain)
    source.start()
    lfo.start()
    this.ambientSource = source
    this.ambientLfo = lfo
    this.ambientLfoGain = lfoGain

    if (!recordedRoom) {
      void this.loadSample(context, 'room-crowd-loop').then((buffer) => {
        if (
          !buffer ||
          this.graph !== graph ||
          this.ambientSource !== source ||
          !this.enabled ||
          !this.pageVisible ||
          context.state !== 'running'
        ) {
          return
        }
        this.stopAmbient()
        this.startAmbient()
      })
    }
  }

  private stopAmbient() {
    try {
      this.ambientSource?.stop()
      this.ambientLfo?.stop()
    } catch {
      // Nodes may already be stopped after a visibility transition.
    }
    ;[
      this.ambientSource,
      this.ambientLfo,
      this.ambientLfoGain,
    ].forEach((node) => {
      try {
        node?.disconnect()
      } catch {
        // Closed contexts can reject redundant disconnect operations.
      }
    })
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
    if (!graph || graph.context.state === 'closed') return
    const now = graph.context.currentTime
    graph.master.gain.cancelScheduledValues(now)
    graph.master.gain.setValueAtTime(graph.master.gain.value, now)
    graph.master.gain.linearRampToValueAtTime(target, now + 0.035)
  }

  private applyMix() {
    const graph = this.graph
    if (!graph || graph.context.state === 'closed') return

    const now = graph.context.currentTime
    graph.effects.gain.cancelScheduledValues(now)
    graph.effects.gain.setValueAtTime(
      MASTER_LEVEL * this.mix.effects,
      now,
    )
    graph.ambient.gain.cancelScheduledValues(now)
    graph.ambient.gain.setValueAtTime(
      AMBIENT_LEVEL * this.mix.ambient,
      now,
    )
    graph.voice.gain.cancelScheduledValues(now)
    graph.voice.gain.setValueAtTime(MASTER_LEVEL * this.mix.voice, now)
    if (this.ambientLfoGain) {
      this.ambientLfoGain.gain.setValueAtTime(
        0.004 * this.mix.ambient,
        now,
      )
    }

    this.fadeMaster(
      this.enabled && this.pageVisible
        ? MASTER_LEVEL * this.mix.master
        : 0,
    )
  }

  private duckAmbient(graph: AudioGraph, duration: number) {
    const now = graph.context.currentTime
    const ambientLevel = AMBIENT_LEVEL * this.mix.ambient
    graph.ambient.gain.cancelScheduledValues(now)
    graph.ambient.gain.setValueAtTime(graph.ambient.gain.value, now)
    graph.ambient.gain.linearRampToValueAtTime(
      Math.min(0.007, ambientLevel * 0.4),
      now + 0.025,
    )
    graph.ambient.gain.linearRampToValueAtTime(
      ambientLevel,
      now + duration,
    )
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
