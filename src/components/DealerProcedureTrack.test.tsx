import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card, DealResult, Rank, Suit } from '../types'
import { buildDealerProcedurePlan } from '../game/dealerProcedure'
import {
  DealerProcedureTrack,
  scrollDealerProcedureStepIntoView,
} from './DealerProcedureTrack'

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

function onlyPlayerDrawsResult(): DealResult {
  return result({
    player: [card('p1', '2'), card('p2', '3'), card('p3', '4')],
    banker: [card('b1', '4'), card('b2', '3')],
    winner: 'player',
    playerTotal: 9,
    bankerTotal: 7,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DealerProcedureTrack', () => {
  it('renders planner IDs and statuses as the single source of truth', () => {
    const plan = buildDealerProcedurePlan({
      round: { result: naturalResult(), revealedCount: 0 },
      presentationPhase: 'dealing',
      openingDealtCount: 2,
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const markup = renderToStaticMarkup(
      <DealerProcedureTrack plan={plan} />,
    )

    expect(markup).toContain('data-current-step-id="deal-opening-player-2"')
    expect(markup).toContain('tabindex="0"')
    expect(markup).toMatch(
      /data-procedure-step-id="deal-opening-player-2"[^>]*data-procedure-kind="deal-opening-card"[^>]*data-procedure-state="active"[^>]*aria-current="step"/,
    )
    expect(markup.match(/data-procedure-kind="deal-opening-card"/g)).toHaveLength(
      4,
    )
    expect(markup.match(/data-procedure-state="active"/g)).toHaveLength(1)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('does not fabricate third-card stages for a natural', () => {
    const plan = buildDealerProcedurePlan({
      round: { result: naturalResult(), revealedCount: 4 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
      initialPointsAnnounced: true,
    })
    const markup = renderToStaticMarkup(
      <DealerProcedureTrack plan={plan} />,
    )

    expect(markup).toContain('data-current-step-id="announce-final-result"')
    expect(markup).not.toContain('data-procedure-kind="deal-player-third-card"')
    expect(markup).not.toContain('data-procedure-kind="deal-banker-third-card"')
    expect(markup).not.toContain('闲家补牌')
    expect(markup).not.toContain('庄家补牌')
  })

  it('renders only the actual optional action for a one-sided draw', () => {
    const plan = buildDealerProcedurePlan({
      round: { result: onlyPlayerDrawsResult(), revealedCount: 5 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
      initialPointsAnnounced: true,
    })
    const markup = renderToStaticMarkup(
      <DealerProcedureTrack plan={plan} />,
    )

    expect(markup).toContain('data-procedure-kind="deal-player-third-card"')
    expect(markup).not.toContain('data-procedure-kind="deal-banker-third-card"')
    expect(markup).toContain('闲家补牌')
    expect(markup).not.toContain('庄家补牌')
  })

  it('formats only public point calls and final totals', () => {
    const pointCall = buildDealerProcedurePlan({
      round: { result: naturalResult(), revealedCount: 4 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
    })
    const pointMarkup = renderToStaticMarkup(
      <DealerProcedureTrack plan={pointCall} announceCurrentStep />,
    )
    expect(pointMarkup).toContain('闲家 9 点，庄家 7 点，天然牌')
    expect(pointMarkup).toContain('aria-live="polite"')

    const finalCall = buildDealerProcedurePlan({
      round: { result: naturalResult(), revealedCount: 4 },
      presentationPhase: 'revealing',
      openingDealtCount: 4,
      initialPointsAnnounced: true,
    })
    const finalMarkup = renderToStaticMarkup(
      <DealerProcedureTrack plan={finalCall} announceCurrentStep />,
    )
    expect(finalMarkup).toContain('闲家 9 点，庄家 7 点，闲家胜')
  })

  it('keeps its live region opt-in so an App-level dealer call can remain authoritative', () => {
    const plan = buildDealerProcedurePlan({ round: null })
    const defaultMarkup = renderToStaticMarkup(
      <DealerProcedureTrack plan={plan} />,
    )
    const announcedMarkup = renderToStaticMarkup(
      <DealerProcedureTrack plan={plan} announceCurrentStep />,
    )

    expect(defaultMarkup).not.toContain('aria-live=')
    expect(defaultMarkup).not.toContain('role="status"')
    expect(announcedMarkup.match(/aria-live=/g)).toHaveLength(1)
    expect(announcedMarkup).toContain('荷官：请下注')
  })

  it('accepts accessible labeling and an overlay class without replacing planner identity', () => {
    const plan = buildDealerProcedurePlan({
      round: { result: naturalResult(), revealedCount: 0 },
      presentationPhase: 'no-more-bets',
    })
    const markup = renderToStaticMarkup(
      <DealerProcedureTrack
        plan={plan}
        ariaLabel="高速桌荷官程序"
        className="table-overlay"
      />,
    )

    expect(markup).toContain(
      'class="dealer-procedure-track table-overlay"',
    )
    expect(markup).toContain('aria-label="高速桌荷官程序"')
    expect(markup).toContain('data-current-step-id="no-more-bets"')
  })

  it('centers the current step with reduced-motion-aware scrolling', () => {
    const scrollIntoView = vi.fn()
    const element = { scrollIntoView }

    scrollDealerProcedureStepIntoView(element, false)
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: 'nearest',
      inline: 'center',
      behavior: 'smooth',
    })

    scrollDealerProcedureStepIntoView(element, true)
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: 'nearest',
      inline: 'center',
      behavior: 'auto',
    })
  })
})
