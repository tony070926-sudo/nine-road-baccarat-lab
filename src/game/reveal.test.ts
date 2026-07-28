import { describe, expect, it } from 'vitest'
import type {
  Card,
  DealResult,
  PersistedGameState,
  PersistedPendingRound,
  ShoeState,
} from '../types'
import {
  manualRevealSides,
  nextRevealCard,
  pendingRoundMatchesGame,
  revealIsComplete,
  revealSideForCard,
  revealedCards,
  visibleRevealCardIds,
} from './reveal'

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

function shoe(
  cards: Card[],
  cursor: number,
  handNumber: number,
): ShoeState {
  return {
    id: 'shoe-1',
    cards,
    cursor,
    cutAtRemaining: 14,
    burnCard: card('burn'),
    burnedCards: 0,
    handNumber,
    shuffleVersion: 'test',
    needsShuffle: false,
  }
}

describe('manual reveal sequencing', () => {
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
    ).toEqual(['banker'])
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
    ).toEqual(['player', 'banker'])
  })

  it('treats tie as two-sided and no-bet fly rounds as fully automatic', () => {
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
    ).toEqual(['player', 'banker'])
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

    expect(visibleRevealCardIds(sixCardRound, 0)).toEqual(['p1', 'b1', 'p2', 'b2'])
    expect(visibleRevealCardIds(sixCardRound, 3)).toEqual(['p1', 'b1', 'p2', 'b2'])
    expect(visibleRevealCardIds(sixCardRound, 4)).toEqual([
      'p1',
      'b1',
      'p2',
      'b2',
      'p3',
    ])
    expect(visibleRevealCardIds(sixCardRound, 5)).toEqual([
      'p1',
      'b1',
      'p2',
      'b2',
      'p3',
      'b3',
    ])
  })

  it('reveals strictly in the locked deal order', () => {
    const fiveCardRound = result(['p1', 'b1', 'p2', 'b2', 'p3'])

    expect(nextRevealCard(fiveCardRound, 0)?.id).toBe('p1')
    expect(nextRevealCard(fiveCardRound, 4)?.id).toBe('p3')
    expect(nextRevealCard(fiveCardRound, 5)).toBeNull()
    expect(revealedCards(fiveCardRound, 3).map((item) => item.id)).toEqual([
      'p1',
      'b1',
      'p2',
    ])
  })

  it('only completes when every locked card has been revealed', () => {
    const fourCardRound = result(['p1', 'b1', 'p2', 'b2'])

    expect(revealIsComplete(fourCardRound, 3)).toBe(false)
    expect(revealIsComplete(fourCardRound, 4)).toBe(true)
  })

  it('only restores a pending round against its original unadvanced shoe', () => {
    const lockedResult = result(['p1', 'b1', 'p2', 'b2', 'p3', 'b3'])
    const sourceShoe = shoe(lockedResult.dealOrder, 0, 0)
    const game: PersistedGameState = {
      version: 1,
      balance: 10_000,
      shoe: sourceShoe,
      history: [],
      lastBets: {
        player: 0,
        banker: 0,
        tie: 0,
        playerPair: 0,
        bankerPair: 0,
      },
      sessionStartedAt: '2026-07-27T00:00:00.000Z',
    }
    const pending: PersistedPendingRound = {
      version: 1,
      id: 'round-1',
      playMode: 'bet',
      bets: {
        player: 100,
        banker: 0,
        tie: 0,
        playerPair: 0,
        bankerPair: 0,
      },
      balanceBefore: 10_000,
      sourceShoeId: sourceShoe.id,
      sourceCursor: 0,
      shoeAfter: shoe(lockedResult.dealOrder, 6, 1),
      result: lockedResult,
      revealedCount: 3,
    }

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
        revealedCount: lockedResult.dealOrder.length,
      }),
    ).toBe(false)
    expect(
      pendingRoundMatchesGame(game, {
        ...pending,
        playMode: 'fly',
      }),
    ).toBe(false)
  })

  it('rejects malformed persisted data without throwing', () => {
    const lockedResult = result(['p1', 'b1', 'p2', 'b2'])
    const game: PersistedGameState = {
      version: 1,
      balance: 10_000,
      shoe: shoe(lockedResult.dealOrder, 0, 0),
      history: [],
      lastBets: {
        player: 0,
        banker: 0,
        tie: 0,
        playerPair: 0,
        bankerPair: 0,
      },
      sessionStartedAt: '2026-07-27T00:00:00.000Z',
    }
    const malformed = {
      version: 1,
      bets: null,
      result: lockedResult,
    } as unknown as PersistedPendingRound

    expect(() => pendingRoundMatchesGame(game, malformed)).not.toThrow()
    expect(pendingRoundMatchesGame(game, malformed)).toBe(false)
  })
})
