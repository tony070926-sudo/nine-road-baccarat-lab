interface RoundPreludeGateStart {
  dealerCall: Promise<unknown>
  visualDelayMs: number
  canComplete: () => boolean
  onComplete: () => void
}

/**
 * Releases a prepared round exactly once after both the table's visual hold and
 * the dealer's no-more-bets call are complete. A generation token prevents a
 * cancelled or superseded call from reviving a stale round.
 */
export class RoundPreludeCompletionGate {
  private generation = 0
  private timer: ReturnType<typeof globalThis.setTimeout> | null = null

  start({
    dealerCall,
    visualDelayMs,
    canComplete,
    onComplete,
  }: RoundPreludeGateStart) {
    this.cancel()
    const generation = this.generation
    let visualDelayComplete = false
    let dealerCallComplete = false
    let terminal = false

    const attemptComplete = () => {
      if (
        terminal ||
        generation !== this.generation ||
        !visualDelayComplete ||
        !dealerCallComplete
      ) {
        return
      }

      terminal = true
      if (canComplete()) onComplete()
    }
    const markDealerCallComplete = () => {
      dealerCallComplete = true
      attemptComplete()
    }

    void dealerCall.then(markDealerCallComplete, markDealerCallComplete)
    this.timer = globalThis.setTimeout(() => {
      if (generation !== this.generation) return
      this.timer = null
      visualDelayComplete = true
      attemptComplete()
    }, Math.max(0, visualDelayMs))
  }

  cancel() {
    this.generation += 1
    if (this.timer === null) return
    globalThis.clearTimeout(this.timer)
    this.timer = null
  }
}
