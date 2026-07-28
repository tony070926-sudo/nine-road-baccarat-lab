import type { Card } from '../types'
import type { CSSProperties, TransitionEvent } from 'react'
import { cardLabel } from '../game/cards'

const SUIT_SYMBOL = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
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
      aria-label={cardLabel(card)}
      style={{ '--card-index': index } as CSSProperties}
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

interface RevealPlayingCardProps {
  card: Card
  index: number
  dealIndex: number
  side: 'player' | 'banker'
  faceUp: boolean
  canFlip: boolean
  isFlipping: boolean
  isAutomatic: boolean
  willAutoFlip: boolean
  onFlip: (cardId: string) => void
  onFlipComplete: (cardId: string) => void
}

export function RevealPlayingCard({
  card,
  index,
  dealIndex,
  side,
  faceUp,
  canFlip,
  isFlipping,
  isAutomatic,
  willAutoFlip,
  onFlip,
  onFlipComplete,
}: RevealPlayingCardProps) {
  const sideLabel = side === 'player' ? '闲家' : '庄家'

  const handleTransitionEnd = (event: TransitionEvent<HTMLSpanElement>) => {
    if (
      isFlipping &&
      event.currentTarget === event.target &&
      event.propertyName === 'transform'
    ) {
      onFlipComplete(card.id)
    }
  }

  return (
    <button
      type="button"
      className={`reveal-card reveal-card-${side} ${faceUp ? 'is-face-up' : ''} ${
        canFlip ? 'can-flip' : ''
      } ${isFlipping ? 'is-flipping' : ''} ${
        isAutomatic ? 'is-auto-flipping' : ''
      } ${willAutoFlip ? 'will-auto-flip' : ''}`}
      style={
        {
          '--card-index': index,
          '--deal-index': dealIndex,
        } as CSSProperties
      }
      onClick={() => canFlip && onFlip(card.id)}
      aria-label={
        faceUp
          ? `${sideLabel}第 ${index + 1} 张，${cardLabel(card)}`
          : willAutoFlip
            ? `等待荷官翻开${sideLabel}第 ${index + 1} 张牌`
          : `翻开${sideLabel}第 ${index + 1} 张牌`
      }
      aria-disabled={!canFlip}
      tabIndex={canFlip ? 0 : -1}
      data-reveal-card-id={card.id}
    >
      <span className="reveal-card-inner" onTransitionEnd={handleTransitionEnd}>
        <span className="reveal-card-face reveal-card-back" aria-hidden={faceUp}>
          <span className="card-back-frame">
            <span className="card-back-medallion">九</span>
          </span>
        </span>
        <span className="reveal-card-face reveal-card-front" aria-hidden={!faceUp}>
          {faceUp && <PlayingCard card={card} index={index} />}
        </span>
      </span>

      {(canFlip || (isFlipping && !isAutomatic)) && (
        <img
          className={`card-reveal-hand card-reveal-hand-${side}`}
          src="/assets/card-reveal-hand-v2.webp"
          alt=""
          aria-hidden="true"
          draggable="false"
        />
      )}

      {canFlip && !isFlipping && (
        <span className="reveal-card-hint" aria-hidden="true">
          点击翻牌
        </span>
      )}
      {willAutoFlip && !isFlipping && (
        <span className="reveal-card-hint is-auto" aria-hidden="true">
          荷官翻牌
        </span>
      )}
    </button>
  )
}
