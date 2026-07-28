import type { Card } from '../types'
import {
  useLayoutEffect,
  useRef,
  type AnimationEvent,
  type CSSProperties,
} from 'react'
import { cardLabel } from '../game/cards'
import type { DealMotionToken } from '../game/motion'

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
  isPlaced: boolean
  dealMotion: DealMotionToken | null
  onFlip: (cardId: string) => void
  onFlipComplete: (cardId: string) => void
  onDealComplete: (motion: DealMotionToken) => void
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
  isPlaced,
  dealMotion,
  onFlip,
  onFlipComplete,
  onDealComplete,
}: RevealPlayingCardProps) {
  const sideLabel = side === 'player' ? '闲家' : '庄家'
  const cardRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    if (!dealMotion || !cardRef.current) return

    const shoe = document.querySelector<HTMLElement>(
      '[data-dealer-shoe-anchor]',
    )
    if (!shoe) return

    const cardElement = cardRef.current
    const inlineAnimation = cardElement.style.animation
    cardElement.style.animation = 'none'
    const cardRect = cardElement.getBoundingClientRect()
    const shoeRect = shoe.getBoundingClientRect()
    const fromX =
      shoeRect.left + shoeRect.width / 2 - (cardRect.left + cardRect.width / 2)
    const fromY =
      shoeRect.top + shoeRect.height / 2 - (cardRect.top + cardRect.height / 2)

    cardElement.style.setProperty('--deal-from-x', `${fromX}px`)
    cardElement.style.setProperty('--deal-from-y', `${fromY}px`)
    void cardElement.offsetWidth
    if (inlineAnimation) {
      cardElement.style.animation = inlineAnimation
    } else {
      cardElement.style.removeProperty('animation')
    }
  }, [dealMotion])

  const handleCardAnimationEnd = (
    event: AnimationEvent<HTMLButtonElement>,
  ) => {
    if (
      dealMotion &&
      event.currentTarget === event.target &&
      event.animationName === 'dealer-card-place'
    ) {
      onDealComplete(dealMotion)
    }
  }

  const handleRevealAnimationEnd = (
    event: AnimationEvent<HTMLSpanElement>,
  ) => {
    const expectedAnimation = isAutomatic
      ? 'dealer-card-reveal'
      : 'player-card-reveal'
    if (
      isFlipping &&
      event.currentTarget === event.target &&
      event.animationName === expectedAnimation
    ) {
      onFlipComplete(card.id)
    }
  }

  return (
    <button
      ref={cardRef}
      type="button"
      className={`reveal-card reveal-card-${side} ${faceUp ? 'is-face-up' : ''} ${
        canFlip ? 'can-flip' : ''
      } ${isFlipping ? 'is-flipping' : ''} ${
        isAutomatic ? 'is-auto-flipping' : ''
      } ${isFlipping && !isAutomatic ? 'is-user-flipping' : ''} ${
        willAutoFlip ? 'will-auto-flip' : ''
      } ${isPlaced ? 'is-placed' : 'is-waiting-deal'} ${
        dealMotion ? 'is-being-dealt' : ''
      }`}
      style={
        {
          '--card-index': index,
          '--deal-index': dealIndex,
          '--deal-angle': side === 'player' ? '-7deg' : '7deg',
        } as CSSProperties
      }
      onClick={() => canFlip && onFlip(card.id)}
      onAnimationEnd={handleCardAnimationEnd}
      disabled={!canFlip}
      aria-label={
        dealMotion
          ? `荷官正在发出${sideLabel}第 ${index + 1} 张牌`
          : faceUp
          ? `${sideLabel}第 ${index + 1} 张，${cardLabel(card)}`
          : willAutoFlip
            ? `等待荷官翻开${sideLabel}第 ${index + 1} 张牌`
          : `翻开${sideLabel}第 ${index + 1} 张牌`
      }
      aria-disabled={!canFlip}
      tabIndex={canFlip ? 0 : -1}
      data-reveal-card-id={card.id}
      data-deal-sequence={dealMotion?.sequence}
    >
      <span
        className="reveal-card-inner"
        onAnimationEnd={handleRevealAnimationEnd}
      >
        <span className="reveal-card-face reveal-card-back" aria-hidden={faceUp}>
          <span className="card-back-frame">
            <span className="card-back-medallion">九</span>
          </span>
        </span>
        <span className="reveal-card-face reveal-card-front" aria-hidden={!faceUp}>
          {faceUp && <PlayingCard card={card} index={index} />}
        </span>
      </span>

      {dealMotion && (
        <span className="dealer-motion-hand is-dealing" aria-hidden="true">
          <span className="dealer-motion-cuff" />
          <img
            src="/assets/card-reveal-hand-v2.webp"
            alt=""
            draggable="false"
            decoding="async"
          />
        </span>
      )}

      {isFlipping && isAutomatic && (
        <span className="dealer-motion-hand is-revealing" aria-hidden="true">
          <span className="dealer-motion-cuff" />
          <img
            src="/assets/card-reveal-hand-v2.webp"
            alt=""
            draggable="false"
            decoding="async"
          />
        </span>
      )}

      {isFlipping && !isAutomatic && (
        <img
          className={`card-reveal-hand card-reveal-hand-${side}`}
          src="/assets/card-reveal-hand-v2.webp"
          alt=""
          aria-hidden="true"
          draggable="false"
          decoding="async"
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
