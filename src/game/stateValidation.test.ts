import { describe, expect, it } from 'vitest'
import type {
  Bets,
  PersistedGameState,
  PersistedPendingRound,
  RoundRecord,
  Settlement,
  ShoeState,
} from '../types'
import {
  EMPTY_BETS,
  RULESET_VERSION,
  createSeededRandomInt,
  createShoe,
  dealRound,
  settleBets,
} from './baccarat'
import {
  isPersistedGameState,
  isPersistedPendingRound,
} from './stateValidation'

function makeRecord(
  shoeBefore: ShoeState,
  balanceBefore: number,
  bets: Bets,
  id: string,
  timestamp = `2026-07-30T00:00:0${shoeBefore.handNumber + 1}.000Z`,
): { record: RoundRecord; shoe: ShoeState } {
  const dealt = dealRound(shoeBefore)
  const settlement = settleBets(bets, dealt.result)
  const balanceAfter =
    balanceBefore - settlement.totalStake + settlement.totalReturned

  return {
    shoe: dealt.shoe,
    record: {
      ...dealt.result,
      id,
      shoeId: dealt.shoe.id,
      handNumber: dealt.shoe.handNumber,
      timestamp,
      playMode: 'bet',
      bets: { ...bets },
      settlement,
      balanceBefore,
      balanceAfter,
      cardsRemaining: dealt.shoe.cards.length - dealt.shoe.cursor,
      rulesetVersion: RULESET_VERSION,
      shuffleVersion: dealt.shoe.shuffleVersion,
    },
  }
}

function makeValidGame(): PersistedGameState {
  const firstShoe = createShoe(createSeededRandomInt(31), 'S-VALID')
  const first = makeRecord(
    firstShoe,
    10_000,
    { ...EMPTY_BETS, player: 100 },
    'round-1',
  )
  const second = makeRecord(
    first.shoe,
    first.record.balanceAfter,
    { ...EMPTY_BETS, banker: 200 },
    'round-2',
  )

  return {
    version: 1,
    balance: second.record.balanceAfter,
    shoe: second.shoe,
    history: [first.record, second.record],
    lastBets: { ...second.record.bets },
    sessionStartedAt: '2026-07-30T00:00:00.000Z',
  }
}

function makeValidPending(seed = 73): PersistedPendingRound {
  const sourceShoe = createShoe(
    createSeededRandomInt(seed),
    `S-PENDING-${seed}`,
  )
  const dealt = dealRound(sourceShoe)
  return {
    version: 1,
    id: 'pending-1',
    playMode: 'bet',
    bets: { ...EMPTY_BETS, player: 100 },
    balanceBefore: 10_000,
    sourceShoeId: sourceShoe.id,
    sourceCursor: sourceShoe.cursor,
    shoeAfter: dealt.shoe,
    result: dealt.result,
    revealedCount: 0,
  }
}

