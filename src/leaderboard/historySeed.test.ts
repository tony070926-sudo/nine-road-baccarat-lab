import { describe, expect, it } from 'vitest'
import { leaderboardHighFromRecordedGame } from './historySeed'

describe('leaderboard history migration seed', () => {
  it('recovers an older high even when the current balance is below baseline', () => {
    expect(
      leaderboardHighFromRecordedGame(9_000, [
        { balanceBefore: 10_000, balanceAfter: 15_000.5 },
        { balanceBefore: 15_000.5, balanceAfter: 9_000 },
      ]),
    ).toBe(15_000.5)
  })

  it('keeps the 10,000 baseline and ignores values outside public API bounds', () => {
    expect(
      leaderboardHighFromRecordedGame(9_500, [
        { balanceBefore: 9_500, balanceAfter: 1_000_000_000.5 },
      ]),
    ).toBe(10_000)
  })
})
