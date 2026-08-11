export const AMBIENT_LOOP_CROSSFADE_SECONDS = 0.25

/**
 * Reorders a room-tone buffer so a short equal-power crossfade is inside the
 * buffer rather than at the playback boundary. The resulting loop ends on
 * the sample immediately before its first sample, avoiding a hard wrap.
 */
export function createSeamlessAmbientLoop(
  context: BaseAudioContext,
  input: AudioBuffer,
  crossfadeSeconds = AMBIENT_LOOP_CROSSFADE_SECONDS,
): AudioBuffer {
  const fadeFrames = Math.min(
    Math.round(input.sampleRate * Math.max(0, crossfadeSeconds)),
    Math.floor((input.length - 1) / 2),
  )
  if (
    !Number.isFinite(input.sampleRate) ||
    input.numberOfChannels < 1 ||
    fadeFrames < 2
  ) {
    return input
  }

  try {
    const output = context.createBuffer(
      input.numberOfChannels,
      input.length - fadeFrames,
      input.sampleRate,
    )
    const middleEnd = input.length - fadeFrames
    const denominator = fadeFrames - 1

    for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
      const source = input.getChannelData(channel)
      const target = output.getChannelData(channel)
      for (let frame = 0; frame < fadeFrames; frame += 1) {
        if (frame === 0) {
          target[frame] = source[middleEnd]
          continue
        }
        if (frame === denominator) {
          target[frame] = source[frame]
          continue
        }
        const progress = frame / denominator
        target[frame] =
          source[middleEnd + frame] * Math.cos(progress * Math.PI * 0.5) +
          source[frame] * Math.sin(progress * Math.PI * 0.5)
      }
      target.set(source.subarray(fadeFrames, middleEnd), fadeFrames)
    }

    return output
  } catch {
    // Decoding should still yield usable ambience if a browser rejects a
    // replacement buffer (for example under a constrained AudioContext).
    return input
  }
}
