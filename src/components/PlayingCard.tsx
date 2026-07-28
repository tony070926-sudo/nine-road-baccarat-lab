import type { Card } from '../types'
import {
  useState,
  useLayoutEffect,
  useRef,
  type AnimationEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { cardLabel } from '../game/cards'
import {
  DRAG_REVEAL_COMMIT_PROGRESS,
  dragRevealMetrics,
  type DealMotionToken,
} from '../game/motion'

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

interface ActiveDragGesture {
  pointerId: number
  startX: number
  startY: number
  cardHeight: number
}

interface DragVisual {
  progress: number
  tilt: number
}

const IDLE_DRAG_VISUAL: DragVisual = {
  progress: 0,
  tilt: 0,
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
  const dragGestureRef = useRef<ActiveDragGesture | null>(null)
  const dragProgressRef = useRef(0)
  const [dragVisual, setDragVisual] = useState<DragVisual>(IDLE_DRAG_VISUAL)
  const [isDragging, setIsDragging] = useState(false)
  const [isDragCommit, setIsDragCommit] = useState(false)

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
    const expectedAnimations = isAutomatic
      ? ['dealer-card-reveal']
      : ['player-card-reveal', 'player-card-drag-complete']
    if (
      isFlipping &&
      event.currentTarget === event.target &&
      expectedAnimations.includes(event.animationName)
    ) {
      dragProgressRef.current = 1
      setDragVisual({ progress: 1, tilt: 0 })
      setIsDragCommit(false)
      onFlipComplete(card.id)
    }
  }

  const releasePointerCapture = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const cancelDrag = () => {
    dragGestureRef.current = null
    dragProgressRef.current = 0
    setDragVisual(IDLE_DRAG_VISUAL)
    setIsDragging(false)
    setIsDragCommit(false)
  }

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (
      !canFlip ||
      !event.isPrimary ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return
    }

    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    dragGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cardHeight: event.currentTarget.getBoundingClientRect().height,
    }
    dragProgressRef.current = 0
    setDragVisual(IDLE_DRAG_VISUAL)
    setIsDragCommit(false)
    setIsDragging(true)
  }

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const drag = dragGestureRef.current
    if (!canFlip || !drag || drag.pointerId !== event.pointerId) return

    event.preventDefault()
    const metrics = dragRevealMetrics({
      startX: drag.startX,
      startY: drag.startY,
      currentX: event.clientX,
      currentY: event.clientY,
      cardHeight: drag.cardHeight,
    })
    dragProgressRef.current = metrics.progress
    setDragVisual({
      progress: metrics.progress,
      tilt: metrics.tilt,
    })
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragGestureRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    event.preventDefault()
    const finalMetrics = dragRevealMetrics({
      startX: drag.startX,
      startY: drag.startY,
      currentX: event.clientX,
      currentY: event.clientY,
      cardHeight: drag.cardHeight,
    })
    dragProgressRef.current = finalMetrics.progress
    setDragVisual({
      progress: finalMetrics.progress,
      tilt: finalMetrics.tilt,
    })
    dragGestureRef.current = null
    releasePointerCapture(event)
    setIsDragging(false)

    if (
      canFlip &&
      finalMetrics.progress >= DRAG_REVEAL_COMMIT_PROGRESS
    ) {
      setIsDragCommit(true)
      onFlip(card.id)
      return
    }

    cancelDrag()
  }

  const handlePointerCancel = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const drag = dragGestureRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragGestureRef.current = null
    releasePointerCapture(event)
    cancelDrag()
  }

  const handleLostPointerCapture = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (dragGestureRef.current?.pointerId === event.pointerId) {
      cancelDrag()
    }
  }

  const revealRotation = dragVisual.progress * 180
  const revealLift = -14 * dragVisual.progress
  const revealScale = 1 + dragVisual.progress * 0.035
  const handOpacity = Math.min(1, dragVisual.progress * 1.7)
  const handOffset = 46 - dragVisual.progress * 58

  return (
    <button
      ref={cardRef}
      type="button"
      className={`reveal-card reveal-card-${side} ${faceUp ? 'is-face-up' : ''} ${
        canFlip ? 'can-flip' : ''
      } ${isFlipping ? 'is-flipping' : ''} ${
        isAutomatic ? 'is-auto-flipping' : ''
      } ${isFlipping && !isAutomatic ? 'is-user-flipping' : ''} ${
        isDragging ? 'is-dragging' : ''
      } ${isDragCommit ? 'is-drag-commit' : ''} ${
        willAutoFlip ? 'will-auto-flip' : ''
      } ${isPlaced ? 'is-placed' : 'is-waiting-deal'} ${
        dealMotion ? 'is-being-dealt' : ''
      }`}
      style={
        {
          '--card-index': index,
          '--deal-index': dealIndex,
          '--deal-angle': side === 'player' ? '-7deg' : '7deg',
          '--reveal-progress': dragVisual.progress,
          '--reveal-angle': `${revealRotation}deg`,
          '--reveal-tilt': `${dragVisual.tilt}deg`,
          '--reveal-lift': `${revealLift}px`,
          '--reveal-scale': revealScale,
          '--reveal-hand-opacity': handOpacity,
          '--reveal-hand-y': `${handOffset}px`,
        } as CSSProperties
      }
      onClick={(event) => {
        if (canFlip && event.detail === 0) {
          setIsDragCommit(false)
          dragProgressRef.current = 0
          setDragVisual(IDLE_DRAG_VISUAL)
          onFlip(card.id)
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onAnimationEnd={handleCardAnimationEnd}
      disabled={!canFlip}
      aria-label={
        dealMotion
          ? `荷官正在发出${sideLabel}第 ${index + 1} 张牌`
          : faceUp
          ? `${sideLabel}第 ${index + 1} 张，${cardLabel(card)}`
          : willAutoFlip
            ? `等待荷官翻开${sideLabel}第 ${index + 1} 张牌`
          : canFlip
            ? `按住拖动揭开${sideLabel}第 ${index + 1} 张牌，按 Enter 可快速开牌`
            : `翻开${sideLabel}第 ${index + 1} 张牌`
      }
      aria-disabled={!canFlip}
      tabIndex={canFlip ? 0 : -1}
      data-reveal-card-id={card.id}
      data-deal-sequence={dealMotion?.sequence}
      data-reveal-progress={dragVisual.progress.toFixed(3)}
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
          <PlayingCard card={card} index={index} />
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

      {(canFlip || (isFlipping && !isAutomatic)) && (
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
          {isDragging
            ? dragVisual.progress >= DRAG_REVEAL_COMMIT_PROGRESS
              ? '松开完成开牌'
              : `慢慢揭开 ${Math.round(dragVisual.progress * 100)}%`
            : '按住拖动 · Enter 快开'}
        </span>
      )}
      {canFlip && !isFlipping && (
        <span className="reveal-drag-meter" aria-hidden="true">
          <i />
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
