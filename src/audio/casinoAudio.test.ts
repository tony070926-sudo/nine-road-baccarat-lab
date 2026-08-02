import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUDIO_SAMPLE_RETRY_MS,
  CasinoAudioDirector,
  DEALER_CALL_FALLBACK_MS,
  DEALER_VOICE_DUCK_ATTACK_S,
  DEALER_VOICE_DUCK_RATIO,
  DEALER_VOICE_DUCK_RELEASE_S,
  DEFAULT_CASINO_AUDIO_MIX,
  dealerCallFallbackMs,
  loadAudioMix,
} from './casinoAudio'
import { crowdIntensity, panForSide } from './spatialAudio'

class MockSpeechSynthesisUtterance {
  text: string
  lang = ''
  rate = 1
  pitch = 1
  volume = 1
  voice: SpeechSynthesisVoice | null = null
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

function createSpeechHarness() {
  const speak = vi.fn()
  const cancel = vi.fn()
  const chineseVoice = {
    lang: 'zh-CN',
    name: 'Mandarin',
  } as SpeechSynthesisVoice
  const englishVoice = {
    lang: 'en-US',
    name: 'English',
  } as SpeechSynthesisVoice
  const localStorage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  }

  vi.stubGlobal('SpeechSynthesisUtterance', MockSpeechSynthesisUtterance)
  vi.stubGlobal('window', {
    localStorage,
    clearTimeout: globalThis.clearTimeout,
    setTimeout: globalThis.setTimeout,
    speechSynthesis: {
      speak,
      cancel,
      getVoices: vi.fn(() => [englishVoice, chineseVoice]),
    },
  })

  return { cancel, chineseVoice, speak }
}

function createAudioParam(value = 0) {
  return {
    value,
    cancelAndHoldAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
  }
}

function createAudioNode<T extends object>(extra: T) {
  return {
    connect: vi.fn((destination: unknown) => destination),
    disconnect: vi.fn(),
    ...extra,
  }
}

function createWebAudioHarness(currentTime = 10) {
  const bufferStarts: number[] = []
  const bufferSources: Array<
    ReturnType<
      typeof createAudioNode<{
        buffer: AudioBuffer | null
        loop: boolean
        onended: (() => void) | null
        playbackRate: ReturnType<typeof createAudioParam>
        start: ReturnType<typeof vi.fn>
        stop: ReturnType<typeof vi.fn>
      }>
    >
  > = []
  const filters: Array<
    ReturnType<
      typeof createAudioNode<{
        frequency: ReturnType<typeof createAudioParam>
        Q: ReturnType<typeof createAudioParam>
        type: BiquadFilterType
      }>
    >
  > = []
  const gains: Array<
    ReturnType<
      typeof createAudioNode<{ gain: ReturnType<typeof createAudioParam> }>
    >
  > = []
  const oscillatorStarts: number[] = []
  const panners: Array<
    ReturnType<
      typeof createAudioNode<{ pan: ReturnType<typeof createAudioParam> }>
    >
  > = []

  const context = {
    currentTime,
    state: 'running',
    sampleRate: 48_000,
    destination: createAudioNode({}),
    createBuffer: vi.fn((_channels: number, length: number) => ({
      getChannelData: vi.fn(() => new Float32Array(length)),
    })),
    createBiquadFilter: vi.fn(() => {
      const filter = createAudioNode({
        frequency: createAudioParam(),
        Q: createAudioParam(),
        type: 'bandpass' as BiquadFilterType,
      })
      filters.push(filter)
      return filter
    }),
    createBufferSource: vi.fn(() => {
      const source = createAudioNode({
        buffer: null,
        loop: false,
        onended: null as (() => void) | null,
        playbackRate: createAudioParam(1),
        start: vi.fn((when = 0) => bufferStarts.push(when)),
        stop: vi.fn(),
      })
      bufferSources.push(source)
      return source
    }),
    createGain: vi.fn(() => {
      const gain = createAudioNode({ gain: createAudioParam() })
      gains.push(gain)
      return gain
    }),
    createDynamicsCompressor: vi.fn(() =>
      createAudioNode({
        attack: createAudioParam(),
        knee: createAudioParam(),
        ratio: createAudioParam(),
        release: createAudioParam(),
        threshold: createAudioParam(),
      }),
    ),
    createOscillator: vi.fn(() =>
      createAudioNode({
        frequency: createAudioParam(),
        start: vi.fn((when = 0) => oscillatorStarts.push(when)),
        stop: vi.fn(),
        type: 'sine',
      }),
    ),
    createStereoPanner: vi.fn(() => {
      const panner = createAudioNode({ pan: createAudioParam() })
      panners.push(panner)
      return panner
    }),
    decodeAudioData: vi.fn(async () => ({}) as AudioBuffer),
    resume: vi.fn(async () => undefined),
    suspend: vi.fn(async () => undefined),
  } as unknown as AudioContext
  const master = createAudioNode({ gain: createAudioParam() })
  const effects = createAudioNode({ gain: createAudioParam() })
  const ambient = createAudioNode({ gain: createAudioParam() })
  const crowd = createAudioNode({ gain: createAudioParam(0.54) })
  const voice = createAudioNode({ gain: createAudioParam() })
  const compressor = createAudioNode({})
  const graph = {
    context,
    master,
    effects,
    ambient,
    crowd,
    voice,
    compressor,
  }

  return {
    bufferSources,
    bufferStarts,
    filters,
    gains,
    graph,
    oscillatorStarts,
    panners,
  }
}

