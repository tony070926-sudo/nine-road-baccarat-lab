import { describe, expect, it } from 'vitest'
import type { Card, DealResult, Rank, Suit } from '../types'
import {
  buildDealerProcedurePlan,
  type DealerProcedurePlan,
  type DealerProcedureSettlementState,
  type DealerProcedureStepId,
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

function playerDrawsBankerStandsResult(): DealResult {
  return result({
    player: [card('p1', '2'), card('p2', '3'), card('p3', '4')],
    banker: [card('b1', '4'), card('b2', '3')],
    winner: 'player',
    playerTotal: 9,
    bankerTotal: 7,
  })
}

function playerStandsBankerDrawsResult(): DealResult {
  return result({
    player: [card('p1', '3'), card('p2', '3')],
    banker: [card('b1', '2'), card('b2', '2'), card('b3', '3')],
    winner: 'banker',
    playerTotal: 6,
    bankerTotal: 7,
  })
}

function kinds(plan: DealerProcedurePlan): DealerProcedureStepKind[] {
  return plan.steps.map((step) => step.kind)
}

function activeId(plan: DealerProcedurePlan): DealerProcedureStepId {
  const active = plan.steps.filter((step) => step.status === 'active')
  expect(active).toHaveLength(1)
  expect(active[0].id).toBe(plan.activeStepId)
  return active[0].id
}

describe('buildDealerProcedurePlan', () => {
  it('defaults to a conservative generic betting plan without a prepared round', () => {
    const plan = buildDealerProcedurePlan({ round: null })

    expect(activeId(plan)).toBe('place-bets')
    expect(plan.presentationPhase).toBe('betting')
    expect(plan.openingDealtCount).toBe(0)
    expect(plan.initialPointsAnnounced).toBe(false)
    expect(plan.revealedCount).toBe(0)
    expect(plan.revealComplete).toBe(false)
    expect(kinds(plan)).not.toContain('deal-player-third-card')
    expect(kinds(plan)).not.toContain('deal-banker-third-card')
    expect(
      plan.steps.find((step) => step.id === 'announce-initial-points')
        ?.announcement,
    ).toBeUndefined()
  })

  it('makes no-more-bets and every P/B/P/B opening card an explicit active step', () => {
    const dealt = naturalResult()
    expect(
      activeId(
        buildDealerProcedurePlan({
          round: { result: dealt, revealedCount: 0 },
          presentationPhase: 'no-more-bets',
        }),
      ),
    ).toBe('no-more-bets')

    const expectedOpeningIds: DealerProcedureStepId[] = [
      'deal-opening-player-1',
      'deal-opening-banker-1',
      'deal-opening-player-2',
      'deal-opening-banker-2',
    ]
    expectedOpeningIds.forEach((expectedId, openingDealtCount) => {
      const plan = buildDealerProcedurePlan({
        round: { result: dealt, revealedCount: 0 },
        presentationPhase: 'dealing',
        openingDealtCount,
      })
      expect(activeId(plan)).toBe(expectedId)
    })

    const openingComplete = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 0 },
      presentationPhase: 'dealing',
      openingDealtCount: 4,
    })
    expect(activeId(openingComplete)).toBe('reveal-opening-hands')
    expect(
      openingComplete.steps
        .filter((step) => step.kind === 'deal-opening-card')
        .map((step) => [step.id, step.side, step.handCardNumber]),
    ).toEqual([
      ['deal-opening-player-1', 'player', 1],
      ['deal-opening-banker-1', 'banker', 1],
      ['deal-opening-player-2', 'player', 2],
      ['deal-opening-banker-2', 'banker', 2],
    ])
  })

  it('keeps opening reveal active and withholds decisions and point calls before four cards are public', () => {
    const plan = buildDealerProcedurePlan({
      round: { result: bothDrawResult(), revealedCount: 3 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
    })

    expect(activeId(plan)).toBe('reveal-opening-hands')
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
    expect(
      plan.steps.find((step) => step.id === 'reveal-opening-hands')?.progress,
    ).toEqual({ completed: 3, total: 4 })
  })

  it('holds on the initial point call until presentation explicitly completes it', () => {
    const dealt = bothDrawResult()
    const pointCall = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 4 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
    })

    expect(activeId(pointCall)).toBe('announce-initial-points')
    expect(
      pointCall.steps.find((step) => step.id === 'announce-initial-points')
        ?.announcement,
    ).toEqual({
      kind: 'initial-points',
      playerTotal: 5,
      bankerTotal: 5,
      natural: false,
    })

    const afterPointCall = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 4 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
      initialPointsAnnounced: true,
    })
    expect(activeId(afterPointCall)).toBe('deal-player-third-card')
  })

  it('models a natural without inventing either third-card action', () => {
    const pointCall = buildDealerProcedurePlan({
      round: { result: naturalResult(), revealedCount: 4 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
    })
    const finalCall = buildDealerProcedurePlan({
      round: { result: naturalResult(), revealedCount: 4 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
      initialPointsAnnounced: true,
    })

    expect(activeId(pointCall)).toBe('announce-initial-points')
    expect(kinds(finalCall)).not.toContain('deal-player-third-card')
    expect(kinds(finalCall)).not.toContain('deal-banker-third-card')
    expect(activeId(finalCall)).toBe('announce-final-result')
    expect(
      finalCall.steps.find((step) => step.id === 'announce-final-result')
        ?.announcement,
    ).toEqual({
      kind: 'final-result',
      playerTotal: 9,
      bankerTotal: 7,
      winner: 'player',
    })
  })

  it('does not expose the Banker decision until the Player third card is public', () => {
    const dealt = bothDrawResult()
    const beforePlayerThird = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 4 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
      initialPointsAnnounced: true,
    })
    const afterPlayerThird = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 5 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
      initialPointsAnnounced: true,
    })
    const finalCall = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 6 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
      initialPointsAnnounced: true,
    })

    expect(activeId(beforePlayerThird)).toBe('deal-player-third-card')
    expect(kinds(beforePlayerThird)).not.toContain('deal-banker-third-card')
    expect(kinds(afterPlayerThird)).toContain('deal-banker-third-card')
    expect(activeId(afterPlayerThird)).toBe('deal-banker-third-card')
    expect(activeId(finalCall)).toBe('announce-final-result')
  })

  it('reveals a Banker stand only after the Player third card and omits the false action', () => {
    const dealt = playerDrawsBankerStandsResult()
    const beforePlayerThird = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 4 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
      initialPointsAnnounced: true,
    })
    const afterPlayerThird = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 5 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
      initialPointsAnnounced: true,
    })

    expect(activeId(beforePlayerThird)).toBe('deal-player-third-card')
    expect(kinds(beforePlayerThird)).not.toContain('deal-banker-third-card')
    expect(kinds(afterPlayerThird)).not.toContain('deal-banker-third-card')
    expect(activeId(afterPlayerThird)).toBe('announce-final-result')
  })

  it('can disclose the Banker draw from opening totals when Player stands', () => {
    const dealt = playerStandsBankerDrawsResult()
    const beforeBankerThird = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 4 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
      initialPointsAnnounced: true,
    })
    const finalCall = buildDealerProcedurePlan({
      round: { result: dealt, revealedCount: 5 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
      initialPointsAnnounced: true,
    })

    expect(kinds(beforeBankerThird)).not.toContain('deal-player-third-card')
    expect(kinds(beforeBankerThird)).toContain('deal-banker-third-card')
    expect(activeId(beforeBankerThird)).toBe('deal-banker-third-card')
    expect(activeId(finalCall)).toBe('announce-final-result')
  })

  it('orders collection, payout, road recording, discard sweep, and the next round', () => {
    const expected: Array<
      [DealerProcedureSettlementState, DealerProcedureStepKind]
    > = [
      ['not-started', 'announce-final-result'],
      ['collecting-losing-wagers', 'collect-losing-wagers'],
      ['returning-pushed-wagers', 'return-pushed-wagers'],
      ['paying-winners', 'pay-winning-wagers'],
      ['recording-road', 'record-road'],
      ['discarding-cards', 'sweep-cards-to-discard-tray'],
      ['complete', 'open-next-round'],
    ]

    for (const [settlementState, expectedKind] of expected) {
      const plan = buildDealerProcedurePlan({
        round: { result: naturalResult(), revealedCount: 4 },
        presentationPhase: 'settling',
        openingDealtCount: 4,
        initialPointsAnnounced: true,
        settlementState,
        settlementActions: ['collect', 'push', 'pay'],
      })
      expect(
        plan.steps.find((step) => step.status === 'active')?.kind,
      ).toBe(expectedKind)
      expect(plan.steps.filter((step) => step.status === 'active')).toHaveLength(
        1,
      )
    }

    const complete = buildDealerProcedurePlan({
      round: { result: naturalResult(), revealedCount: 4 },
      presentationPhase: 'settling',
      settlementState: 'complete',
    })
    expect(
      complete.steps.find(
        (step) => step.kind === 'sweep-cards-to-discard-tray',
      )?.status,
    ).toBe('complete')
    expect(activeId(complete)).toBe('open-next-round')
  })

  it('omits wager actions that the settled round did not perform', () => {
    const fly = buildDealerProcedurePlan({
      round: { result: naturalResult(), revealedCount: 4 },
      presentationPhase: 'settling',
      initialPointsAnnounced: true,
      settlementState: 'recording-road',
      settlementActions: [],
    })
    expect(kinds(fly)).not.toContain('collect-losing-wagers')
    expect(kinds(fly)).not.toContain('return-pushed-wagers')
    expect(kinds(fly)).not.toContain('pay-winning-wagers')
    expect(activeId(fly)).toBe('record-road')

    const pushOnly = buildDealerProcedurePlan({
      round: { result: naturalResult(), revealedCount: 4 },
      presentationPhase: 'settling',
      initialPointsAnnounced: true,
      settlementState: 'not-started',
      settlementActions: ['push'],
    })
    expect(kinds(pushOnly)).not.toContain('collect-losing-wagers')
    expect(kinds(pushOnly)).toContain('return-pushed-wagers')
    expect(kinds(pushOnly)).not.toContain('pay-winning-wagers')
    expect(activeId(pushOnly)).toBe('announce-final-result')
  })

  it('refuses to advance into settlement while cards remain hidden', () => {
    const plan = buildDealerProcedurePlan({
      round: { result: bothDrawResult(), revealedCount: 4 },
      presentationPhase: 'settling',
      openingDealtCount: 4,
      initialPointsAnnounced: true,
      settlementState: 'paying-winners',
    })

    expect(activeId(plan)).toBe('deal-player-third-card')
    expect(kinds(plan)).not.toContain('deal-banker-third-card')
  })

  it('sanitizes progress, remains deterministic, and never mutates the result', () => {
    const dealt = bothDrawResult()
    const snapshot = structuredClone(dealt)
    const input = {
      round: { result: dealt, revealedCount: 4.9 },
      presentationPhase: 'revealing' as const,
      openingDealtCount: Number.POSITIVE_INFINITY,
      initialPointsAnnounced: true,
    }

    const first = buildDealerProcedurePlan(input)
    const second = buildDealerProcedurePlan(input)

    expect(first).toEqual(second)
    expect(first.revealedCount).toBe(4)
    expect(first.openingDealtCount).toBe(4)
    expect(activeId(first)).toBe('deal-player-third-card')
    expect(dealt).toEqual(snapshot)
  })
})
