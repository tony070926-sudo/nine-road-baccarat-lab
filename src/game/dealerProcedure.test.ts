import { describe, expect, it } from 'vitest'
import type { Card, DealResult, Rank, Suit } from '../types'
import {
  buildDealerProcedurePlan,
  type DealerProcedurePlan,
  type DealerProcedureSettlementState,
  type DealerProcedureStepKind,
} from './dealerProcedure'

function card(id: string, rank: Rank, suit: Suit = 'spades'): Card {
  return { id, rank, suit, deck: 1 }
}

function result(options: {
  player: Card[]
  banker: Card[]
  natural?: boolean
  winner: DealResult['winner']
  playerTotal: number
  bankerTotal: number
}): DealResult {
  const dealOrder = [
    options.player[0],
    options.banker[0],
    options.player[1],
    options.banker[1],
    ...options.player.slice(2),
    ...options.banker.slice(2),
  ]

  return {
    playerCards: options.player,
    bankerCards: options.banker,
    dealOrder,
    playerTotal: options.playerTotal,
    bankerTotal: options.bankerTotal,
    winner: options.winner,
    natural: options.natural ?? false,
    playerPair: false,
    bankerPair: false,
    cardsUsed: dealOrder.length,
  }
}

function naturalResult(): DealResult {
  return result({
    player: [card('p1', '9'), card('p2', 'K', 'hearts')],
    banker: [card('b1', '7'), card('b2', 'Q', 'hearts')],
    natural: true,
    winner: 'player',
    playerTotal: 9,
    bankerTotal: 7,
  })
}

function bothDrawResult(): DealResult {
  return result({
    player: [card('p1', '2'), card('p2', '3'), card('p3', '4')],
    banker: [card('b1', '3'), card('b2', '2'), card('b3', '3')],
    winner: 'player',
    playerTotal: 9,
    bankerTotal: 8,
  })
}

function kinds(plan: DealerProcedurePlan): DealerProcedureStepKind[] {
  return plan.steps.map((step) => step.kind)
}

function activeKind(plan: DealerProcedurePlan): DealerProcedureStepKind {
  const active = plan.steps.find((step) => step.status === 'active')
  if (!active) throw new Error('Expected one active dealer procedure step')
  return active.kind
}

