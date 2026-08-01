import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Card, PendingRound, RoundRecord } from '../types'
import { RoundHand } from './RoundHand'

const cards: Card[] = [
  { id: 'p-1', suit: 'spades', rank: '8', deck: 1 },
  { id: 'b-1', suit: 'hearts', rank: '4', deck: 1 },
  { id: 'p-2', suit: 'clubs', rank: 'A', deck: 1 },
  { id: 'b-2', suit: 'diamonds', rank: '3', deck: 1 },
]

const settledRound: RoundRecord = {
  id: 'round-settled',
  shoeId: 'shoe-1',
  handNumber: 1,
  timestamp: '2026-08-01T00:00:00.000Z',
  playerCards: [cards[0], cards[2]],
  bankerCards: [cards[1], cards[3]],
  dealOrder: cards,
  playerTotal: 9,
  bankerTotal: 7,
  winner: 'player',
  natural: true,
  playerPair: false,
  bankerPair: false,
  cardsUsed: 4,
  playMode: 'bet',
  bets: { player: 100, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 },
  settlement: {
    totalStake: 100,
    totalReturned: 200,
    net: 100,
    breakdown: { player: 200 },
  },
  balanceBefore: 10_000,
  balanceAfter: 10_100,
  cardsRemaining: 400,
  rulesetVersion: 'test',
  shuffleVersion: 'test',
}

const pendingRound: PendingRound = {
  id: 'round-next',
  playMode: 'bet',
  bets: settledRound.bets,
  balanceBefore: settledRound.balanceAfter,
  sourceShoeId: 'shoe-1',
  sourceCursor: 20,
  shoeAfter: {
    id: 'shoe-1',
    cards,
    cursor: 24,
    cutAtRemaining: 14,
    burnCard: cards[0],
    burnedCards: 1,
    handNumber: 2,
    shuffleVersion: 'test',
    needsShuffle: false,
  },
  result: settledRound,
}

function renderSettledHand(settledCardState: 'shown' | 'sweeping' | 'cleared') {
  return renderToStaticMarkup(
    <RoundHand
      side="player"
      settledRound={settledRound}
      pendingRound={null}
      roundReady
      visibleCardIds={new Set()}
      dealtCardIds={new Set()}
      activeDealMotion={null}
      completedCardIds={new Set()}
      nextCardId={null}
      nextCardRequiresUser={false}
      flippingCardId={null}
      revealActor={null}
      pendingTotal={null}
      settledCardState={settledCardState}
      onFlip={vi.fn()}
      onFlipComplete={vi.fn()}
      onDealComplete={vi.fn()}
    />,
  )
}

describe('RoundHand settled card lifecycle', () => {
  it('exposes stable settled-card ids while shown or sweeping', () => {
    expect(renderSettledHand('shown')).toContain('data-table-card-id="p-1"')
    expect(renderSettledHand('sweeping')).toContain(
      'data-table-card-id="p-2"',
    )
  })

  it('removes static card nodes after the discard sweep', () => {
    const markup = renderSettledHand('cleared')
    expect(markup).toContain('data-round-cards-cleared="true"')
    expect(markup).toContain('牌面已收入弃牌盒')
    expect(markup).toContain('桌面已清')
    expect(markup).not.toContain('data-table-card-id=')
    expect(markup).not.toContain('card-back-static')
  })

  it('never applies the prior settled clear state to a pending next round', () => {
    const markup = renderToStaticMarkup(
      <RoundHand
        side="player"
        settledRound={settledRound}
        pendingRound={pendingRound}
        roundReady={false}
        visibleCardIds={new Set(cards.map(({ id }) => id))}
        dealtCardIds={new Set(cards.map(({ id }) => id))}
        activeDealMotion={null}
        completedCardIds={new Set()}
        nextCardId={null}
        nextCardRequiresUser={false}
        flippingCardId={null}
        revealActor={null}
        pendingTotal={null}
        settledCardState="cleared"
        onFlip={vi.fn()}
        onFlipComplete={vi.fn()}
        onDealComplete={vi.fn()}
      />,
    )

    expect(markup).not.toContain('data-settled-card-state="cleared"')
    expect(markup).not.toContain('is-cleared')
    expect(markup).not.toContain('data-round-cards-cleared')
  })
})
