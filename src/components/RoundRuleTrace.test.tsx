import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Card, DealResult, Rank } from '../types'
import { RoundRuleTrace } from './RoundRuleTrace'

function card(id: string, rank: Rank): Card {
  return { id, rank, suit: 'hearts', deck: 1 }
}

function drawingRound(): DealResult {
  const playerCards = [card('p1', '2'), card('p2', '3'), card('p3', '8')]
  const bankerCards = [card('b1', 'A'), card('b2', '2')]
  return {
    playerCards,
    bankerCards,
    dealOrder: [
      playerCards[0],
      bankerCards[0],
      playerCards[1],
      bankerCards[1],
      playerCards[2],
    ],
    playerTotal: 3,
    bankerTotal: 3,
    winner: 'tie',
    natural: false,
    playerPair: false,
    bankerPair: false,
    cardsUsed: 5,
  }
}

describe('RoundRuleTrace', () => {
  it('renders only a waiting state while an opening card remains hidden', () => {
    const markup = renderToStaticMarkup(
      <RoundRuleTrace result={drawingRound()} revealedCount={3} />,
    )

    expect(markup).toContain('data-round-rule-trace="true"')
    expect(markup).toContain('data-rule-stage="opening"')
    expect(markup).toContain('data-rule-decision="waiting"')
    expect(markup).not.toContain('data-rule-stage="player"')
    expect(markup).not.toContain('data-rule-stage="banker"')
  })

  it('keeps the banker conclusion hidden until the player third card is revealed', () => {
    const before = renderToStaticMarkup(
      <RoundRuleTrace result={drawingRound()} revealedCount={4} />,
    )
    const after = renderToStaticMarkup(
      <RoundRuleTrace result={drawingRound()} revealedCount={5} />,
    )

    expect(before).toContain('data-rule-stage="player"')
    expect(before).toContain('data-rule-decision="waiting"')
    expect(before).not.toContain('只有遇 8 停牌')
    expect(after).toContain('data-rule-decision="stand"')
    expect(after).toContain('只有遇 8 停牌')
  })
})
