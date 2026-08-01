import type { Card } from '../types'
import {
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { casinoAudio } from '../audio/casinoAudio'
import { cardLabel } from '../game/cards'
import {
  DRAG_REVEAL_COMMIT_PROGRESS,
  dragRevealMetrics,
  squeezeVisualFrame,
  type DealMotionToken,
  type SqueezeCorner,
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
  parkedForThirdCard: boolean
  dealMotion: DealMotionToken | null
  onFlip: (cardId: string, inputMethod: RevealInputMethod) => void
  onFlipComplete: (cardId: string) => void
  onDealComplete: (motion: DealMotionToken) => void
}

export type RevealInputMethod = 'pointer' | 'keyboard'

interface ActiveDragGesture {
  pointerId: number
  startX: number
  startY: number
  cardHeight: number
  corner: SqueezeCorner
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
  parkedForThirdCard,
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
  const [isRebounding, setIsRebounding] = useState(false)
  const [squeezeCorner, setSqueezeCorner] =
    useState<SqueezeCorner>('right')
  const [inputMethod, setInputMethod] = useState<
    'none' | 'pointer' | 'keyboard' | 'dealer'
  >('none')
  const reboundTimerRef = useRef<number | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const pendingDragVisualRef = useRef<DragVisual | null>(null)
  const squeezeAudioBucketRef = useRef(-1)
  const gestureSequenceRef = useRef(0)

  const cancelScheduledDragVisual = () => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current)
      dragFrameRef.current = null
    }
  }

  const scheduleDragVisual = (visual: DragVisual) => {
    pendingDragVisualRef.current = visual
    if (dragFrameRef.current !== null) return

    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null
      const pendingVisual = pendingDragVisualRef.current
      pendingDragVisualRef.current = null
      if (pendingVisual) setDragVisual(pendingVisual)
    })
  }

  const flushDragVisual = (visual?: DragVisual) => {
    cancelScheduledDragVisual()
    const nextVisual = visual ?? pendingDragVisualRef.current
    pendingDragVisualRef.current = null
    if (nextVisual) setDragVisual(nextVisual)
  }

  useEffect(
    () => () => {
      if (reboundTimerRef.current !== null) {
        window.clearTimeout(reboundTimerRef.current)
      }
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current)
      }
      pendingDragVisualRef.current = null
    },
    [],
  )

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
      cancelScheduledDragVisual()
      pendingDragVisualRef.current = null
      dragProgressRef.current = 1
      setDragVisual({ progress: 1, tilt: 0 })
      setIsDragCommit(false)
      onFlipComplete(card.id)
    }
  }

  const releasePointerCapture = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // A browser may drop capture when the pointer leaves the document.
    }
  }

  const cancelDrag = () => {
    if (reboundTimerRef.current !== null) {
      window.clearTimeout(reboundTimerRef.current)
      reboundTimerRef.current = null
    }
    cancelScheduledDragVisual()
    pendingDragVisualRef.current = null
    dragGestureRef.current = null
    dragProgressRef.current = 0
    squeezeAudioBucketRef.current = -1
    setDragVisual(IDLE_DRAG_VISUAL)
    setIsDragging(false)
    setIsDragCommit(false)
    setIsRebounding(false)
    setInputMethod('none')
  }

  const reboundDrag = () => {
    dragGestureRef.current = null
    setIsDragging(false)
    setIsDragCommit(false)

    if (
      dragProgressRef.current <= 0.01 ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      cancelDrag()
      return
    }

    setIsRebounding(true)
    reboundTimerRef.current = window.setTimeout(cancelDrag, 270)
  }

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (
      !canFlip ||
      isRebounding ||
      !event.isPrimary ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return
    }

    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      return
    }
    const cardRect = event.currentTarget.getBoundingClientRect()
    const corner: SqueezeCorner =
      event.clientX - cardRect.left < cardRect.width / 2 ? 'left' : 'right'
    dragGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cardHeight: cardRect.height,
      corner,
    }
    if (reboundTimerRef.current !== null) {
      window.clearTimeout(reboundTimerRef.current)
      reboundTimerRef.current = null
    }
    dragProgressRef.current = 0
    squeezeAudioBucketRef.current = -1
    cancelScheduledDragVisual()
    pendingDragVisualRef.current = null
    setDragVisual(IDLE_DRAG_VISUAL)
    setIsDragCommit(false)
    setIsRebounding(false)
    setSqueezeCorner(corner)
    setInputMethod('pointer')
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
      corner: drag.corner,
    })
    dragProgressRef.current = metrics.progress
    scheduleDragVisual({
      progress: metrics.progress,
      tilt: metrics.tilt,
    })
    const audioBucket = Math.floor(metrics.progress * 12)
    if (audioBucket !== squeezeAudioBucketRef.current) {
      squeezeAudioBucketRef.current = audioBucket
      casinoAudio.playSqueeze(side, metrics.progress)
    }
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
      corner: drag.corner,
    })
    dragProgressRef.current = finalMetrics.progress
    flushDragVisual({
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
      setInputMethod('pointer')
      gestureSequenceRef.current += 1
      casinoAudio.playSqueezeRelease(
        `${card.id}:squeeze:commit:${gestureSequenceRef.current}`,
        side,
        true,
      )
      onFlip(card.id, 'pointer')
      return
    }

    gestureSequenceRef.current += 1
    casinoAudio.playSqueezeRelease(
      `${card.id}:squeeze:rebound:${gestureSequenceRef.current}`,
      side,
      false,
    )
    reboundDrag()
  }

  const handlePointerCancel = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const drag = dragGestureRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    flushDragVisual()
    dragGestureRef.current = null
    releasePointerCapture(event)
    reboundDrag()
  }

  const handleLostPointerCapture = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (dragGestureRef.current?.pointerId === event.pointerId) {
      flushDragVisual()
      reboundDrag()
    }
  }

  const squeezeFrame = squeezeVisualFrame(dragVisual.progress)
  const revealRotation = squeezeFrame.curlAngle * 0.72
  const handOpacity = 0.58 + dragVisual.progress * 0.34
  const handOffset = 34 - dragVisual.progress * 24
  const gestureState = isAutomatic
    ? 'auto'
    : isDragCommit
      ? 'committing'
      : isRebounding
        ? 'rebounding'
        : isDragging
          ? 'dragging'
          : faceUp
            ? 'revealed'
            : 'idle'
  const interactive = canFlip && !isRebounding
  const squeezeHandAsset =
    squeezeCorner === 'left'
      ? '/assets/player-hand-squeeze-left-v3.webp'
      : '/assets/player-hand-squeeze-right-v3.webp'

  const triggerKeyboardReveal = () => {
    if (!interactive) return
    cancelScheduledDragVisual()
    pendingDragVisualRef.current = null
    setIsDragCommit(false)
    dragProgressRef.current = 0
    setDragVisual(IDLE_DRAG_VISUAL)
    setInputMethod('keyboard')
    onFlip(card.id, 'keyboard')
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    triggerKeyboardReveal()
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
        isDragging ? 'is-dragging' : ''
      } ${isDragCommit ? 'is-drag-commit' : ''} ${
        isRebounding ? 'is-rebounding' : ''
      } squeeze-corner-${squeezeCorner} ${
        willAutoFlip ? 'will-auto-flip' : ''
      } ${isPlaced ? 'is-placed' : 'is-waiting-deal'} ${
        dealMotion ? 'is-being-dealt' : ''
      } ${
        parkedForThirdCard ? 'is-parked-for-third-card' : ''
      }`}
      style={
        {
          '--card-index': index,
          '--deal-index': dealIndex,
          '--deal-angle': side === 'player' ? '-7deg' : '7deg',
          '--reveal-progress': dragVisual.progress,
          '--reveal-angle': `${revealRotation}deg`,
          '--reveal-tilt': `${dragVisual.tilt}deg`,
          '--reveal-lift': `${squeezeFrame.lift}px`,
          '--reveal-scale': squeezeFrame.scale,
          '--reveal-hand-opacity': handOpacity,
          '--reveal-hand-y': `${handOffset}px`,
          '--squeeze-peek': `${squeezeFrame.peekPercent}%`,
          '--squeeze-crease': `${squeezeFrame.peekPercent * 1.42}%`,
          '--squeeze-crease-offset': `${squeezeFrame.peekPercent * 0.5}%`,
          '--squeeze-curl-angle': `${squeezeFrame.curlAngle}deg`,
          '--squeeze-card-tilt': `${squeezeFrame.curlAngle * 0.18}deg`,
          '--squeeze-fold-y': `${-dragVisual.progress * 8}px`,
          '--squeeze-fold-tilt':
            squeezeCorner === 'left'
              ? `${-dragVisual.progress * 4}deg`
              : `${dragVisual.progress * 4}deg`,
          '--squeeze-hand-left': squeezeCorner === 'left' ? '17%' : '83%',
          '--squeeze-hand-direction': 1,
          '--squeeze-shadow-opacity': dragVisual.progress * 0.34,
          '--squeeze-crease-opacity': Math.min(
            1,
            dragVisual.progress * 1.8,
          ),
          '--squeeze-corner-sign': squeezeCorner === 'left' ? -1 : 1,
        } as CSSProperties
      }
      onClick={(event) => {
        if (interactive && event.detail === 0) {
          triggerKeyboardReveal()
        }
      }}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onAnimationEnd={handleCardAnimationEnd}
      disabled={!interactive}
      aria-label={
        parkedForThirdCard
          ? `${sideLabel}首两张牌已收拢，第三张单独开牌`
          : dealMotion
          ? `荷官正在发出${sideLabel}第 ${index + 1} 张牌`
          : faceUp
          ? `${sideLabel}第 ${index + 1} 张，${cardLabel(card)}`
          : willAutoFlip
            ? `等待荷官翻开${sideLabel}第 ${index + 1} 张牌`
          : canFlip
            ? `按住拖动揭开${sideLabel}第 ${index + 1} 张牌，按 Enter 或空格可快速开牌`
            : `翻开${sideLabel}第 ${index + 1} 张牌`
      }
      aria-disabled={!interactive}
      tabIndex={interactive ? 0 : -1}
      data-reveal-card-id={card.id}
      data-deal-sequence={dealMotion?.sequence}
      data-deal-index={dealIndex}
      data-reveal-progress={dragVisual.progress.toFixed(3)}
      data-gesture-state={gestureState}
      data-squeeze-corner={
        isDragging || isRebounding || isDragCommit ? squeezeCorner : 'none'
      }
      data-input-method={inputMethod}
      data-opening-cards-parked={parkedForThirdCard}
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

      <span className="squeeze-stack" aria-hidden="true">
        <span className="squeeze-back-sheet" />
        <span className="squeeze-peek-front">
          <PlayingCard card={card} index={index} />
        </span>
        <span className="squeeze-curl-flap">
          <span className="card-back-frame">
            <span className="card-back-medallion">九</span>
          </span>
        </span>
        <span className="squeeze-crease" />
      </span>

      {isFlipping && !isAutomatic && !isDragCommit && (
        <span
          className={`card-reveal-hand card-reveal-hand-${side}`}
          data-player-quick-hand
          aria-hidden="true"
        >
          <img
            src="/assets/player-hand-quick-open-v3.webp"
            alt=""
            draggable="false"
            decoding="async"
          />
        </span>
      )}

      {(canFlip || (isFlipping && !isAutomatic && isDragCommit)) && (
        <>
          <span className="squeeze-hand squeeze-hand-under" aria-hidden="true">
            <img
              src={squeezeHandAsset}
              alt=""
              draggable="false"
              decoding="async"
            />
          </span>
          <span className="squeeze-hand squeeze-hand-over" aria-hidden="true">
            <img
              src={squeezeHandAsset}
              alt=""
              draggable="false"
              decoding="async"
            />
          </span>
        </>
      )}

      {canFlip && !isFlipping && (
        <span className="reveal-card-hint" aria-hidden="true">
          {isDragging
            ? dragVisual.progress >= DRAG_REVEAL_COMMIT_PROGRESS
              ? '松开完成开牌'
              : `慢慢揭开 ${Math.round(dragVisual.progress * 100)}%`
            : '按住拖动 · Enter / 空格快开'}
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
