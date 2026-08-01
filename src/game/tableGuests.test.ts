import { describe, expect, it } from 'vitest'
import type { Card, Rank } from '../types'
import {
  buildTableGuestRevealReactions,
  buildTableGuestSettlementReactions,
  createTableGuests,
  createShoeTableGuests,
  type PublicTableCardReveal,
  type TableGuest,
  type TableGuestBetTarget,
} from './tableGuests'

function card(rank: Rank, id: string): Card {
  return { id, rank, suit: 'spades', deck: 1 }
}

function guest(id: string, target: TableGuestBetTarget): TableGuest {
  return {
    id,
    name: id,
    seat:
      id === 'player'
        ? 'far-left'
        : id === 'banker'
          ? 'left'
          : id === 'tie'
            ? 'right'
            : 'far-right',
    tendency: 'cautious',
    intent: {
      target,
      message: `${target} intent`,
    },
  }
}

const PUBLIC_REVEALS: PublicTableCardReveal[] = [
  { side: 'player', card: card('2', 'p1') },
  { side: 'banker', card: card('3', 'b1') },
  { side: 'player', card: card('6', 'p2') },
  { side: 'banker', card: card('4', 'b2') },
  { side: 'player', card: card('A', 'p3') },
  { side: 'banker', card: card('5', 'b3') },
]

describe('stable virtual table guests', () => {
  it('creates a stable roster of three or four unique guests', () => {
    const first = createTableGuests({
      shoeId: 'shoe-alpha',
      handNumber: 8,
    })
    const repeated = createTableGuests({
      shoeId: 'shoe-alpha',
      handNumber: 8,
    })

    expect(repeated).toEqual(first)
    expect(first.length === 3 || first.length === 4).toBe(true)
    expect(new Set(first.map((item) => item.id))).toHaveProperty(
      'size',
      first.length,
    )
    expect(new Set(first.map((item) => item.name))).toHaveProperty(
      'size',
      first.length,
    )
    expect(new Set(first.map((item) => item.seat))).toHaveProperty(
      'size',
      first.length,
    )
    expect(new Set(first.map((item) => item.intent.message))).toHaveProperty(
      'size',
      first.length,
    )
  })

  it('lets callers request three or four guests and changes seed by shoe or hand', () => {
    const three = createTableGuests({
      shoeId: 'shoe-alpha',
      handNumber: 8,
      count: 3,
    })
    const four = createTableGuests({
      shoeId: 'shoe-alpha',
      handNumber: 8,
      count: 4,
    })
    const nextHand = createTableGuests({
      shoeId: 'shoe-alpha',
      handNumber: 9,
      count: 3,
    })
    const nextShoe = createTableGuests({
      shoeId: 'shoe-beta',
      handNumber: 8,
      count: 3,
    })

    expect(three).toHaveLength(3)
    expect(four).toHaveLength(4)
    expect(nextHand).not.toEqual(three)
    expect(nextShoe).not.toEqual(three)
  })

  it('keeps the same people and seats at the table for the whole shoe', () => {
    const firstHand = createShoeTableGuests({
      shoeId: 'shoe-alpha',
      handNumber: 8,
    })
    const nextHand = createShoeTableGuests({
      shoeId: 'shoe-alpha',
      handNumber: 9,
    })

    expect(
      nextHand.map(({ id, name, seat, tendency }) => ({
        id,
        name,
        seat,
        tendency,
      })),
    ).toEqual(
      firstHand.map(({ id, name, seat, tendency }) => ({
        id,
        name,
        seat,
        tendency,
      })),
    )
  })
})

