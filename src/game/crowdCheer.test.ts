import { describe, expect, it } from 'vitest'
import type { Card, DealResult, Rank } from '../types'
import {
  buildCardRevealCheer,
  buildSettlementCheer,
  sideIsCompleteFromPublicCards,
  type CardRevealCheerInput,
} from './crowdCheer'

function card(rank: Rank, id: string = rank): Card {
  return { id, rank, suit: 'spades', deck: 1 }
}

function revealInput(
  ranks: Rank[],
  options: {
    side?: 'player' | 'banker'
    isSideComplete?: boolean
  } = {},
): CardRevealCheerInput {
  const revealedCards = ranks.map((rank, index) =>
    card(rank, `shown-${index}-${rank}`),
  )

  return {
    side: options.side ?? 'player',
    revealedCard: revealedCards.at(-1) ?? card('A', 'fallback'),
    revealedCards,
    isSideComplete: options.isSideComplete ?? false,
  }
}

function round(
  playerRanks: Rank[],
  bankerRanks: Rank[],
): DealResult {
  const playerCards = playerRanks.map((rank, index) =>
    card(rank, `p-${index}-${rank}`),
  )
  const bankerCards = bankerRanks.map((rank, index) =>
    card(rank, `b-${index}-${rank}`),
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

describe('card reveal crowd cheers', () => {
  it('calls for a face card after the first revealed nine', () => {
    const cheer = buildCardRevealCheer(
      revealInput(['9']),
    )

    expect(cheer).toMatchObject({
      side: 'player',
      tone: 'anticipation',
    })
    expect(cheer.messages).toContain('公！公！公！')
    expect(cheer.messages).toContain('四边九！')
  })

  it('builds anticipation from public cards without accepting hidden cards', () => {
    const cheer = buildCardRevealCheer(revealInput(['9']))

    expect(cheer.messages).toEqual([
      '公！公！公！',
      '四边九！',
      '九点守住！',
    ])
  })

  it('reserves 公 for J/Q/K and calls a ten 密面 or 四边十', () => {
    const faceCheer = buildCardRevealCheer(
      revealInput(['J']),
    )
    const tenCheer = buildCardRevealCheer(
      revealInput(['10']),
    )

    expect(faceCheer.messages.join('')).toContain('公')
    expect(tenCheer.messages.join('')).toMatch(/密面|四边十/)
    expect(tenCheer.messages.join('')).not.toContain('公')
  })

  it.each([
    ['A', '无边'],
    ['4', '两边'],
    ['6', '三边'],
    ['9', '四边'],
  ] as const)('uses the %s edge call as %s', (rank, wording) => {
    const cheer = buildCardRevealCheer(
      revealInput([rank]),
    )

    expect(cheer.messages.join('')).toContain(wording)
  })

  it('celebrates only complete two-card eights and nines as naturals', () => {
    const naturalEight = buildCardRevealCheer(
      revealInput(['4', '4'], { isSideComplete: true }),
    )
    const naturalNine = buildCardRevealCheer(
      revealInput(['9', 'K'], { isSideComplete: true }),
    )

    expect(naturalEight.messages.join('')).toContain('天八')
    expect(naturalEight.messages.join('')).toContain('对子')
    expect(naturalNine.messages.join('')).toContain('天九')
    expect(naturalEight.tone).toBe('celebration')
    expect(naturalNine.tone).toBe('celebration')
  })

  it('never calls a three-card eight or nine a natural', () => {
    const threeCardEight = buildCardRevealCheer(
      revealInput(['4', '2', '2'], { isSideComplete: true }),
    )
    const threeCardNine = buildCardRevealCheer(
      revealInput(['4', '2', '3'], { isSideComplete: true }),
    )

    expect(threeCardEight.messages.join('')).toContain('补成八点')
    expect(threeCardNine.messages.join('')).toContain('补成九点')
    expect(threeCardEight.messages.join('')).not.toContain('天八')
    expect(threeCardNine.messages.join('')).not.toContain('天九')
  })

  it('distinguishes a third-card face from a third-card ten', () => {
    const faceCheer = buildCardRevealCheer(
      revealInput(['2', '3', 'Q'], { isSideComplete: true }),
    )
    const tenCheer = buildCardRevealCheer(
      revealInput(['2', '3', '10'], { isSideComplete: true }),
    )

    expect(faceCheer.messages.join('')).toContain('公')
    expect(tenCheer.messages.join('')).toContain('密面')
    expect(tenCheer.messages.join('')).not.toContain('公')
  })

  it('does not expose a hidden third-card value through completion wording', () => {
    const bankerDraws = round(['2', '3', '6'], ['3', '2', 'A'])
    const bankerStands = round(['2', '3', '8'], ['3', '2'])
    const visibleDrawInitial = bankerDraws.dealOrder.slice(0, 4)
    const visibleStandInitial = bankerStands.dealOrder.slice(0, 4)

    expect(
      sideIsCompleteFromPublicCards(
        bankerDraws,
        visibleDrawInitial,
        'banker',
      ),
    ).toBe(false)
    expect(
      sideIsCompleteFromPublicCards(
        bankerStands,
        visibleStandInitial,
        'banker',
      ),
    ).toBe(false)

    expect(
      sideIsCompleteFromPublicCards(
        bankerDraws,
        [...visibleDrawInitial, bankerDraws.playerCards[2]],
        'banker',
      ),
    ).toBe(false)
    expect(
      sideIsCompleteFromPublicCards(
        bankerStands,
        [...visibleStandInitial, bankerStands.playerCards[2]],
        'banker',
      ),
    ).toBe(true)
  })
})

describe('settlement crowd cheers', () => {
  it('returns no cheer when the round has no manually revealed side', () => {
    expect(
      buildSettlementCheer({
        winner: 'player',
        settlementNet: 100,
        manualSides: [],
      }),
    ).toBeNull()
  })

  it('anchors a positive settlement to the manually revealed winner', () => {
    const cheer = buildSettlementCheer({
      winner: 'banker',
      settlementNet: 95,
      manualSides: ['player', 'banker'],
    })

    expect(cheer).toMatchObject({
      side: 'banker',
      tone: 'celebration',
    })
    expect(cheer?.messages.join('')).toContain('庄家赢出')
  })

  it('describes a tie push without claiming a win', () => {
    const cheer = buildSettlementCheer({
      winner: 'tie',
      settlementNet: 0,
      manualSides: ['player'],
    })

    expect(cheer).toMatchObject({
      side: 'player',
      tone: 'reaction',
    })
    expect(cheer?.messages.join('')).toContain('原注退回')
  })

  it('keeps all outcomes free of guaranteed-win and repeat-play prompts', () => {
    const cheers = [
      buildSettlementCheer({
        winner: 'player',
        settlementNet: 100,
        manualSides: ['player'],
      }),
      buildSettlementCheer({
        winner: 'tie',
        settlementNet: 0,
        manualSides: ['banker'],
      }),
      buildSettlementCheer({
        winner: 'banker',
        settlementNet: -100,
        manualSides: ['player'],
      }),
    ]

    const wording = cheers
      .flatMap((cheer) => cheer?.messages ?? [])
      .join('')

    expect(wording).not.toMatch(/必中|稳了|稳赢|下一局|下一铺|追/)
  })
})
