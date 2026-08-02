import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoundPreludeCompletionGate } from './roundPreludeGate'

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('RoundPreludeCompletionGate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('waits for both completions in either order and completes once', async () => {
    const speech = deferred()
    const onComplete = vi.fn()
    const gate = new RoundPreludeCompletionGate()

    gate.start({
      dealerCall: speech.promise,
      visualDelayMs: 720,
      canComplete: () => true,
      onComplete,
    })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(onComplete).not.toHaveBeenCalled()

    speech.resolve()
    await Promise.resolve()
    expect(onComplete).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync()
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale round and treats rejection as call completion', async () => {
    const onComplete = vi.fn()
    const gate = new RoundPreludeCompletionGate()

    gate.start({
      dealerCall: Promise.reject(new Error('speech unavailable')),
      visualDelayMs: 20,
      canComplete: () => false,
      onComplete,
    })
    await vi.runAllTimersAsync()

    expect(onComplete).not.toHaveBeenCalled()
  })

  it('cancels the timer and ignores a late dealer callback', async () => {
    const speech = deferred()
    const onComplete = vi.fn()
    const gate = new RoundPreludeCompletionGate()

    gate.start({
      dealerCall: speech.promise,
      visualDelayMs: 20,
      canComplete: () => true,
      onComplete,
    })
    gate.cancel()
    speech.resolve()
    await vi.runAllTimersAsync()

    expect(onComplete).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('invalidates the prior generation when a new round starts', async () => {
    const staleSpeech = deferred()
    const staleComplete = vi.fn()
    const currentComplete = vi.fn()
    const gate = new RoundPreludeCompletionGate()

    gate.start({
      dealerCall: staleSpeech.promise,
      visualDelayMs: 20,
      canComplete: () => true,
      onComplete: staleComplete,
    })
    gate.start({
      dealerCall: Promise.resolve(),
      visualDelayMs: 20,
      canComplete: () => true,
      onComplete: currentComplete,
    })
    staleSpeech.resolve()
    await vi.runAllTimersAsync()

    expect(staleComplete).not.toHaveBeenCalled()
    expect(currentComplete).toHaveBeenCalledTimes(1)
  })
})