describe('public-card guest reactions', () => {
  const guests = createTableGuests({
    shoeId: 'shoe-alpha',
    handNumber: 8,
    count: 4,
  })

  it('is deterministic, quiet, non-repeating, and never declares a result', () => {
    const first = buildTableGuestRevealReactions({
      shoeId: 'shoe-alpha',
      handNumber: 8,
      guests,
      publicReveals: PUBLIC_REVEALS,
    })
    const repeated = buildTableGuestRevealReactions({
      shoeId: 'shoe-alpha',
      handNumber: 8,
      guests,
      publicReveals: PUBLIC_REVEALS,
    })

    expect(repeated).toEqual(first)
    expect(first.length).toBeGreaterThan(0)
    expect(first.length).toBeLessThanOrEqual(2)
    expect(new Set(first.map((reaction) => reaction.message))).toHaveProperty(
      'size',
      first.length,
    )
    expect(new Set(first.map((reaction) => reaction.guestId))).toHaveProperty(
      'size',
      first.length,
    )
    expect(first.map((reaction) => reaction.message).join('')).not.toMatch(
      /庄胜|闲胜|赢了|输了|必中|稳赢|下一局|追/,
    )
  })

  it('keeps earlier reactions unchanged when unseen future cards differ', () => {
    const publicPrefix = PUBLIC_REVEALS.slice(0, 4)
    const futureA = [
      ...publicPrefix,
      { side: 'player' as const, card: card('A', 'future-a') },
    ]
    const futureB = [
      ...publicPrefix,
      { side: 'player' as const, card: card('K', 'future-b') },
    ]
    const prefixCardIds = new Set(publicPrefix.map((item) => item.card.id))
    const input = {
      shoeId: 'shoe-alpha',
      handNumber: 8,
      guests,
    }

    const beforeFutureA = buildTableGuestRevealReactions({
      ...input,
      publicReveals: futureA,
    }).filter((reaction) =>
      prefixCardIds.has(reaction.eventId.split(':').at(-1) ?? ''),
    )
    const beforeFutureB = buildTableGuestRevealReactions({
      ...input,
      publicReveals: futureB,
    }).filter((reaction) =>
      prefixCardIds.has(reaction.eventId.split(':').at(-1) ?? ''),
    )

    expect(beforeFutureA).toEqual(beforeFutureB)
  })

  it('ignores duplicate public reveal entries', () => {
    const normal = buildTableGuestRevealReactions({
      shoeId: 'shoe-alpha',
      handNumber: 8,
      guests,
      publicReveals: PUBLIC_REVEALS,
    })
    const withDuplicate = buildTableGuestRevealReactions({
      shoeId: 'shoe-alpha',
      handNumber: 8,
      guests,
      publicReveals: [
        PUBLIC_REVEALS[0],
        PUBLIC_REVEALS[0],
        ...PUBLIC_REVEALS.slice(1),
      ],
    })

    expect(withDuplicate).toEqual(normal)
  })

  it('returns no reveal chatter when the table has no guests', () => {
    expect(
      buildTableGuestRevealReactions({
        shoeId: 'shoe-alpha',
        handNumber: 8,
        guests: [],
        publicReveals: PUBLIC_REVEALS,
      }),
    ).toEqual([])
  })
})

describe('settled guest reactions', () => {
  const guests = [
    guest('player', 'player'),
    guest('banker', 'banker'),
    guest('tie', 'tie'),
    guest('pair', 'playerPair'),
  ]

  it('distinguishes a win, loss, push, and pair result by each public intent', () => {
    const playerWins = buildTableGuestSettlementReactions({
      shoeId: 'shoe-alpha',
      handNumber: 8,
      guests,
      winner: 'player',
      playerPair: false,
      bankerPair: false,
    })

    expect(playerWins.map((reaction) => reaction.outcome)).toEqual([
      'win',
      'loss',
      'loss',
      'loss',
    ])

    const tieWithPlayerPair = buildTableGuestSettlementReactions({
      shoeId: 'shoe-alpha',
      handNumber: 9,
      guests,
      winner: 'tie',
      playerPair: true,
      bankerPair: false,
    })

    expect(tieWithPlayerPair.map((reaction) => reaction.outcome)).toEqual([
      'push',
      'push',
      'win',
      'win',
    ])
  })

  it('keeps settlement wording unique and free of chase prompts', () => {
    const reactions = buildTableGuestSettlementReactions({
      shoeId: 'shoe-alpha',
      handNumber: 8,
      guests,
      winner: 'banker',
      playerPair: false,
      bankerPair: false,
    })

    expect(new Set(reactions.map((reaction) => reaction.message))).toHaveProperty(
      'size',
      reactions.length,
    )
    expect(reactions.map((reaction) => reaction.message).join('')).not.toMatch(
      /必中|稳赢|下一局|下一铺|追|翻本/,
    )
  })
})