describe('buildDealerProcedurePlan', () => {
  it('opens with betting when no round has been prepared', () => {
    expect(buildDealerProcedurePlan({ round: null })).toEqual({
      steps: [
        {
          id: 'place-bets',
          kind: 'place-bets',
          status: 'active',
        },
      ],
      activeStepId: 'place-bets',
      revealedCount: 0,
      revealComplete: false,
    })
  })

  it('models a natural after the P/B/P/B opening deal without third-card steps', () => {
    const plan = buildDealerProcedurePlan({
      round: { result: naturalResult(), revealedCount: 4 },
    })

    expect(kinds(plan)).toEqual([
      'place-bets',
      'no-more-bets',
      'deal-opening-card',
      'deal-opening-card',
      'deal-opening-card',
      'deal-opening-card',
      'reveal-opening-hands',
      'announce-initial-points',
      'announce-final-result',
      'collect-losing-wagers',
      'pay-winning-wagers',
      'record-road',
      'sweep-cards-to-discard-tray',
      'open-next-round',
    ])
    expect(
      plan.steps
        .filter((step) => step.kind === 'deal-opening-card')
        .map((step) => [step.side, step.handCardNumber]),
    ).toEqual([
      ['player', 1],
      ['banker', 1],
      ['player', 2],
      ['banker', 2],
    ])
    expect(
      plan.steps.find((step) => step.id === 'announce-initial-points')
        ?.announcement,
    ).toEqual({
      kind: 'initial-points',
      playerTotal: 9,
      bankerTotal: 7,
      natural: true,
    })
    expect(activeKind(plan)).toBe('announce-final-result')
  })

  it('does not disclose third-card decisions or point calls before four cards are exposed', () => {
    const plan = buildDealerProcedurePlan({
      round: { result: bothDrawResult(), revealedCount: 3 },
    })

    expect(kinds(plan)).not.toContain('deal-player-third-card')
    expect(kinds(plan)).not.toContain('deal-banker-third-card')
    expect(
      plan.steps.find((step) => step.id === 'announce-initial-points')
        ?.announcement,
    ).toBeUndefined()
    expect(
      plan.steps.find((step) => step.id === 'announce-final-result')
        ?.announcement,
    ).toBeUndefined()
    expect(activeKind(plan)).toBe('reveal-opening-hands')
    expect(
      plan.steps.find((step) => step.id === 'reveal-opening-hands')?.progress,
    ).toEqual({ completed: 3, total: 4 })
  })

  it('advances through Player then Banker when both hands draw', () => {
    const dealt = bothDrawResult()
    const playerDraw = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 4 },
    })
    const bankerDraw = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 5 },
    })
    const finalCall = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 6 },
    })

    expect(activeKind(playerDraw)).toBe('deal-player-third-card')
    expect(activeKind(bankerDraw)).toBe('deal-banker-third-card')
    expect(activeKind(finalCall)).toBe('announce-final-result')
    expect(
      finalCall.steps.find((step) => step.id === 'announce-final-result')
        ?.announcement,
    ).toEqual({
      kind: 'final-result',
      playerTotal: 9,
      bankerTotal: 8,
      winner: 'player',
    })
  })

  it('includes only the Player third-card action when Banker stands', () => {
    const dealt = result({
      player: [card('p1', '2'), card('p2', '3'), card('p3', '4')],
      banker: [card('b1', '4'), card('b2', '3')],
      winner: 'player',
      playerTotal: 9,
      bankerTotal: 7,
    })
    const beforeDraw = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 4 },
    })

    expect(kinds(beforeDraw)).toContain('deal-player-third-card')
    expect(kinds(beforeDraw)).not.toContain('deal-banker-third-card')
    expect(activeKind(beforeDraw)).toBe('deal-player-third-card')
    expect(
      activeKind(
        buildDealerProcedurePlan({
          round: { result: dealt, revealedCount: 5 },
        }),
      ),
    ).toBe('announce-final-result')
  })

  it('includes only the Banker third-card action when Player stands', () => {
    const dealt = result({
      player: [card('p1', '3'), card('p2', '3')],
      banker: [card('b1', '2'), card('b2', '2'), card('b3', '3')],
      winner: 'banker',
      playerTotal: 6,
      bankerTotal: 7,
    })
    const beforeDraw = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 4 },
    })

    expect(kinds(beforeDraw)).not.toContain('deal-player-third-card')
    expect(kinds(beforeDraw)).toContain('deal-banker-third-card')
    expect(activeKind(beforeDraw)).toBe('deal-banker-third-card')
    expect(
      activeKind(
        buildDealerProcedurePlan({
          round: { result: dealt, revealedCount: 5 },
        }),
      ),
    ).toBe('announce-final-result')
  })

  it('orders collection, payout, road recording, discard sweep, and the next round', () => {
    const expected: Array<
      [DealerProcedureSettlementState, DealerProcedureStepKind]
    > = [
      ['not-started', 'announce-final-result'],
      ['collecting-losing-wagers', 'collect-losing-wagers'],
      ['paying-winners', 'pay-winning-wagers'],
      ['recording-road', 'record-road'],
      ['discarding-cards', 'sweep-cards-to-discard-tray'],
      ['complete', 'open-next-round'],
    ]

    for (const [settlementState, expectedKind] of expected) {
      const plan = buildDealerProcedurePlan({
        round: { result: naturalResult(), revealedCount: 4 },
        settlementState,
      })
      expect(activeKind(plan)).toBe(expectedKind)
      expect(plan.steps.filter((step) => step.status === 'active')).toHaveLength(
        1,
      )
    }

    const complete = buildDealerProcedurePlan({
      round: { result: naturalResult(), revealedCount: 4 },
      settlementState: 'complete',
    })
    expect(
      complete.steps.find(
        (step) => step.kind === 'sweep-cards-to-discard-tray',
      )?.status,
    ).toBe('complete')
    expect(activeKind(complete)).toBe('open-next-round')
  })

  it('keeps reveal progress authoritative and remains deterministic without mutating the result', () => {
    const dealt = bothDrawResult()
    const snapshot = structuredClone(dealt)
    const input = {
      round: { result: dealt, revealedCount: 4.9 },
      settlementState: 'paying-winners' as const,
    }

    const first = buildDealerProcedurePlan(input)
    const second = buildDealerProcedurePlan(input)

    expect(first).toEqual(second)
    expect(first.revealedCount).toBe(4)
    expect(activeKind(first)).toBe('deal-player-third-card')
    expect(dealt).toEqual(snapshot)
  })
})