describe('isPersistedGameState', () => {
  it('accepts a structurally and mathematically valid v1 state', () => {
    expect(isPersistedGameState(makeValidGame())).toBe(true)
  })

  it('accepts legacy settlements without commissionCharged', () => {
    const state = structuredClone(makeValidGame())
    delete (state.history[0].settlement as Partial<Settlement>)
      .commissionCharged

    expect(isPersistedGameState(state)).toBe(true)
  })

  it('accepts a legacy record without an explicit playMode', () => {
    const state = structuredClone(makeValidGame())
    delete state.history[0].playMode

    expect(isPersistedGameState(state)).toBe(true)
  })

  it('rejects a shallow shoe object', () => {
    const state = {
      ...makeValidGame(),
      shoe: {},
    }

    expect(isPersistedGameState(state)).toBe(false)
  })

  it('rejects a shoe containing a duplicate physical card', () => {
    const state = structuredClone(makeValidGame())
    state.shoe.cards[1] = { ...state.shoe.cards[0] }

    expect(isPersistedGameState(state)).toBe(false)
  })

  it('rejects a tampered round result', () => {
    const state = structuredClone(makeValidGame())
    state.history[0].winner =
      state.history[0].winner === 'tie' ? 'player' : 'tie'

    expect(isPersistedGameState(state)).toBe(false)
  })

  it('rejects a settlement that no longer matches the bets and result', () => {
    const state = structuredClone(makeValidGame())
    state.history[0].settlement.net += 10

    expect(isPersistedGameState(state)).toBe(false)
  })

  it('rejects records from an unknown ruleset instead of applying current rules', () => {
    const state = structuredClone(makeValidGame())
    state.history[0].rulesetVersion = 'future-rules-v2'

    expect(isPersistedGameState(state)).toBe(false)
  })

  it('rejects a broken balance chain even when each round still balances', () => {
    const state = structuredClone(makeValidGame())
    state.history[1].balanceBefore += 10
    state.history[1].balanceAfter += 10
    state.balance += 10

    expect(isPersistedGameState(state)).toBe(false)
  })

  it('accepts a compacted 500-round history across multiple shoes', () => {
    const bets = { ...EMPTY_BETS, player: 10 }
    const history: RoundRecord[] = []
    let balance = 10_000
    let shoe = createShoe(createSeededRandomInt(500), 'S-HISTORY-0')
    let shoeIndex = 0

    for (let index = 0; index < 500; index += 1) {
      if (shoe.needsShuffle) {
        shoeIndex += 1
        shoe = createShoe(
          createSeededRandomInt(500 + shoeIndex),
          `S-HISTORY-${shoeIndex}`,
        )
      }
      const next = makeRecord(
        shoe,
        balance,
        bets,
        `history-round-${index}`,
        new Date(Date.UTC(2026, 6, 30) + index * 1_000).toISOString(),
      )
      history.push(next.record)
      balance = next.record.balanceAfter
      shoe = next.shoe
    }

    expect(
      isPersistedGameState({
        version: 1,
        balance,
        shoe,
        history,
        lastBets: bets,
        sessionStartedAt: '2026-07-30T00:00:00.000Z',
      }),
    ).toBe(true)
  })
})

describe('isPersistedPendingRound', () => {
  it('accepts a valid persisted pending round', () => {
    expect(isPersistedPendingRound(makeValidPending())).toBe(true)
  })

  it('rejects a one-billion-point pending wager', () => {
    const pending = structuredClone(makeValidPending())
    pending.bets = { ...EMPTY_BETS, tie: 1_000_000_000 }

    expect(isPersistedPendingRound(pending)).toBe(false)
  })

  it('rejects a pending result that does not match the shoe slice', () => {
    const pending = structuredClone(makeValidPending())
    pending.result.winner =
      pending.result.winner === 'tie' ? 'banker' : 'tie'

    expect(isPersistedPendingRound(pending)).toBe(false)
  })

  it('rejects an incomplete draw result without throwing', () => {
    let pending: PersistedPendingRound | undefined
    for (let seed = 1; seed <= 100; seed += 1) {
      const candidate = makeValidPending(seed)
      if (candidate.result.playerCards.length === 3) {
        pending = structuredClone(candidate)
        break
      }
    }
    expect(pending).toBeDefined()
    if (!pending) throw new Error('expected a deterministic Player-draw seed')

    const thirdPlayerCard = pending.result.playerCards[2]
    expect(thirdPlayerCard).toBeDefined()
    if (!thirdPlayerCard) throw new Error('expected a Player third card')

    pending.result.playerCards.pop()
    pending.result.dealOrder = pending.result.dealOrder.filter(
      (card) => card.id !== thirdPlayerCard.id,
    )
    pending.result.cardsUsed = pending.result.dealOrder.length
    pending.shoeAfter.cursor -= 1

    expect(() => isPersistedPendingRound(pending)).not.toThrow()
    expect(isPersistedPendingRound(pending)).toBe(false)
  })
})
