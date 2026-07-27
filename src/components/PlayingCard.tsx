import type { Card } from '../types'

const SUIT_SYMBOL = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
} as const

const SUIT_LABEL = {
  spades: '黑桃',
  hearts: '红心',
  diamonds: '方块',
  clubs: '梅花',
} as const

interface PlayingCardProps {
  card: Card
  index: number
  compact?: boolean
}

export function PlayingCard({ card, index, compact = false }: PlayingCardProps) {
  const red = card.suit === 'hearts' || card.suit === 'diamonds'
  const symbol = SUIT_SYMBOL[card.suit]

  return (
    <div
      className={`playing-card ${red ? 'is-red' : ''} ${compact ? 'is-compact' : ''}`}
      aria-label={`${SUIT_LABEL[card.suit]} ${card.rank}`}
      style={{ '--card-index': index } as React.CSSProperties}
    >
      <span className="card-corner">
        <strong>{card.rank}</strong>
        <span>{symbol}</span>
      </span>
      <span className="card-suit" aria-hidden="true">
        {symbol}
      </span>
      <span className="card-corner card-corner-bottom" aria-hidden="true">
        <strong>{card.rank}</strong>
        <span>{symbol}</span>
      </span>
    </div>
  )
}
