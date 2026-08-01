import { describe, expect, it } from 'vitest'
import { createSeededRandomInt } from './baccarat'
import {
  PROBABILITY_LAB_ROUND_OPTIONS,
  runProbabilityLab,
  wilson95Interval,
} from './probabilityLab'

describe('probability lab', () => {
  it.each(PROBABILITY_LAB_ROUND_OPTIONS)(
    'runs exactly %i rounds through real eight-deck shoes',
    (rounds) => {
      const report = runProbabilityLab({ rounds, seed: 42 })
      const winnerCount =
        report.metrics.banker.count +
        report.metrics.player.count +
        report.metrics.tie.count

      expect(report.rounds).toBe(rounds)
      expect(winnerCount).toBe(rounds)
      expect(report.deckCount).toBe(8)
      expect(report.shoes).toBeGreaterThanOrEqual(1)
      expect(report.metrics.playerPair.count).toBeLessThanOrEqual(rounds)
      expect(report.metrics.bankerPair.count).toBeLessThanOrEqual(rounds)
    },
  )

  it('is fully reproducible for the same seeded RNG', () => {
    const first = runProbabilityLab({ rounds: 1_000, seed: 0x1234abcd })
    const second = runProbabilityLab({ rounds: 1_000, seed: 0x1234abcd })
    const different = runProbabilityLab({ rounds: 1_000, seed: 0x1234abce })

    expect(second).toEqual(first)
    expect(different.metrics).not.toEqual(first.metrics)
  })

  it('accepts an injected seeded random source without touching production randomness', () => {
    const first = runProbabilityLab({
      rounds: 100,
      randomInt: createSeededRandomInt(99),
    })
    const second = runProbabilityLab({
      rounds: 100,
      randomInt: createSeededRandomInt(99),
    })

    expect(first.randomSource).toBe('injected')
    expect(first.seed).toBeNull()
    expect(second.metrics).toEqual(first.metrics)
  })

  it('reports theoretical values, absolute deviations, Wilson intervals, and house-edge meaning', () => {
    const report = runProbabilityLab({ rounds: 1_000, seed: 7 })

    for (const metric of Object.values(report.metrics)) {
      expect(metric.absoluteDeviation).toBeCloseTo(
        Math.abs(metric.observed - metric.theoretical),
        12,
      )
      expect(metric.confidence95.method).toBe('wilson-95')
      expect(metric.confidence95.lower).toBeGreaterThanOrEqual(0)
      expect(metric.confidence95.upper).toBeLessThanOrEqual(1)
      expect(metric.confidence95.lower).toBeLessThanOrEqual(metric.observed)
      expect(metric.confidence95.upper).toBeGreaterThanOrEqual(metric.observed)
    }
    expect(report.houseEdges.banker.value).toBeCloseTo(0.010579058, 9)
    expect(report.houseEdges.tie.explanation).toContain('长期每下注 100 分')
    expect(report.houseEdgeSummary).toContain('不能预测下一局')
  })

  it('rejects unsupported sample sizes and invalid confidence inputs', () => {
    expect(() =>
      runProbabilityLab({ rounds: 99 as 100, seed: 1 }),
    ).toThrow(/exactly 100, 1000, or 10000/)
    expect(() => wilson95Interval(2, 1)).toThrow(/valid sample/)
  })
})
