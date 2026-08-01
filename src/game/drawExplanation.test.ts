import { describe, expect, it } from 'vitest'
import type { Card, DealResult, Rank } from '../types'
import { buildDrawExplanation } from './drawExplanation'

function card(id: string, rank: Rank): Card {
  return { id, rank, suit: 'spades', deck: 1 }
}

function round(
  playerRanks: Rank[],
  bankerRanks: Rank[],
): DealResult {
  const playerCards = playerRanks.map((rank, index) =>
    card(`p${index + 1}`, rank),
  )
  const bankerCards = bankerRanks.map((rank, index) =>
    card(`b${index + 1}`, rank),
  )
  const dealOrder = [
    playerCards[0],
    bankerCards[0],
    playerCards[1],
    bankerCards[1],
    playerCards[2],
    bankerCards[2],
  ].filter((item): item is Card => Boolean(item))

  return {
    playerCards,
    bankerCards,
    dealOrder,
    playerTotal: 0,
    bankerTotal: 0,
    winner: 'tie',
    natural: false,
    playerPair: false,
    bankerPair: false,
    cardsUsed: dealOrder.length,
  }
}

function bankerDecision(result: DealResult, revealedCount = 5) {
  return buildDrawExplanation(result, revealedCount).find(
    (step) => step.stage === 'banker',
  )
}

describe('buildDrawExplanation', () => {
  it('reveals no totals, natural result, or third-card decision before all opening cards', () => {
    const result = round(['9', 'K'], ['7', 'Q'])

    for (const revealedCount of [0, 1, 2, 3]) {
      const trace = buildDrawExplanation(result, revealedCount)
      expect(trace).toHaveLength(1)
      expect(trace[0]).toMatchObject({
        stage: 'opening',
        decision: 'waiting',
      })
      expect(trace[0].explanation).not.toContain('闲家 9 点')
      expect(trace[0].explanation).not.toContain('自然牌成立')
    }
  })

  it('explains a natural only after the four opening cards are exposed', () => {
    const trace = buildDrawExplanation(round(['9', 'K'], ['7', 'Q']), 4)

    expect(trace).toHaveLength(1)
    expect(trace[0]).toMatchObject({
      stage: 'natural',
      decision: 'natural',
      title: '自然牌成立',
    })
    expect(trace[0].explanation).toContain('闲家 9 点、庄家 7 点')
  })

  it('does not leak the player third card or banker matrix result at revealedCount four', () => {
    const result = round(['2', '3', '8'], ['A', '2'])
    const trace = buildDrawExplanation(result, 4)
    const banker = trace.find((step) => step.stage === 'banker')

    expect(trace.find((step) => step.stage === 'player')).toMatchObject({
      decision: 'draw',
    })
    expect(banker).toMatchObject({ decision: 'waiting' })
    expect(banker?.explanation).not.toContain('第三张 8 点')
    expect(banker?.title).not.toBe('庄家停牌')
  })

  it('applies the banker matrix once the player third card is public', () => {
    expect(bankerDecision(round(['2', '3', '8'], ['A', 'A']))).toMatchObject({
      decision: 'draw',
      title: '庄家补牌',
    })
    expect(bankerDecision(round(['2', '3', 'K'], ['K', 'Q']))).toMatchObject({
      decision: 'draw',
    })
    expect(bankerDecision(round(['2', '3', '8'], ['A', '2']))).toMatchObject({
      decision: 'stand',
      title: '庄家停牌',
    })
    expect(bankerDecision(round(['2', '3', '7'], ['A', '2']))).toMatchObject({
      decision: 'draw',
      title: '庄家补牌',
    })
    expect(bankerDecision(round(['2', '3', '2'], ['2', '2']))).toMatchObject({
      decision: 'draw',
    })
    expect(bankerDecision(round(['2', '3', 'A'], ['2', '2']))).toMatchObject({
      decision: 'stand',
    })
    expect(bankerDecision(round(['2', '3', '4'], ['2', '3']))).toMatchObject({
      decision: 'draw',
    })
    expect(bankerDecision(round(['2', '3', '3'], ['2', '3']))).toMatchObject({
      decision: 'stand',
    })
    expect(bankerDecision(round(['2', '3', '6'], ['3', '3']))).toMatchObject({
      decision: 'draw',
    })
    expect(bankerDecision(round(['2', '3', '5'], ['3', '3']))).toMatchObject({
      decision: 'stand',
    })
    expect(bankerDecision(round(['2', '3', '9'], ['3', '4']))).toMatchObject({
      decision: 'stand',
    })
  })

  it('uses the simpler banker rule immediately when the player stands', () => {
    expect(bankerDecision(round(['3', '3'], ['2', '3']), 4)).toMatchObject({
      decision: 'draw',
    })
    expect(bankerDecision(round(['3', '3'], ['3', '3']), 4)).toMatchObject({
      decision: 'stand',
    })
  })
})
