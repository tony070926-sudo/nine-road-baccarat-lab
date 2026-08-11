import { describe, expect, it, vi } from 'vitest'
import {
  AMBIENT_LOOP_CROSSFADE_SECONDS,
  createSeamlessAmbientLoop,
} from './ambientLoop'

function audioBuffer(
  channels: readonly number[][],
  sampleRate = 4,
): AudioBuffer {
  const data = channels.map((channel) => Float32Array.from(channel))
  return {
    numberOfChannels: data.length,
    length: data[0]?.length ?? 0,
    sampleRate,
    getChannelData: (channel: number) => data[channel] as Float32Array,
  } as AudioBuffer
}

function audioContext() {
  const buffers: AudioBuffer[] = []
  const createBuffer = vi.fn(
    (channels: number, length: number, sampleRate: number) => {
      const buffer = audioBuffer(
        Array.from({ length: channels }, () => Array<number>(length).fill(0)),
        sampleRate,
      )
      buffers.push(buffer)
      return buffer
    },
  )
  return {
    buffers,
    context: { createBuffer } as unknown as BaseAudioContext,
    createBuffer,
  }
}

describe('createSeamlessAmbientLoop', () => {
  it('moves the crossfade inside the buffer so the loop boundary is contiguous', () => {
    const { context } = audioContext()
    const source = audioBuffer([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]])

    const output = createSeamlessAmbientLoop(context, source, 0.5)
    const channel = output.getChannelData(0)

    expect(output).not.toBe(source)
    expect(channel).toHaveLength(10)
    expect([...channel]).toEqual([10, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(channel.at(-1)).toBe(9)
    expect(channel[0]).toBe(10)
  })

  it('keeps all channels aligned and uses the configured 250ms default', () => {
    const { context } = audioContext()
    const source = audioBuffer(
      [
        [0, 1, 2, 3, 4, 5, 6, 7],
        [10, 11, 12, 13, 14, 15, 16, 17],
      ],
      8,
    )

    const output = createSeamlessAmbientLoop(context, source)

    expect(AMBIENT_LOOP_CROSSFADE_SECONDS).toBe(0.25)
    expect([...output.getChannelData(0)]).toEqual([6, 1, 2, 3, 4, 5])
    expect([...output.getChannelData(1)]).toEqual([16, 11, 12, 13, 14, 15])
  })

  it('uses an equal-power blend between the tail and the head', () => {
    const { context } = audioContext()
    const source = audioBuffer([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]], 8)

    const channel = createSeamlessAmbientLoop(context, source, 0.5).getChannelData(0)

    expect(channel[0]).toBe(8)
    expect(channel[1]).toBeCloseTo(9 * Math.cos(Math.PI / 6) + 0.5, 6)
    expect(channel[2]).toBeCloseTo(5 + 2 * Math.sin(Math.PI / 3), 6)
    expect(channel[3]).toBe(3)
  })

  it('fails open for buffers too short to make a meaningful crossfade', () => {
    const { context, createBuffer } = audioContext()
    const source = audioBuffer([[0, 1, 2]], 4)

    expect(createSeamlessAmbientLoop(context, source, 0.5)).toBe(source)
    expect(createBuffer).not.toHaveBeenCalled()
  })

  it('keeps the decoded recording when allocating a replacement buffer fails', () => {
    const { context, createBuffer } = audioContext()
    const source = audioBuffer([[0, 1, 2, 3, 4, 5, 6, 7]], 8)
    createBuffer.mockImplementation(() => {
      throw new Error('AudioContext allocation failed')
    })

    expect(createSeamlessAmbientLoop(context, source, 0.25)).toBe(source)
  })
})
