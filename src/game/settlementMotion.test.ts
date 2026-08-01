import { describe, expect, it } from 'vitest'
import {
  DEALER_SETTLEMENT_PRELUDE_MS,
  DEALER_SETTLEMENT_STEP_MS,
  dealerSettlementContactDelay,
  dealerSettlementDuration,
  dealerSettlementSteps,
  type DealerSettlementMotion,
} from './settlementMotion'

function motion(
  overrides: Partial<DealerSettlementMotion> = {},
): DealerSettlementMotion {
  return {
    id: 'round-1',
    net: 0,
    bets: {
      player: 100,
      banker: 0,
      tie: 50,
      playerPair: 25,
      bankerPair: 0,
    },
    returns: {
      player: 100,
      tie: 450,
      playerPair: 0,
    },
    ...overrides,
  }
}

describe('dealerSettlementSteps', () => {
  it('collects losing wagers before pushes and payouts', () => {
    expect(dealerSettlementSteps(motion())).toEqual([
      {
        target: 'playerPair',
        kind: 'collect',
        amount: 25,
        returned: 0,
        commission: 0,
      },
      {
        target: 'player',
        kind: 'push',
        amount: 100,
        returned: 100,
        commission: 0,
      },
      {
        target: 'tie',
        kind: 'pay',
        amount: 50,
        returned: 450,
        commission: 0,
      },
    ])
  })

  it('aligns each chip sound with its visual contact keyframe', () => {
    expect(dealerSettlementContactDelay('collect')).toBe(205)
    expect(dealerSettlementContactDelay('push')).toBe(640)
    expect(dealerSettlementContactDelay('pay')).toBe(541)
    expect(dealerSettlementContactDelay('pay', true)).toBe(0)
  })

  it('exposes the withheld five-percent Banker commission as visual metadata', () => {
    expect(
      dealerSettlementSteps(
        motion({
          bets: {
            player: 0,
            banker: 100,
            tie: 0,
            playerPair: 0,
            bankerPair: 0,
          },
          returns: { banker: 195 },
        }),
      ),
    ).toEqual([
      {
        target: 'banker',
        kind: 'pay',
        amount: 100,
        returned: 195,
        commission: 5,
      },
    ])
  })

  it('uses one animation slot per active area', () => {
    expect(dealerSettlementDuration(motion())).toBe(
      DEALER_SETTLEMENT_PRELUDE_MS + DEALER_SETTLEMENT_STEP_MS * 3,
    )
    expect(
      dealerSettlementDuration(
        motion({
          bets: {
            player: 0,
            banker: 0,
            tie: 0,
            playerPair: 0,
            bankerPair: 0,
          },
          returns: {},
        }),
      ),
    ).toBe(DEALER_SETTLEMENT_PRELUDE_MS + DEALER_SETTLEMENT_STEP_MS)
  })
})
