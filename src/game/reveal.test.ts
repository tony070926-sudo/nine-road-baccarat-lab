import { describe, expect, it } from 'vitest'
import type {
  Card,
  DealResult,
  PersistedGameState,
  PersistedPendingRound,
} from '../types'
import {
  EMPTY_BETS,
  createSeededRandomInt,
  createShoe,
  dealRound,
} from './baccarat'
import {
  manualRevealSides,
  nextRevealCard,
  openingDealCardIds,
  restoredDealtCardIds,
  resolveRevealControl,
  revealOrder,
  revealIsComplete,
  revealSideForCard,
  revealedCards,
  visibleRevealCardIds,
} from './reveal'
import {
  pendingRoundMatchesGame,
  pendingRoundsMatch,
} from './roundIntegrity'

function card(id: string): Card {
  return { id, rank: 'A', suit: 'spades', deck: 1 }
}

function result(cardIds: string[]): DealResult {
  const cards = cardIds.map(card)
  return {
    playerCards: cards.filter((_, index) => index % 2 === 0),
    bankerCards: cards.filter((_, index) => index % 2 === 1),
    dealOrder: cards,
    playerTotal: 0,
    bankerTotal: 0,
    winner: 'tie',
    natural: false,
    playerPair: false,
    bankerPair: false,
    cardsUsed: cards.length,
  }
}

function pendingFixture(seed = 41): {
  game: PersistedGameState
  pending: PersistedPendingRound
} {
  const sourceShoe = createShoe(
    createSeededRandomInt(seed),
    'S-PENDING-RESTORE',
  )
  const dealt = dealRound(sourceShoe)
  const game: PersistedGameState = {
    version: 1,
    balance: 10_000,
    shoe: sourceShoe,
    history: [],
    lastBets: { ...EMPTY_BETS },
    sessionStartedAt: '2026-07-27T00:00:00.000Z',
  }
  const pending: PersistedPendingRound = {
    version: 1,
    id: 'round-1',
    playMode: 'bet',
    revealControl: 'player-squeeze',
    bets: { ...EMPTY_BETS, player: 100 },
    balanceBefore: 10_000,
    sourceShoeId: sourceShoe.id,
    sourceCursor: sourceShoe.cursor,
    shoeAfter: dealt.shoe,
    result: dealt.result,
    revealedCount: Math.min(3, dealt.result.cardsUsed - 1),
  }

  return { game, pending }
}