function installWebAudioHarness(
  director: CasinoAudioDirector,
  graph: ReturnType<typeof createWebAudioHarness>['graph'],
) {
  director.setEnabled(true)
  const internals = director as unknown as {
    graph: typeof graph
    noiseBuffer: AudioBuffer
  }
  internals.graph = graph
  internals.noiseBuffer = {} as AudioBuffer
  vi.spyOn(director, 'unlock').mockResolvedValue(true)
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('casino spatial audio mapping', () => {
  it('keeps player left, banker right, and dealer cues centered', () => {
    expect(panForSide('player')).toBeLessThan(0)
    expect(panForSide('banker')).toBeGreaterThan(0)
    expect(panForSide('player')).toBe(-panForSide('banker'))
    expect(panForSide('center')).toBe(0)
  })

  it('keeps celebration stronger than anticipation, reaction, and hush', () => {
    expect(crowdIntensity('celebration')).toBeGreaterThan(
      crowdIntensity('anticipation'),
    )
    expect(crowdIntensity('anticipation')).toBeGreaterThan(
      crowdIntensity('reaction'),
    )
    expect(crowdIntensity('reaction')).toBeGreaterThan(
      crowdIntensity('hush'),
    )
  })
})

describe('CasinoAudioDirector dealer calls', () => {
  it('speaks a restrained Mandarin call once per event', async () => {
    const { cancel, chineseVoice, speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    director.setEnabled(true)

    const call = director.playDealerCall('round-8:close', '  停止下注  ')
    const duplicate = director.playDealerCall('round-8:close', '停止下注')

    expect(duplicate).toBe(call)
    expect(speak).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()
    const utterance = speak.mock.calls[0][0] as MockSpeechSynthesisUtterance
    expect(utterance.text).toBe('停止下注')
    expect(utterance.lang).toBe('zh-CN')
    expect(utterance.rate).toBeLessThan(1)
    expect(utterance.pitch).toBeLessThan(1)
    expect(utterance.volume).toBeLessThan(0.7)
    expect(utterance.voice).toBe(chineseVoice)
    utterance.onend?.()
    await expect(call).resolves.toBe('ended')
    await expect(duplicate).resolves.toBe('ended')
  })

  it('does not speak while disabled and cancels speech when disabled', async () => {
    const { cancel, speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()

    await director.playDealerCall('round-9:disabled', '停止下注')
    expect(speak).not.toHaveBeenCalled()

    director.setEnabled(true)
    const call = director.playDealerCall('round-9:close', '停止下注')
    expect(speak).toHaveBeenCalledTimes(1)

    director.setEnabled(false)
    expect(cancel).toHaveBeenCalledTimes(1)
    await expect(call).resolves.toBe('cancelled')

    director.setEnabled(false)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('releases both active and queued calls when audio is disabled', async () => {
    const { cancel, speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    director.setEnabled(true)

    const active = director.playDealerCall('round-9:points', '闲家三点')
    const queued = director.playDealerCall('round-9:draw', '庄家补牌')
    expect(speak).toHaveBeenCalledTimes(1)

    director.setEnabled(false)
    expect(cancel).toHaveBeenCalledTimes(1)
    await expect(active).resolves.toBe('cancelled')
    await expect(queued).resolves.toBe('cancelled')
  })

  it('cancels and blocks speech while the page is hidden', async () => {
    const { cancel, speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    director.setEnabled(true)

    const active = director.playDealerCall('round-10:active', '闲家赢')
    await director.setPageVisible(false)
    await expect(active).resolves.toBe('cancelled')
    director.playDealerCall('round-10:hidden', '庄家赢')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(speak).toHaveBeenCalledTimes(1)

    await director.setPageVisible(true)
    const call = director.playDealerCall('round-10:visible', '庄家赢')
    expect(speak).toHaveBeenCalledTimes(2)
    const utterance = speak.mock.calls[1][0] as MockSpeechSynthesisUtterance
    utterance.onend?.()
    await expect(call).resolves.toBe('ended')
  })

  it('serializes calls without interrupting the active utterance', async () => {
    const { cancel, speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    director.setEnabled(true)

    const first = director.playDealerCall('round-11:points', '闲家五点')
    const second = director.playDealerCall('round-11:draw', '补牌')
    const firstUtterance = speak.mock.calls[0][0] as MockSpeechSynthesisUtterance
    let secondFinished = false
    void second.then(() => {
      secondFinished = true
    })

    expect(speak).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()
    firstUtterance.onend?.()
    await expect(first).resolves.toBe('ended')
    expect(speak).toHaveBeenCalledTimes(2)
    expect(secondFinished).toBe(false)
    const secondUtterance = speak.mock.calls[1][0] as MockSpeechSynthesisUtterance
    expect(secondUtterance.text).toBe('补牌')
    secondUtterance.onerror?.()
    await expect(second).resolves.toBe('error')
  })

  it('holds ambient ducking across queued calls and releases after the queue', async () => {
    vi.useFakeTimers()
    const { speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(18)
    harness.graph.ambient.gain.value = 0.018
    const ambientLfoGain = createAudioNode({ gain: createAudioParam(0.004) })
    installWebAudioHarness(director, harness.graph)
    ;(
      director as unknown as { ambientLfoGain: typeof ambientLfoGain }
    ).ambientLfoGain = ambientLfoGain

    const first = director.playDealerCall('round-11:queue-points', '闲家五点')
    const second = director.playDealerCall('round-11:queue-draw', '庄家补牌')
    const firstUtterance = speak.mock.calls[0][0] as MockSpeechSynthesisUtterance
    await vi.advanceTimersByTimeAsync(400)
    expect(
      harness.graph.ambient.gain.linearRampToValueAtTime,
    ).not.toHaveBeenCalled()
    expect(ambientLfoGain.gain.linearRampToValueAtTime).not.toHaveBeenCalled()

    firstUtterance.onstart?.()
    expect(harness.graph.ambient.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.018 * DEALER_VOICE_DUCK_RATIO,
      18 + DEALER_VOICE_DUCK_ATTACK_S,
    )
    expect(ambientLfoGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.004 * DEALER_VOICE_DUCK_RATIO,
      18 + DEALER_VOICE_DUCK_ATTACK_S,
    )
    expect(harness.graph.effects.gain.cancelScheduledValues).not.toHaveBeenCalled()

    firstUtterance.onend?.()
    await expect(first).resolves.toBe('ended')
    expect(speak).toHaveBeenCalledTimes(2)
    expect(
      harness.graph.ambient.gain.linearRampToValueAtTime,
    ).not.toHaveBeenCalledWith(0.018, 18 + DEALER_VOICE_DUCK_RELEASE_S)

    const secondUtterance = speak.mock.calls[1][0] as MockSpeechSynthesisUtterance
    secondUtterance.onstart?.()
    secondUtterance.onend?.()
    await expect(second).resolves.toBe('ended')
    expect(harness.graph.ambient.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.018,
      18 + DEALER_VOICE_DUCK_RELEASE_S,
    )
    expect(ambientLfoGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.004,
      18 + DEALER_VOICE_DUCK_RELEASE_S,
    )
  })

  it('holds the current level before cancelling automation on older browsers', async () => {
    const { speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(19)
    harness.graph.ambient.gain.value = 0.012
    const ambientGain = harness.graph.ambient.gain as unknown as {
      cancelAndHoldAtTime?: ReturnType<typeof vi.fn>
      cancelScheduledValues: ReturnType<typeof vi.fn>
      setValueAtTime: ReturnType<typeof vi.fn>
    }
    delete ambientGain.cancelAndHoldAtTime
    installWebAudioHarness(director, harness.graph)

    const call = director.playDealerCall(
      'round-11:legacy-envelope',
      '闲家五点',
    )
    const utterance = speak.mock.calls[0][0] as MockSpeechSynthesisUtterance
    utterance.onstart?.()

    expect(ambientGain.cancelScheduledValues).toHaveBeenCalledWith(19)
    expect(ambientGain.setValueAtTime).toHaveBeenCalledWith(0.012, 19)
    expect(harness.graph.effects.gain.cancelScheduledValues).not.toHaveBeenCalled()
    utterance.onend?.()
    await expect(call).resolves.toBe('ended')
  })

  it('keeps a changed ambient mix ducked until speech is cancelled', async () => {
    const { speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(20)
    harness.graph.ambient.gain.value = 0.018
    const ambientLfoGain = createAudioNode({ gain: createAudioParam(0.004) })
    installWebAudioHarness(director, harness.graph)
    ;(
      director as unknown as { ambientLfoGain: typeof ambientLfoGain }
    ).ambientLfoGain = ambientLfoGain

    const call = director.playDealerCall('round-11:mix-points', '闲家六点')
    const utterance = speak.mock.calls[0][0] as MockSpeechSynthesisUtterance
    utterance.onstart?.()
    harness.graph.ambient.gain.cancelScheduledValues.mockClear()
    ambientLfoGain.gain.cancelScheduledValues.mockClear()
    director.setMixChannel('ambient', 0.5)
    expect(harness.graph.ambient.gain.cancelScheduledValues).toHaveBeenCalledWith(
      20,
    )
    expect(ambientLfoGain.gain.cancelScheduledValues).toHaveBeenCalledWith(20)
    expect(harness.graph.ambient.gain.setValueAtTime).toHaveBeenCalledWith(
      0.018 * 0.5 * DEALER_VOICE_DUCK_RATIO,
      20,
    )
    expect(ambientLfoGain.gain.setValueAtTime).toHaveBeenCalledWith(
      0.004 * 0.5 * DEALER_VOICE_DUCK_RATIO,
      20,
    )
    expect(harness.graph.effects.gain.setValueAtTime).not.toHaveBeenCalled()

    director.cancelDealerCalls()
    await expect(call).resolves.toBe('cancelled')
    expect(harness.graph.ambient.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.018 * 0.5,
      20 + DEALER_VOICE_DUCK_RELEASE_S,
    )
    expect(ambientLfoGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.004 * 0.5,
      20 + DEALER_VOICE_DUCK_RELEASE_S,
    )
    expect(speak).toHaveBeenCalledTimes(1)
  })

  it('keeps a transient cue duck active when dealer speech ends first', async () => {
    const { speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(24)
    harness.graph.ambient.gain.value = 0.018
    const ambientLfoGain = createAudioNode({ gain: createAudioParam(0.004) })
    installWebAudioHarness(director, harness.graph)
    const internals = director as unknown as {
      ambientLfoGain: typeof ambientLfoGain
      duckAmbient(graph: typeof harness.graph, duration: number): void
    }
    internals.ambientLfoGain = ambientLfoGain

    internals.duckAmbient(harness.graph, 0.7)
    const call = director.playDealerCall(
      'round-11:overlap-result',
      '庄家胜',
    )
    const utterance = speak.mock.calls[0][0] as MockSpeechSynthesisUtterance
    utterance.onstart?.()
    ;(harness.graph.context as unknown as { currentTime: number }).currentTime =
      24.2
    harness.graph.ambient.gain.cancelAndHoldAtTime.mockClear()
    harness.graph.ambient.gain.linearRampToValueAtTime.mockClear()
    ambientLfoGain.gain.cancelAndHoldAtTime.mockClear()
    ambientLfoGain.gain.linearRampToValueAtTime.mockClear()

    utterance.onend?.()
    await expect(call).resolves.toBe('ended')

    expect(harness.graph.ambient.gain.cancelAndHoldAtTime).toHaveBeenCalledWith(
      24.2,
    )
    expect(ambientLfoGain.gain.cancelAndHoldAtTime).toHaveBeenCalledWith(24.2)
    expect(harness.graph.ambient.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(0.007, 10),
      24.2 + DEALER_VOICE_DUCK_RELEASE_S,
    )
    expect(harness.graph.ambient.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.018,
      24.7,
    )
    expect(ambientLfoGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(0.004 * (0.007 / 0.018), 10),
      24.2 + DEALER_VOICE_DUCK_RELEASE_S,
    )
    expect(ambientLfoGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.004,
      24.7,
    )
    expect(harness.graph.effects.gain.cancelScheduledValues).not.toHaveBeenCalled()
  })

  it('preserves voice and transient duck reasons across an ambient mix change', async () => {
    const { speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(30)
    harness.graph.ambient.gain.value = 0.018
    const ambientLfoGain = createAudioNode({ gain: createAudioParam(0.004) })
    installWebAudioHarness(director, harness.graph)
    const internals = director as unknown as {
      ambientLfoGain: typeof ambientLfoGain
      duckAmbient(graph: typeof harness.graph, duration: number): void
    }
    internals.ambientLfoGain = ambientLfoGain

    internals.duckAmbient(harness.graph, 0.7)
    const call = director.playDealerCall(
      'round-11:overlap-mix',
      '闲家六点',
    )
    const utterance = speak.mock.calls[0][0] as MockSpeechSynthesisUtterance
    utterance.onstart?.()
    harness.graph.ambient.gain.cancelScheduledValues.mockClear()
    ambientLfoGain.gain.cancelScheduledValues.mockClear()

    director.setMixChannel('ambient', 0.5)

    expect(harness.graph.ambient.gain.cancelScheduledValues).toHaveBeenCalledWith(
      30,
    )
    expect(ambientLfoGain.gain.cancelScheduledValues).toHaveBeenCalledWith(30)
    expect(harness.graph.ambient.gain.setValueAtTime).toHaveBeenCalledWith(
      0.018 * 0.5 * DEALER_VOICE_DUCK_RATIO,
      30,
    )
    expect(ambientLfoGain.gain.setValueAtTime).toHaveBeenCalledWith(
      0.004 * 0.5 * DEALER_VOICE_DUCK_RATIO,
      30,
    )

    ;(harness.graph.context as unknown as { currentTime: number }).currentTime =
      30.1
    harness.graph.ambient.gain.linearRampToValueAtTime.mockClear()
    utterance.onend?.()
    await expect(call).resolves.toBe('ended')

    expect(harness.graph.ambient.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.018 * 0.5 * 0.4,
      30.1 + DEALER_VOICE_DUCK_RELEASE_S,
    )
    expect(harness.graph.ambient.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.018 * 0.5,
      30.7,
    )
  })

  it('ignores a cancelled utterance finishing after the next call starts', async () => {
    const { cancel, speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(34)
    harness.graph.ambient.gain.value = 0.018
    installWebAudioHarness(director, harness.graph)

    const stale = director.playDealerCall('round-11:stale', '闲家五点')
    const staleUtterance = speak.mock.calls[0][0] as MockSpeechSynthesisUtterance
    director.cancelDealerCalls()
    await expect(stale).resolves.toBe('cancelled')
    harness.graph.ambient.gain.linearRampToValueAtTime.mockClear()

    const current = director.playDealerCall('round-12:current', '庄家六点')
    const currentUtterance = speak.mock.calls[1][0] as MockSpeechSynthesisUtterance
    let currentFinished = false
    void current.then(() => {
      currentFinished = true
    })
    staleUtterance.onstart?.()
    expect(
      harness.graph.ambient.gain.linearRampToValueAtTime,
    ).not.toHaveBeenCalled()
    currentUtterance.onstart?.()
    expect(harness.graph.ambient.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.018 * DEALER_VOICE_DUCK_RATIO,
      34 + DEALER_VOICE_DUCK_ATTACK_S,
    )
    staleUtterance.onend?.()
    await Promise.resolve()

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(speak).toHaveBeenCalledTimes(2)
    expect(currentFinished).toBe(false)
    currentUtterance.onend?.()
    await expect(current).resolves.toBe('ended')
  })

  it('fails open after the bounded completion fallback', async () => {
    vi.useFakeTimers()
    const { cancel, speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(36)
    harness.graph.ambient.gain.value = 0.018
    installWebAudioHarness(director, harness.graph)

    const call = director.playDealerCall('round-12:points', '闲家四点，庄家六点')
    const queued = director.playDealerCall('round-12:result', '庄家胜')
    const timedOutUtterance = speak.mock.calls[0][0] as MockSpeechSynthesisUtterance
    let finished = false
    void call.then(() => {
      finished = true
    })
    const fallbackMs = dealerCallFallbackMs('闲家四点，庄家六点')
    expect(fallbackMs).toBeGreaterThanOrEqual(DEALER_CALL_FALLBACK_MS)
    await vi.advanceTimersByTimeAsync(fallbackMs - 1)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(call).resolves.toBe('timeout')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(
      harness.graph.ambient.gain.linearRampToValueAtTime,
    ).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(speak).toHaveBeenCalledTimes(2)

    timedOutUtterance.onend?.()
    const queuedUtterance = speak.mock.calls[1][0] as MockSpeechSynthesisUtterance
    queuedUtterance.onend?.()
    await expect(queued).resolves.toBe('ended')
  })

  it('skips muted calls and fails open when synthesis throws', async () => {
    const { speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(38)
    harness.graph.ambient.gain.value = 0.018
    installWebAudioHarness(director, harness.graph)
    director.setMixChannel('voice', 0)

    await expect(
      director.playDealerCall('round-13:muted', '停止下注'),
    ).resolves.toBe('skipped')
    expect(speak).not.toHaveBeenCalled()

    director.setMixChannel('voice', 1)
    speak.mockImplementationOnce(() => {
      throw new Error('synthesis unavailable')
    })
    await expect(
      director.playDealerCall('round-13:error', '停止下注'),
    ).resolves.toBe('error')
    expect(
      harness.graph.ambient.gain.linearRampToValueAtTime,
    ).not.toHaveBeenCalled()

    const beforeStart = director.playDealerCall(
      'round-13:error-before-start',
      '庄家补牌',
    )
    const utterance = speak.mock.calls[1][0] as MockSpeechSynthesisUtterance
    utterance.onerror?.()
    await expect(beforeStart).resolves.toBe('error')
    expect(
      harness.graph.ambient.gain.linearRampToValueAtTime,
    ).not.toHaveBeenCalled()
  })
})

describe('CasinoAudioDirector far-field crowd', () => {
  it('connects the constructed crowd bus to the shared compressor', async () => {
    const harness = createWebAudioHarness(10)
    const AudioContextMock = vi.fn(function AudioContextMock() {
      return harness.graph.context
    })
    vi.stubGlobal('window', {
      AudioContext: AudioContextMock,
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
      },
    })
    const director = new CasinoAudioDirector()
    const internals = director as unknown as {
      graph: typeof harness.graph
      preloadSamples(context: AudioContext): Promise<void>
    }
    internals.preloadSamples = vi.fn(async () => undefined)
    director.setEnabled(true)

    await expect(director.unlock()).resolves.toBe(true)

    expect(AudioContextMock).toHaveBeenCalledTimes(1)
    expect(internals.graph.crowd.connect).toHaveBeenCalledWith(
      internals.graph.compressor,
    )
    expect(internals.graph.crowd.connect).not.toHaveBeenCalledWith(
      internals.graph.effects,
    )
  })

  it.each([
    ['reaction', 2],
    ['anticipation', 2],
    ['celebration', 3],
  ] as const)(
    'routes %s voices through the crowd bus instead of effects',
    async (tone, expectedVoices) => {
      const director = new CasinoAudioDirector()
      const harness = createWebAudioHarness(12)
      installWebAudioHarness(director, harness.graph)

      director.playCrowd(`round-20:${tone}`, tone, 'player')
      await vi.waitFor(() =>
        expect(harness.bufferSources).toHaveLength(expectedVoices),
      )

      expect(harness.filters).toHaveLength(expectedVoices)
      expect(harness.filters.every((filter) => filter.type === 'lowpass')).toBe(
        true,
      )
      expect(
        harness.filters.every(
          (filter) =>
            filter.frequency.value >= 720 &&
            filter.frequency.value <= 1_650,
        ),
      ).toBe(true)
      expect(harness.panners).toHaveLength(expectedVoices)
      harness.panners.forEach((panner) => {
        expect(panner.connect).toHaveBeenCalledWith(harness.graph.crowd)
        expect(panner.connect).not.toHaveBeenCalledWith(harness.graph.effects)
      })
    },
  )

  it('uses a capped soft envelope and deterministic wide image once per event', async () => {
    const firstDirector = new CasinoAudioDirector()
    const first = createWebAudioHarness(14)
    installWebAudioHarness(firstDirector, first.graph)

    firstDirector.playCrowd('round-21:celebration', 'celebration', 'banker')
    firstDirector.playCrowd('round-21:celebration', 'celebration', 'banker')
    await vi.waitFor(() => expect(first.bufferSources).toHaveLength(3))

    const pans = first.panners.map((panner) => panner.pan.value)
    expect(Math.min(...pans)).toBeLessThan(-0.5)
    expect(Math.max(...pans)).toBeGreaterThan(0.5)
    first.gains.forEach((gain) => {
      const [attack, release] = gain.gain.exponentialRampToValueAtTime.mock.calls
      expect(attack?.[0]).toBeGreaterThan(0.0001)
      expect(attack?.[0]).toBeLessThanOrEqual(0.034)
      expect(attack?.[1]).toBeGreaterThanOrEqual(14.08)
      expect(release?.[0]).toBe(0.0001)
      expect(release?.[1] - (attack?.[1] ?? 0)).toBeGreaterThan(0.45)
    })
    first.bufferSources.forEach((source) => {
      const offset = source.start.mock.calls[0]?.[1] as number
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThanOrEqual(0.18)
    })

    const secondDirector = new CasinoAudioDirector()
    const second = createWebAudioHarness(14)
    installWebAudioHarness(secondDirector, second.graph)
    secondDirector.playCrowd(
      'round-21:celebration',
      'celebration',
      'banker',
    )
    await vi.waitFor(() => expect(second.bufferSources).toHaveLength(3))

    expect(second.panners.map((panner) => panner.pan.value)).toEqual(pans)
  })

  it('uses ambient mix independently from the effects mix', async () => {
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(16)
    installWebAudioHarness(director, harness.graph)
    harness.graph.crowd.gain.setValueAtTime.mockClear()

    director.setMixChannel('effects', 0)
    expect(harness.graph.effects.gain.setValueAtTime).toHaveBeenCalledWith(0, 16)
    expect(harness.graph.crowd.gain.setValueAtTime).not.toHaveBeenCalled()

    director.playCrowd('round-22:reaction', 'reaction', 'player')
    await vi.waitFor(() => expect(harness.bufferSources).toHaveLength(2))
    expect(
      harness.panners.every((panner) =>
        panner.connect.mock.calls.some(([destination]) =>
          Object.is(destination, harness.graph.crowd),
        ),
      ),
    ).toBe(true)

    harness.graph.effects.gain.setValueAtTime.mockClear()
    director.setMixChannel('ambient', 0)
    expect(harness.graph.ambient.gain.setValueAtTime).toHaveBeenCalledWith(0, 16)
    expect(harness.graph.crowd.gain.setValueAtTime).toHaveBeenCalledWith(0, 16)
    expect(harness.graph.effects.gain.setValueAtTime).not.toHaveBeenCalled()
  })

  it('turns hush into a bounded ambient dip without creating a noise source', async () => {
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(24)
    installWebAudioHarness(director, harness.graph)

    director.playCrowd('round-23:hush', 'hush', 'banker')
    await vi.waitFor(() =>
      expect(
        harness.graph.ambient.gain.linearRampToValueAtTime,
      ).toHaveBeenCalled(),
    )

    expect(harness.bufferSources).toHaveLength(0)
    expect(harness.filters).toHaveLength(0)
    expect(harness.gains).toHaveLength(0)
    expect(harness.panners).toHaveLength(0)
    expect(harness.graph.ambient.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(0.007, 10),
      24.025,
    )
    expect(harness.graph.ambient.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.018,
      24.72,
    )
    expect(harness.graph.crowd.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(0.21, 10),
      24.025,
    )
    expect(harness.graph.crowd.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.54,
      24.72,
    )
    expect(harness.graph.effects.gain.cancelScheduledValues).not.toHaveBeenCalled()
  })

  it('does not shorten an existing transient or release past dealer ducking', async () => {
    const { speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(30)
    installWebAudioHarness(director, harness.graph)
    const internals = director as unknown as {
      ambientTransientDuck: { until: number } | null
      duckAmbient(graph: typeof harness.graph, duration: number): void
    }

    internals.duckAmbient(harness.graph, 1.2)
    director.playCrowd('round-24:hush', 'hush', 'player')
    await vi.waitFor(() =>
      expect(internals.ambientTransientDuck?.until).toBe(31.2),
    )

    const call = director.playDealerCall('round-24:dealer', '庄家六点')
    const utterance = speak.mock.calls[0][0] as MockSpeechSynthesisUtterance
    utterance.onstart?.()
    ;(harness.graph.context as unknown as { currentTime: number }).currentTime =
      30.2
    harness.graph.crowd.gain.linearRampToValueAtTime.mockClear()
    utterance.onend?.()
    await expect(call).resolves.toBe('ended')

    expect(harness.graph.crowd.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(0.21, 10),
      30.2 + DEALER_VOICE_DUCK_RELEASE_S,
    )
    expect(harness.graph.crowd.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.54,
      31.2,
    )
    expect(internals.ambientTransientDuck?.until).toBe(31.2)
  })

  it('removes and disconnects a crowd voice after its natural end', async () => {
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(34)
    installWebAudioHarness(director, harness.graph)
    const internals = director as unknown as {
      activeCrowdVoices: Set<unknown>
    }

    director.playCrowd('round-24:natural-end', 'reaction', 'player')
    await vi.waitFor(() => expect(harness.bufferSources).toHaveLength(2))
    expect(internals.activeCrowdVoices.size).toBe(2)

    const source = harness.bufferSources[0]
    source.stop.mockClear()
    source.onended?.()

    expect(internals.activeCrowdVoices.size).toBe(1)
    expect(source.onended).toBeNull()
    expect(source.stop).not.toHaveBeenCalled()
    expect(source.disconnect).toHaveBeenCalledTimes(1)
    expect(harness.filters[0]?.disconnect).toHaveBeenCalledTimes(1)
    expect(harness.gains[0]?.disconnect).toHaveBeenCalledTimes(1)
    expect(harness.panners[0]?.disconnect).toHaveBeenCalledTimes(1)
  })

  it('stops active crowd nodes and blocks new ones while hidden or disabled', async () => {
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(36)

    director.playCrowd('round-25:disabled', 'celebration', 'player')
    await Promise.resolve()
    expect(harness.bufferSources).toHaveLength(0)

    installWebAudioHarness(director, harness.graph)
    const internals = director as unknown as {
      activeCrowdVoices: Set<unknown>
    }
    director.playCrowd('round-25:visible', 'celebration', 'banker')
    await vi.waitFor(() => expect(harness.bufferSources).toHaveLength(3))
    expect(internals.activeCrowdVoices.size).toBe(3)
    harness.bufferSources.forEach((source) => {
      source.stop.mockClear()
      source.disconnect.mockClear()
    })
    harness.graph.master.gain.linearRampToValueAtTime.mockClear()

    await director.setPageVisible(false)
    expect(internals.activeCrowdVoices.size).toBe(3)
    expect(harness.graph.master.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0,
      36.035,
    )
    harness.bufferSources.forEach((source, index) => {
      expect(source.stop).toHaveBeenCalledTimes(1)
      expect(source.stop).toHaveBeenCalledWith(36.04)
      expect(source.disconnect).not.toHaveBeenCalled()
      expect(harness.gains[index]?.gain.cancelAndHoldAtTime).toHaveBeenCalledWith(
        36,
      )
      expect(
        harness.gains[index]?.gain.linearRampToValueAtTime,
      ).toHaveBeenCalledWith(0.0001, 36.035)
      source.onended?.()
      expect(source.onended).toBeNull()
    })
    expect(internals.activeCrowdVoices.size).toBe(0)
    harness.bufferSources.forEach((source) => {
      expect(source.disconnect).toHaveBeenCalledTimes(1)
    })
    director.playCrowd('round-25:hidden', 'celebration', 'banker')
    await Promise.resolve()
    expect(harness.bufferSources).toHaveLength(3)

    await director.setPageVisible(true)
    director.playCrowd('round-25:visible-again', 'reaction', 'player')
    await vi.waitFor(() => expect(harness.bufferSources).toHaveLength(5))
    const activeAfterResume = harness.bufferSources.slice(3)
    activeAfterResume.forEach((source) => {
      source.stop.mockClear()
      source.disconnect.mockClear()
    })
    director.setEnabled(false)
    expect(internals.activeCrowdVoices.size).toBe(2)
    activeAfterResume.forEach((source, index) => {
      expect(source.stop).toHaveBeenCalledTimes(1)
      expect(source.disconnect).not.toHaveBeenCalled()
      expect(
        harness.gains[index + 3]?.gain.linearRampToValueAtTime,
      ).toHaveBeenCalledWith(0.0001, 36.035)
      source.onended?.()
      expect(source.onended).toBeNull()
    })
    expect(internals.activeCrowdVoices.size).toBe(0)
    activeAfterResume.forEach((source) => {
      expect(source.disconnect).toHaveBeenCalledTimes(1)
    })
  })
})

describe('CasinoAudioDirector persistent mix', () => {
  it('loads a validated four-channel mix and persists bounded updates', () => {
    const localStorage = {
      getItem: vi.fn((key: string) =>
        key === 'nine-road-baccarat:audio-mix-v1'
          ? JSON.stringify({
              master: 0.6,
              effects: 0.45,
              ambient: 2,
              voice: 'invalid',
            })
          : null,
      ),
      setItem: vi.fn(),
    }
    vi.stubGlobal('window', { localStorage })

    const director = new CasinoAudioDirector()
    expect(director.getMix()).toEqual({
      master: 0.6,
      effects: 0.45,
      ambient: 1,
      voice: 1,
    })

    expect(director.setMix({ master: -1, voice: 0.35 })).toEqual({
      master: 0,
      effects: 0.45,
      ambient: 1,
      voice: 0.35,
    })
    expect(director.setMixChannel('effects', 4)).toEqual({
      master: 0,
      effects: 1,
      ambient: 1,
      voice: 0.35,
    })
    expect(localStorage.setItem).toHaveBeenLastCalledWith(
      'nine-road-baccarat:audio-mix-v1',
      JSON.stringify({
        master: 0,
        effects: 1,
        ambient: 1,
        voice: 0.35,
      }),
    )
  })

  it('falls back to defaults when persisted data cannot be read', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn(() => '{not-json'),
        setItem: vi.fn(),
      },
    })

    expect(loadAudioMix()).toEqual(DEFAULT_CASINO_AUDIO_MIX)
  })

  it('applies all Web Audio channel levels without enabling muted audio', () => {
    const localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    }
    vi.stubGlobal('window', { localStorage })
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(14)
    const internals = director as unknown as {
      graph: typeof harness.graph
    }
    internals.graph = harness.graph

    director.setMix({
      master: 0.5,
      effects: 0.25,
      ambient: 0.4,
      voice: 0.3,
    })

    expect(harness.graph.effects.gain.setValueAtTime).toHaveBeenCalledWith(
      0.18,
      14,
    )
    expect(harness.graph.ambient.gain.setValueAtTime).toHaveBeenCalledWith(
      0.0072,
      14,
    )
    expect(harness.graph.voice.gain.setValueAtTime).toHaveBeenCalledWith(
      0.216,
      14,
    )
    expect(
      harness.graph.master.gain.linearRampToValueAtTime,
    ).toHaveBeenCalledWith(0, 14.035)
  })

  it('restores a clean ambient target across hidden and disabled suspension', async () => {
    vi.useFakeTimers()
    const { speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(44)
    const context = harness.graph.context as unknown as {
      currentTime: number
      state: AudioContextState
      resume: ReturnType<typeof vi.fn>
      suspend: ReturnType<typeof vi.fn>
    }
    context.resume.mockImplementation(async () => {
      context.state = 'running'
    })
    context.suspend.mockImplementation(async () => {
      context.state = 'suspended'
    })
    director.setEnabled(true)
    const internals = director as unknown as {
      ambientLfoGain: ReturnType<typeof createAudioNode<{
        gain: ReturnType<typeof createAudioParam>
      }>> | null
      duckAmbient(graph: typeof harness.graph, duration: number): void
      graph: typeof harness.graph
      noiseBuffer: AudioBuffer
      noiseBufferContext: AudioContext
      preloadSamples(context: AudioContext): Promise<void>
    }
    internals.graph = harness.graph
    internals.noiseBuffer = {} as AudioBuffer
    internals.noiseBufferContext = harness.graph.context
    internals.preloadSamples = vi.fn(async () => undefined)

    await expect(director.unlock()).resolves.toBe(true)
    const firstLfo = internals.ambientLfoGain
    const visibleCall = director.playDealerCall(
      'round-14:visible',
      '闲家五点',
    )
    ;(speak.mock.calls[0][0] as MockSpeechSynthesisUtterance).onstart?.()
    internals.duckAmbient(harness.graph, 0.7)
    harness.graph.ambient.gain.setValueAtTime.mockClear()
    harness.graph.crowd.gain.setValueAtTime.mockClear()
    firstLfo?.gain.setValueAtTime.mockClear()
    harness.graph.effects.gain.cancelScheduledValues.mockClear()
    harness.graph.master.gain.linearRampToValueAtTime.mockClear()

    await director.setPageVisible(false)
    await expect(visibleCall).resolves.toBe('cancelled')
    expect(harness.graph.ambient.gain.setValueAtTime).not.toHaveBeenCalled()
    expect(harness.graph.crowd.gain.setValueAtTime).not.toHaveBeenCalled()
    expect(firstLfo?.gain.setValueAtTime).not.toHaveBeenCalled()
    expect(harness.graph.master.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0,
      44.035,
    )
    expect(harness.graph.effects.gain.cancelScheduledValues).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(45)
    expect(context.state).toBe('suspended')
    context.currentTime = 45
    await director.setPageVisible(true)
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(harness.graph.ambient.gain.setValueAtTime).toHaveBeenLastCalledWith(
      0.018,
      45,
    )
    expect(internals.ambientLfoGain?.gain.setValueAtTime).toHaveBeenLastCalledWith(
      0.004,
      45,
    )

    const enabledCall = director.playDealerCall(
      'round-14:enabled',
      '庄家六点',
    )
    ;(speak.mock.calls[1][0] as MockSpeechSynthesisUtterance).onstart?.()
    internals.duckAmbient(harness.graph, 0.7)
    context.currentTime = 46
    harness.graph.ambient.gain.setValueAtTime.mockClear()
    harness.graph.crowd.gain.setValueAtTime.mockClear()

    director.setEnabled(false)
    await expect(enabledCall).resolves.toBe('cancelled')
    expect(harness.graph.ambient.gain.setValueAtTime).not.toHaveBeenCalled()
    expect(harness.graph.crowd.gain.setValueAtTime).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(45)
    expect(context.state).toBe('suspended')
    director.setEnabled(true)
    context.currentTime = 47
    await expect(director.unlock()).resolves.toBe(true)
    expect(harness.graph.ambient.gain.setValueAtTime).toHaveBeenLastCalledWith(
      0.018,
      47,
    )
    expect(internals.ambientLfoGain?.gain.setValueAtTime).toHaveBeenLastCalledWith(
      0.004,
      47,
    )
  })

  it('does not reset an active envelope during a routine unlock', async () => {
    const { speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(50)
    director.setEnabled(true)
    const internals = director as unknown as {
      ambientLfoGain: {
        gain: ReturnType<typeof createAudioParam>
      } | null
      graph: typeof harness.graph
      noiseBuffer: AudioBuffer
      noiseBufferContext: AudioContext
      preloadSamples(context: AudioContext): Promise<void>
    }
    internals.graph = harness.graph
    internals.noiseBuffer = {} as AudioBuffer
    internals.noiseBufferContext = harness.graph.context
    internals.preloadSamples = vi.fn(async () => undefined)
    await expect(director.unlock()).resolves.toBe(true)

    const call = director.playDealerCall(
      'round-15:release-envelope',
      '庄家六点',
    )
    const utterance = speak.mock.calls[0][0] as MockSpeechSynthesisUtterance
    utterance.onstart?.()
    utterance.onend?.()
    await expect(call).resolves.toBe('ended')
    harness.graph.ambient.gain.cancelScheduledValues.mockClear()
    internals.ambientLfoGain?.gain.cancelScheduledValues.mockClear()

    director.setMixChannel('effects', 0.5)
    director.setMixChannel('master', 0.5)
    director.setMixChannel('voice', 0.5)
    expect(
      harness.graph.ambient.gain.cancelScheduledValues,
    ).not.toHaveBeenCalled()
    expect(
      internals.ambientLfoGain?.gain.cancelScheduledValues,
    ).not.toHaveBeenCalled()

    await expect(director.unlock()).resolves.toBe(true)

    expect(
      harness.graph.ambient.gain.cancelScheduledValues,
    ).not.toHaveBeenCalled()
    expect(
      internals.ambientLfoGain?.gain.cancelScheduledValues,
    ).not.toHaveBeenCalled()
  })

  it('waits for the ambient envelope to settle before swapping in a sample', async () => {
    vi.useFakeTimers()
    createSpeechHarness()
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(60)
    const context = harness.graph.context as unknown as {
      currentTime: number
      state: AudioContextState
      resume: ReturnType<typeof vi.fn>
    }
    context.resume.mockImplementation(async () => {
      context.state = 'running'
    })
    director.setEnabled(true)
    let finishLoad: ((buffer: AudioBuffer | null) => void) | undefined
    const internals = director as unknown as {
      duckAmbient(graph: typeof harness.graph, duration: number): void
      graph: typeof harness.graph
      loadSample(
        context: AudioContext,
        sampleId: 'room-crowd-loop',
      ): Promise<AudioBuffer | null>
      noiseBuffer: AudioBuffer
      noiseBufferContext: AudioContext
      sampleBuffers: Map<string, AudioBuffer>
      startAmbient(): void
    }
    internals.graph = harness.graph
    internals.noiseBuffer = {} as AudioBuffer
    internals.noiseBufferContext = harness.graph.context
    internals.loadSample = vi.fn(
      () =>
        new Promise<AudioBuffer | null>((resolve) => {
          finishLoad = resolve
        }),
    )

    internals.startAmbient()
    internals.duckAmbient(harness.graph, 0.7)
    const createBufferSource = harness.graph.context
      .createBufferSource as unknown as ReturnType<typeof vi.fn>
    const syntheticSource = createBufferSource.mock.results[0]
      ?.value as ReturnType<typeof createAudioNode<{ stop: ReturnType<typeof vi.fn> }>>
    const recordedRoom = {} as AudioBuffer
    internals.sampleBuffers.set('room-crowd-loop', recordedRoom)
    finishLoad?.(recordedRoom)
    await Promise.resolve()

    await vi.advanceTimersByTimeAsync(100)
    expect(syntheticSource.stop).not.toHaveBeenCalled()

    context.state = 'suspended'
    await vi.advanceTimersByTimeAsync(1_000)
    expect(syntheticSource.stop).not.toHaveBeenCalled()

    context.currentTime = 60.7
    await expect(director.unlock()).resolves.toBe(true)

    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(syntheticSource.stop).toHaveBeenCalledTimes(1)
    expect(createBufferSource.mock.results[1]?.value.buffer).toBe(recordedRoom)
  })
})

describe('CasinoAudioDirector motion timing', () => {
  it('prefers a decoded chip recording over the synthesized fallback', async () => {
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(11)
    installWebAudioHarness(director, harness.graph)
    const sample = {} as AudioBuffer
    const internals = director as unknown as {
      sampleBufferContext: AudioContext
      sampleBuffers: Map<string, AudioBuffer>
    }
    internals.sampleBufferContext = harness.graph.context
    internals.sampleBuffers = new Map([
      ['chip-lay-1', sample],
      ['chip-lay-2', sample],
    ])

    director.playChip('round-2:player:chip', 'player', 215)
    await vi.waitFor(() => expect(harness.bufferStarts).toHaveLength(1))

    expect(harness.bufferStarts[0]).toBeCloseTo(11.215)
    expect(harness.oscillatorStarts).toHaveLength(0)
    expect(harness.panners.at(-1)?.pan.value).toBeLessThan(0)
  })

  it('uses the synth fallback when one recording cannot be loaded', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
    }))
    vi.stubGlobal('fetch', fetchMock)
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(18)
    installWebAudioHarness(director, harness.graph)

    director.playCardLand('round-2:p1:missing-sample', 'player', 0)
    await vi.waitFor(() => expect(harness.bufferStarts).toHaveLength(1))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(harness.oscillatorStarts).toHaveLength(1)
    expect(harness.bufferStarts[0]).toBe(18)
  })

  it('retries failed recordings after the ten-minute offline interval', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
      })
    vi.stubGlobal('fetch', fetchMock)
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(19)
    installWebAudioHarness(director, harness.graph)
    const internals = director as unknown as {
      loadSample(
        context: AudioContext,
        sampleId: 'chip-lay-1',
      ): Promise<AudioBuffer | null>
      sampleBuffers: Map<string, AudioBuffer>
    }

    await expect(
      internals.loadSample(harness.graph.context, 'chip-lay-1'),
    ).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(AUDIO_SAMPLE_RETRY_MS - 1)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(internals.sampleBuffers.has('chip-lay-1')).toBe(true)
  })

  it('falls through from WAV to Ogg when one encoding cannot decode', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 415 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
      })
    vi.stubGlobal('fetch', fetchMock)
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(22)
    const internals = director as unknown as {
      loadSample(
        context: AudioContext,
        sampleId: 'chip-lay-1',
      ): Promise<AudioBuffer | null>
    }

    await expect(
      internals.loadSample(harness.graph.context, 'chip-lay-1'),
    ).resolves.not.toBeNull()

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/assets/audio/chip-lay-1.wav',
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/assets/audio/chip-lay-1.ogg',
    )
    expect(
      harness.graph.context.decodeAudioData,
    ).toHaveBeenCalledTimes(1)
  })

  it('schedules card contact at the requested visual offset and deduplicates it', async () => {
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(12)
    installWebAudioHarness(director, harness.graph)

    director.playCardLand('round-3:p1:contact', 'player', 669)
    director.playCardLand('round-3:p1:contact', 'player', 669)
    await vi.waitFor(() => expect(harness.bufferStarts).toHaveLength(1))

    expect(harness.bufferStarts[0]).toBeCloseTo(12.669)
    expect(harness.oscillatorStarts[0]).toBeCloseTo(12.669)
    expect(harness.panners.every((panner) => panner.pan.value < 0)).toBe(true)
  })

  it('starts pay clatter at contact and finishes on the wager side', async () => {
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(20)
    installWebAudioHarness(director, harness.graph)

    director.playSettlementStep(
      'round-4:settlement:0:player:pay',
      'pay',
      'player',
      541,
    )
    await vi.waitFor(() => expect(harness.bufferStarts).toHaveLength(2))

    expect(harness.bufferStarts).toEqual([
      expect.closeTo(20.541, 5),
      expect.closeTo(20.587, 5),
    ])
    expect(harness.oscillatorStarts).toEqual([
      expect.closeTo(20.549, 5),
      expect.closeTo(20.593, 5),
    ])
    expect(harness.panners[0]?.pan.value).toBe(0)
    expect(harness.panners.at(-1)?.pan.value).toBeLessThan(0)
  })

  it('reserves an event before unlock and keeps its delay anchored to call time', async () => {
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(12)
    director.setEnabled(true)
    const internals = director as unknown as {
      graph: typeof harness.graph
      noiseBuffer: AudioBuffer
    }
    internals.graph = harness.graph
    internals.noiseBuffer = {} as AudioBuffer

    let finishUnlock: ((ready: boolean) => void) | undefined
    const unlock = vi.spyOn(director, 'unlock').mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishUnlock = resolve
      }),
    )

    director.playCardLand('round-5:p1:contact', 'player', 669)
    director.playCardLand('round-5:p1:contact', 'player', 669)
    expect(unlock).toHaveBeenCalledTimes(1)
    expect(harness.bufferStarts).toHaveLength(0)

    ;(harness.graph.context as unknown as { currentTime: number }).currentTime =
      12.4
    finishUnlock?.(true)
    await vi.waitFor(() => expect(harness.bufferStarts).toHaveLength(1))

    expect(harness.bufferStarts[0]).toBeCloseTo(12.669)
    expect(harness.oscillatorStarts[0]).toBeCloseTo(12.669)
  })

  it('uses unlock completion time when no context existed at call time', async () => {
    const director = new CasinoAudioDirector()
    const harness = createWebAudioHarness(30)
    director.setEnabled(true)
    const internals = director as unknown as {
      graph: typeof harness.graph | null
      noiseBuffer: AudioBuffer | null
    }

    vi.spyOn(director, 'unlock').mockImplementation(async () => {
      internals.graph = harness.graph
      internals.noiseBuffer = {} as AudioBuffer
      return true
    })

    director.playCardLand('round-6:p1:contact', 'player', 578)
    await vi.waitFor(() => expect(harness.bufferStarts).toHaveLength(1))

    expect(harness.bufferStarts[0]).toBeCloseTo(30.578)
    expect(harness.oscillatorStarts[0]).toBeCloseTo(30.578)
  })

  it('rebuilds a closed context and recreates its context-owned noise buffer', async () => {
    const director = new CasinoAudioDirector()
    const closedHarness = createWebAudioHarness(8)
    const replacementHarness = createWebAudioHarness(40)
    const staleCrowdSource = closedHarness.graph.context.createBufferSource()
    const staleCrowdGain = closedHarness.graph.context.createGain()
    const staleCrowdVoice = {
      context: closedHarness.graph.context,
      source: staleCrowdSource,
      gain: staleCrowdGain,
      nodes: [staleCrowdSource, staleCrowdGain],
      cleanupTimer: null,
    }
    ;(
      closedHarness.graph.context as unknown as { state: AudioContextState }
    ).state = 'closed'
    const staleNoise = {} as AudioBuffer
    const AudioContextMock = vi.fn(function AudioContextMock() {
      return replacementHarness.graph.context
    })
    vi.stubGlobal('window', {
      AudioContext: AudioContextMock,
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
      },
    })

    director.setEnabled(true)
    const internals = director as unknown as {
      activeCrowdVoices: Set<typeof staleCrowdVoice>
      graph: typeof closedHarness.graph
      noiseBuffer: AudioBuffer | null
    }
    internals.graph = closedHarness.graph
    internals.noiseBuffer = staleNoise
    internals.activeCrowdVoices.add(staleCrowdVoice)

    await expect(director.unlock()).resolves.toBe(true)

    expect(AudioContextMock).toHaveBeenCalledTimes(1)
    expect(internals.graph.context).toBe(replacementHarness.graph.context)
    expect(internals.noiseBuffer).not.toBe(staleNoise)
    expect(
      replacementHarness.graph.context.createBuffer,
    ).toHaveBeenCalledTimes(1)
    expect(internals.activeCrowdVoices.size).toBe(0)
    expect(staleCrowdSource.stop).toHaveBeenCalledTimes(1)
    expect(staleCrowdSource.disconnect).toHaveBeenCalledTimes(1)
    expect(staleCrowdGain.disconnect).toHaveBeenCalledTimes(1)
    expect(closedHarness.graph.crowd.disconnect).toHaveBeenCalledTimes(1)
    expect(closedHarness.graph.master.disconnect).toHaveBeenCalledTimes(1)
  })
})
