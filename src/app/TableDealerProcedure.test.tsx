import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Card, DealResult, PendingRound } from '../types'
import { TableDealerProcedure } from './TableDealerProcedure'

const card = (id: string, rank: Card['rank']): Card => ({
  id,
  rank,
  suit: 'spades',
  deck: 1,
})

function pending(result: DealResult): PendingRound {
  return {
    id: 'round-procedure',
    playMode: 'bet',
    bets: { player: 100, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 },
    balanceBefore: 10_000,
    sourceShoeId: 'shoe-procedure',
    sourceCursor: 12,
    shoeAfter: {
      id: 'shoe-procedure',
      cards: result.dealOrder,
      cursor: 12 + result.cardsUsed,
      cutAtRemaining: 14,
      burnCard: result.dealOrder[0],
      burnedCards: 1,
      handNumber: 1,
      shuffleVersion: 'test',
      needsShuffle: false,
    },
    result,
  }
}

function result(player: Card[], banker: Card[], natural = false): DealResult {
  const dealOrder = [
    player[0],
    banker[0],
    player[1],
    banker[1],
    ...player.slice(2),
    ...banker.slice(2),
  ]
  return {
    playerCards: player,
    bankerCards: banker,
    dealOrder,
    playerTotal: 9,
    bankerTotal: 7,
    winner: 'player',
    natural,
    playerPair: false,
    bankerPair: false,
    cardsUsed: dealOrder.length,
  }
}

function renderPending(
  pendingRound: PendingRound,
  options: {
    initialPointsAnnounced?: boolean
    roundReady?: boolean
  } = {},
) {
  return renderToStaticMarkup(
    <TableDealerProcedure
      pendingRound={pendingRound}
      roundPrelude={null}
      settledRound={null}
      settlementPresentation={null}
      revealedCount={4}
      dealtCardIds={new Set(pendingRound.result.dealOrder.slice(0, 4).map(({ id }) => id))}
      roundReady={options.roundReady ?? true}
      roundRequesting={false}
      initialPointsAnnouncedRoundId={
        options.initialPointsAnnounced ? pendingRound.id : null
      }
    />,
  )
}

describe('TableDealerProcedure integration', () => {
  it('holds a four-card natural on the explicit opening point call', () => {
    const natural = pending(result(
      [card('p1', '9'), card('p2', 'K')],
      [card('b1', '7'), card('b2', 'Q')],
      true,
    ))

    expect(renderPending(natural)).toContain(
      'data-current-step-id="announce-initial-points"',
    )
    expect(renderPending(natural, { initialPointsAnnounced: true })).toContain(
      'data-current-step-id="announce-final-result"',
    )
  })

  it('keeps the third-card action active while that card is being dealt', () => {
    const bothDraw = pending(result(
      [card('p1', '2'), card('p2', '3'), card('p3', '4')],
      [card('b1', '3'), card('b2', '2'), card('b3', '3')],
    ))

    const markup = renderPending(bothDraw, {
      initialPointsAnnounced: true,
      roundReady: false,
    })
    expect(markup).toContain(
      'data-current-step-id="deal-player-third-card"',
    )
    expect(markup).not.toContain(
      'data-current-step-id="reveal-opening-hands"',
    )
  })
})