describe('manual reveal sequencing', () => {
  it('resolves legacy reveal control without coupling it to play mode', () => {
    expect(resolveRevealControl({ playMode: 'bet' })).toBe('player-squeeze')
    expect(resolveRevealControl({ playMode: 'fly' })).toBe('dealer-reveal')
    expect(
      resolveRevealControl({
        playMode: 'bet',
        revealControl: 'dealer-reveal',
      }),
    ).toBe('dealer-reveal')
  })

  it('maps wagers to only the sides the player should manually reveal', () => {
    expect(
      manualRevealSides(
        {
          player: 100,
          banker: 0,
          tie: 0,
          playerPair: 0,
          bankerPair: 0,
        },
        'bet',
      ),
    ).toEqual(['player'])
    expect(
      manualRevealSides(
        {
          player: 0,
          banker: 0,
          tie: 0,
          playerPair: 0,
          bankerPair: 100,
        },
        'bet',
      ),
    ).toEqual([])
    expect(
      manualRevealSides(
        {
          player: 100,
          banker: 0,
          tie: 0,
          playerPair: 0,
          bankerPair: 100,
        },
        'bet',
      ),
    ).toEqual(['player'])
  })

  it('leaves tie, pair-only, and no-bet fly rounds to the dealer', () => {
    expect(
      manualRevealSides(
        {
          player: 0,
          banker: 0,
          tie: 100,
          playerPair: 0,
          bankerPair: 0,
        },
        'bet',
      ),
    ).toEqual([])
    expect(
      manualRevealSides(
        {
          player: 0,
          banker: 0,
          tie: 0,
          playerPair: 0,
          bankerPair: 0,
        },
        'fly',
      ),
    ).toEqual([])
  })

  it('leaves every wagered hand to the dealer when explicitly selected', () => {
    expect(
      manualRevealSides(
        {
          player: 100,
          banker: 0,
          tie: 0,
          playerPair: 0,
          bankerPair: 0,
        },
        'bet',
        'dealer-reveal',
      ),
    ).toEqual([])
  })

  it('identifies the owner of each card in the locked deal order', () => {
    const fourCardRound = result(['p1', 'b1', 'p2', 'b2'])
    const bankerOnlyThirdRound = result(['p1', 'b1', 'p2', 'b2', 'b3'])
    bankerOnlyThirdRound.playerCards = [
      bankerOnlyThirdRound.dealOrder[0],
      bankerOnlyThirdRound.dealOrder[2],
    ]
    bankerOnlyThirdRound.bankerCards = [
      bankerOnlyThirdRound.dealOrder[1],
      bankerOnlyThirdRound.dealOrder[3],
      bankerOnlyThirdRound.dealOrder[4],
    ]

    expect(revealSideForCard(fourCardRound, 'p1')).toBe('player')
    expect(revealSideForCard(fourCardRound, 'b2')).toBe('banker')
    expect(revealSideForCard(bankerOnlyThirdRound, 'b3')).toBe('banker')
    expect(revealSideForCard(fourCardRound, 'missing')).toBeNull()
  })

  it('keeps third cards hidden until all four opening cards are revealed', () => {
    const sixCardRound = result(['p1', 'b1', 'p2', 'b2', 'p3', 'b3'])

    expect(visibleRevealCardIds(sixCardRound, 0)).toEqual(['p1', 'p2', 'b1', 'b2'])
    expect(visibleRevealCardIds(sixCardRound, 3)).toEqual(['p1', 'p2', 'b1', 'b2'])
    expect(visibleRevealCardIds(sixCardRound, 4)).toEqual([
      'p1',
      'p2',
      'b1',
      'b2',
      'p3',
    ])
    expect(visibleRevealCardIds(sixCardRound, 5)).toEqual([
      'p1',
      'p2',
      'b1',
      'b2',
      'p3',
      'b3',
    ])
  })

  it('keeps physical deal order separate from Player-first reveal order', () => {
    const fiveCardRound = result(['p1', 'b1', 'p2', 'b2', 'p3'])

    expect(openingDealCardIds(fiveCardRound)).toEqual([
      'p1',
      'b1',
      'p2',
      'b2',
    ])
    expect(revealOrder(fiveCardRound).map((item) => item.id)).toEqual([
      'p1',
      'p2',
      'b1',
      'b2',
      'p3',
    ])
    expect(nextRevealCard(fiveCardRound, 0)?.id).toBe('p1')
    expect(nextRevealCard(fiveCardRound, 4)?.id).toBe('p3')
    expect(nextRevealCard(fiveCardRound, 5)).toBeNull()
    expect(revealedCards(fiveCardRound, 3).map((item) => item.id)).toEqual([
      'p1',
      'p2',
      'b1',
    ])
  })

  it('restores only third cards whose reveal was durably recorded', () => {
    const sixCardRound = result(['p1', 'b1', 'p2', 'b2', 'p3', 'b3'])

    expect(restoredDealtCardIds(sixCardRound, 0)).toEqual([])
    expect(restoredDealtCardIds(sixCardRound, 1)).toEqual([
      'p1',
      'b1',
      'p2',
      'b2',
    ])
    expect(restoredDealtCardIds(sixCardRound, 4)).toEqual([
      'p1',
      'b1',
      'p2',
      'b2',
    ])
    expect(restoredDealtCardIds(sixCardRound, 5)).toEqual([
      'p1',
      'b1',
      'p2',
      'b2',
      'p3',
    ])
    expect(restoredDealtCardIds(sixCardRound, 6)).toEqual([
      'p1',
      'b1',
      'p2',
      'b2',
      'p3',
      'b3',
    ])
  })

  it('only completes when every locked card has been revealed', () => {
    const fourCardRound = result(['p1', 'b1', 'p2', 'b2'])

    expect(revealIsComplete(fourCardRound, 3)).toBe(false)
    expect(revealIsComplete(fourCardRound, 4)).toBe(true)
  })

  it('only restores a pending round against its original unadvanced shoe', () => {
    const { game, pending } = pendingFixture()

    expect(pendingRoundMatchesGame(game, pending)).toBe(true)
    expect(
      pendingRoundMatchesGame(
        { ...game, shoe: { ...game.shoe, cursor: 1 } },
        pending,
      ),
    ).toBe(false)
    expect(
      pendingRoundMatchesGame(game, {
        ...pending,
        revealedCount: pending.result.dealOrder.length + 1,
      }),
    ).toBe(false)
    expect(
      pendingRoundMatchesGame(game, {
        ...pending,
        revealedCount: pending.result.dealOrder.length,
      }),
    ).toBe(true)
    expect(
      pendingRoundMatchesGame(game, {
        ...pending,
        playMode: 'fly',
      }),
    ).toBe(false)
  })

  it('rejects an internally valid deal generated from a substituted shoe', () => {
    const { game, pending } = pendingFixture()
    let substitutedShoe = createShoe(
      createSeededRandomInt(42),
      game.shoe.id,
    )
    for (let seed = 43; substitutedShoe.cursor !== game.shoe.cursor; seed += 1) {
      substitutedShoe = createShoe(
        createSeededRandomInt(seed),
        game.shoe.id,
      )
    }
    const substitutedDeal = dealRound(substitutedShoe)
    const substitutedPending: PersistedPendingRound = {
      ...pending,
      sourceCursor: substitutedShoe.cursor,
      shoeAfter: substitutedDeal.shoe,
      result: substitutedDeal.result,
      revealedCount: 0,
    }

    expect(pendingRoundMatchesGame(game, substitutedPending)).toBe(false)
  })

  it('detects any change to the durable journal payload', () => {
    const { pending } = pendingFixture()

    expect(pendingRoundsMatch(pending, structuredClone(pending))).toBe(true)
    expect(
      pendingRoundsMatch(pending, {
        ...structuredClone(pending),
        bets: { ...pending.bets, player: 200 },
      }),
    ).toBe(false)
    expect(
      pendingRoundsMatch(pending, {
        ...structuredClone(pending),
        revealControl: 'dealer-reveal',
      }),
    ).toBe(false)
  })

  it('rejects an over-limit wager and a tampered outcome', () => {
    const { game, pending } = pendingFixture()
    const overLimit = {
      ...pending,
      bets: { ...EMPTY_BETS, tie: 1_000_000_000 },
    }
    const tamperedOutcome = structuredClone(pending)
    tamperedOutcome.result.winner =
      tamperedOutcome.result.winner === 'tie' ? 'player' : 'tie'

    expect(pendingRoundMatchesGame(game, overLimit)).toBe(false)
    expect(pendingRoundMatchesGame(game, tamperedOutcome)).toBe(false)
  })

  it('rejects malformed persisted data without throwing', () => {
    const { game, pending } = pendingFixture()
    const malformed = {
      version: 1,
      bets: null,
      result: pending.result,
    } as unknown as PersistedPendingRound

    expect(() => pendingRoundMatchesGame(game, malformed)).not.toThrow()
    expect(pendingRoundMatchesGame(game, malformed)).toBe(false)
  })
})
