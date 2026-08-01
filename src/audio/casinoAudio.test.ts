import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUDIO_SAMPLE_RETRY_MS,
  CasinoAudioDirector,
  DEALER_CALL_FALLBACK_MS,
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
  const oscillatorStarts: number[] = []
  const panners: Array<{ pan: ReturnType<typeof createAudioParam> }> = []

  const context = {
    currentTime,
    state: 'running',
    sampleRate: 48_000,
    destination: createAudioNode({}),
    createBuffer: vi.fn((_channels: number, length: number) => ({
      getChannelData: vi.fn(() => new Float32Array(length)),
    })),
    createBiquadFilter: vi.fn(() =>
      createAudioNode({
        frequency: createAudioParam(),
        Q: createAudioParam(),
        type: 'bandpass',
      }),
    ),
    createBufferSource: vi.fn(() =>
      createAudioNode({
        buffer: null,
        loop: false,
        playbackRate: createAudioParam(1),
        start: vi.fn((when = 0) => bufferStarts.push(when)),
        stop: vi.fn(),
      }),
    ),
    createGain: vi.fn(() =>
      createAudioNode({ gain: createAudioParam() }),
    ),
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
  const voice = createAudioNode({ gain: createAudioParam() })
  const compressor = createAudioNode({})
  const graph = {
    context,
    master,
    effects,
    ambient,
    voice,
    compressor,
  }

  return { bufferStarts, graph, oscillatorStarts, panners }
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

  it('ignores a cancelled utterance finishing after the next call starts', async () => {
    const { cancel, speak } = createSpeechHarness()
    const director = new CasinoAudioDirector()
    director.setEnabled(true)

    const stale = director.playDealerCall('round-11:stale', '闲家五点')
    const staleUtterance = speak.mock.calls[0][0] as MockSpeechSynthesisUtterance
    director.cancelDealerCalls()
    await expect(stale).resolves.toBe('cancelled')

    const current = director.playDealerCall('round-12:current', '庄家六点')
    const currentUtterance = speak.mock.calls[1][0] as MockSpeechSynthesisUtterance
    let currentFinished = false
    void current.then(() => {
      currentFinished = true
    })
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
    director.setEnabled(true)

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
    director.setEnabled(true)
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
      graph: typeof closedHarness.graph
      noiseBuffer: AudioBuffer | null
    }
    internals.graph = closedHarness.graph
    internals.noiseBuffer = staleNoise

    await expect(director.unlock()).resolves.toBe(true)

    expect(AudioContextMock).toHaveBeenCalledTimes(1)
    expect(internals.graph.context).toBe(replacementHarness.graph.context)
    expect(internals.noiseBuffer).not.toBe(staleNoise)
    expect(
      replacementHarness.graph.context.createBuffer,
    ).toHaveBeenCalledTimes(1)
    expect(closedHarness.graph.master.disconnect).toHaveBeenCalledTimes(1)
  })
})
