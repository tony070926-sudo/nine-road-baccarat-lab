import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Bets } from '../types'
import {
  CHIP_DROP_TARGETS,
  canDragChip,
  chipDragPose,
  chipRectCenter,
  chipStackLandingPose,
  findChipDropZone,
  resolveChipDrop,
  sampleChipVelocity,
  totalChipBets,
  type ChipDropTarget,
  type ChipDropZone,
  type ChipMotionSample,
  type ChipPoint,
  type ChipVelocity,
  type WagerChipLedger,
} from '../game/chipPhysics'

export type ChipDragState = 'idle' | 'dragging' | 'returning' | 'landing'

export interface ChipDragLayerProps {
  enabled: boolean
  selectedValue: number
  balance: number
  currentBets: Readonly<Bets>
  currentWagerChips?: WagerChipLedger
  onDrop: (target: ChipDropTarget, value: number) => void | boolean
  /**
   * Defaults match the current baccarat table and also support explicit
   * data-chip-drop-target attributes for reuse outside this app.
   */
  targetSelectors?: Partial<Record<ChipDropTarget, string>>
  dropRoot?: ParentNode | null
  chipSize?: number
  className?: string
}

interface ActiveChipDrag {
  pointerId: number
  value: number
  startPointer: ChipPoint
  lastSample: ChipMotionSample
  velocity: ChipVelocity
  originCenter: ChipPoint
}

interface ChipVisual {
  state: ChipDragState
  x: number
  y: number
  rotation: number
  scale: number
  opacity: number
  shadowLift: number
  velocity: ChipVelocity
  hoverTarget: ChipDropTarget | null
}

interface MeasuredDropZone {
  zone: ChipDropZone
  element: HTMLElement
}

const IDLE_VISUAL: ChipVisual = {
  state: 'idle',
  x: 0,
  y: 0,
  rotation: 0,
  scale: 1,
  opacity: 1,
  shadowLift: 7,
  velocity: { x: 0, y: 0 },
  hoverTarget: null,
}

const DEFAULT_TARGET_SELECTORS: Record<ChipDropTarget, string> = {
  player: '[data-chip-drop-target="player"], .bet-zone.bet-player',
  banker: '[data-chip-drop-target="banker"], .bet-zone.bet-banker',
  tie: '[data-chip-drop-target="tie"], .bet-zone.bet-tie',
  playerPair:
    '[data-chip-drop-target="playerPair"], .bet-zone.bet-player-pair',
  bankerPair:
    '[data-chip-drop-target="bankerPair"], .bet-zone.bet-banker-pair',
}

const formatChipValue = (value: number) =>
  value >= 1_000 ? `${value / 1_000}K` : String(value)

function chipPalette(value: number) {
  if (value >= 1_000) {
    return {
      edge: '#fff0b7',
      dark: '#8f6b24',
      light: '#d1ad57',
      ink: '#1a1810',
    }
  }
  if (value >= 500) {
    return {
      edge: '#eee5c7',
      dark: '#4b286d',
      light: '#70429b',
      ink: '#fff5d6',
    }
  }
  if (value >= 100) {
    return {
      edge: '#e9dec1',
      dark: '#7e2529',
      light: '#ba4548',
      ink: '#fff3c9',
    }
  }
  if (value >= 50) {
    return {
      edge: '#efe1b8',
      dark: '#294067',
      light: '#4e76a9',
      ink: '#fff4ce',
    }
  }
  return {
    edge: '#eadcb9',
    dark: '#174f3f',
    light: '#2c7e66',
    ink: '#fff7d8',
  }
}

function clearMeasuredTargets(targets: HTMLElement[]) {
  targets.forEach((element) => {
    delete element.dataset.chipDropActive
    delete element.dataset.chipDropHover
  })
  targets.length = 0
}

function safeReleasePointer(element: HTMLElement, pointerId: number) {
  try {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId)
    }
  } catch {
    // A browser can implicitly release capture before pointercancel arrives.
  }
}

function transformFor(visual: ChipVisual): string {
  return `translate3d(${visual.x}px, ${visual.y}px, 0) rotate(${visual.rotation}deg) scale(${visual.scale})`
}

export function ChipDragLayer({
  enabled,
  selectedValue,
  balance,
  currentBets,
  currentWagerChips,
  onDrop,
  targetSelectors,
  dropRoot,
  chipSize = 52,
  className = '',
}: ChipDragLayerProps) {
  const chipRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<ActiveChipDrag | null>(null)
  const visualRef = useRef<ChipVisual>(IDLE_VISUAL)
  const pendingVisualRef = useRef<ChipVisual | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const settleTimerRef = useRef<number | null>(null)
  const markedTargetsRef = useRef<HTMLElement[]>([])
  const [visual, setVisual] = useState<ChipVisual>(IDLE_VISUAL)

  const canStartDrag = useMemo(
    () =>
      canDragChip({
        enabled,
        value: selectedValue,
        balance,
        currentBets,
      }),
    [balance, currentBets, enabled, selectedValue],
  )
  const currentStake = totalChipBets(currentBets)
  const palette = chipPalette(selectedValue)

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
      }
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current)
      }
      clearMeasuredTargets(markedTargetsRef.current)
    },
    [],
  )

  const commitVisual = (next: ChipVisual) => {
    visualRef.current = next
    setVisual(next)
  }

  const scheduleVisual = (next: ChipVisual) => {
    visualRef.current = next
    pendingVisualRef.current = next
    if (animationFrameRef.current !== null) return

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null
      const pending = pendingVisualRef.current
      pendingVisualRef.current = null
      if (pending) setVisual(pending)
    })
  }

  const clearSettleTimer = () => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
  }

  const clearScheduledVisual = () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    pendingVisualRef.current = null
  }

  const measureZones = (): MeasuredDropZone[] => {
    const queryRoot = dropRoot ?? document

    return CHIP_DROP_TARGETS.flatMap((target) => {
      const selector =
        targetSelectors?.[target] ?? DEFAULT_TARGET_SELECTORS[target]
      const element = queryRoot.querySelector<HTMLElement>(selector)
      if (!element) return []

      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return []

      return [
        {
          zone: {
            target,
            rect: {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            },
          },
          element,
        },
      ]
    })
  }

  const markZones = (
    measuredZones: readonly MeasuredDropZone[],
    hoverTarget: ChipDropTarget | null,
  ) => {
    clearMeasuredTargets(markedTargetsRef.current)
    measuredZones.forEach(({ zone, element }) => {
      element.dataset.chipDropActive = 'true'
      if (zone.target === hoverTarget) {
        element.dataset.chipDropHover = 'true'
      }
      markedTargetsRef.current.push(element)
    })
  }

  const forceCurrentPose = (next: ChipVisual) => {
    const element = chipRef.current
    if (!element) return
    element.style.transition = 'none'
    element.style.transform = transformFor(next)
    element.style.opacity = String(next.opacity)
    void element.offsetWidth
  }

  const settleToIdleAfter = (delay: number) => {
    clearSettleTimer()
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null
      commitVisual(IDLE_VISUAL)
    }, delay)
  }

  const rebound = (fromVisual = visualRef.current) => {
    dragRef.current = null
    clearScheduledVisual()
    clearMeasuredTargets(markedTargetsRef.current)
    forceCurrentPose(fromVisual)
    commitVisual({
      ...IDLE_VISUAL,
      state: 'returning',
    })
    settleToIdleAfter(
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 390,
    )
  }

  const dragSnapshot = (
    drag: ActiveChipDrag,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const sample: ChipMotionSample = {
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
    }
    const velocity = sampleChipVelocity(
      drag.lastSample,
      sample,
      drag.velocity,
    )
    drag.lastSample = sample
    drag.velocity = velocity
    const displacement = {
      x: sample.x - drag.startPointer.x,
      y: sample.y - drag.startPointer.y,
    }
    const pose = chipDragPose(displacement, velocity)
    const center = {
      x: drag.originCenter.x + displacement.x,
      y: drag.originCenter.y + displacement.y,
    }

    return { sample, velocity, displacement, pose, center }
  }

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (
      !canStartDrag ||
      visualRef.current.state !== 'idle' ||
      !event.isPrimary ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return
    }

    event.preventDefault()
    clearSettleTimer()
    const element = event.currentTarget
    const rect = element.getBoundingClientRect()
    const initialSample = {
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
    }

    try {
      element.setPointerCapture(event.pointerId)
    } catch {
      // The drag still works while the pointer remains over the chip.
    }

    dragRef.current = {
      pointerId: event.pointerId,
      value: selectedValue,
      startPointer: { x: event.clientX, y: event.clientY },
      lastSample: initialSample,
      velocity: { x: 0, y: 0 },
      originCenter: chipRectCenter({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }),
    }
    const zones = measureZones()
    markZones(zones, null)
    commitVisual({
      ...IDLE_VISUAL,
      state: 'dragging',
      scale: 1.055,
      shadowLift: 12,
    })
  }

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    event.preventDefault()
    const snapshot = dragSnapshot(drag, event)
    const measuredZones = measureZones()
    const hoverTarget =
      findChipDropZone(
        snapshot.center,
        measuredZones.map(({ zone }) => zone),
        8,
      )?.target ?? null
    markZones(measuredZones, hoverTarget)
    scheduleVisual({
      state: 'dragging',
      x: snapshot.displacement.x,
      y: snapshot.displacement.y,
      rotation: snapshot.pose.rotation,
      scale: snapshot.pose.scale,
      opacity: 1,
      shadowLift: snapshot.pose.shadowLift,
      velocity: snapshot.velocity,
      hoverTarget,
    })
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    event.preventDefault()
    const snapshot = dragSnapshot(drag, event)
    clearScheduledVisual()
    const fromVisual: ChipVisual = {
      state: 'dragging',
      x: snapshot.displacement.x,
      y: snapshot.displacement.y,
      rotation: snapshot.pose.rotation,
      scale: snapshot.pose.scale,
      opacity: 1,
      shadowLift: snapshot.pose.shadowLift,
      velocity: snapshot.velocity,
      hoverTarget: visualRef.current.hoverTarget,
    }
    forceCurrentPose(fromVisual)
    dragRef.current = null
    safeReleasePointer(event.currentTarget, event.pointerId)
    clearMeasuredTargets(markedTargetsRef.current)

    const measuredZones = measureZones()
    const result = resolveChipDrop({
      releasePoint: snapshot.center,
      velocity: snapshot.velocity,
      zones: measuredZones.map(({ zone }) => zone),
    })
    const stillAffordable = canDragChip({
      enabled,
      value: drag.value,
      balance,
      currentBets,
    })

    if (
      !result.accepted ||
      !result.target ||
      !result.snapPoint ||
      !stillAffordable
    ) {
      rebound(fromVisual)
      return
    }

    let hostAccepted: boolean
    try {
      hostAccepted = onDrop(result.target, drag.value) !== false
    } catch {
      hostAccepted = false
    }
    if (!hostAccepted) {
      rebound(fromVisual)
      return
    }

    const stackPose = chipStackLandingPose(
      currentBets[result.target],
      drag.value,
      currentWagerChips?.[result.target],
    )
    const targetElement = measuredZones.find(
      ({ zone }) => zone.target === result.target,
    )?.element
    const stackAnchor = targetElement?.querySelector<HTMLElement>(
      '[data-chip-stack-anchor]',
    )
    const stackAnchorRect = stackAnchor?.getBoundingClientRect()
    const snapPoint = stackAnchorRect
      ? {
          x: stackAnchorRect.left + stackAnchorRect.width / 2,
          y: stackAnchorRect.top + stackAnchorRect.height / 2,
        }
      : result.snapPoint
    commitVisual({
      state: 'landing',
      x:
        snapPoint.x -
        drag.originCenter.x +
        stackPose.x,
      y:
        snapPoint.y -
        drag.originCenter.y +
        stackPose.y,
      rotation: stackPose.rotation,
      scale: 0.96,
      opacity: 0.08,
      shadowLift: 2,
      velocity: snapshot.velocity,
      hoverTarget: result.target,
    })
    settleToIdleAfter(
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 330,
    )
  }

  const cancelPointerGesture = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    safeReleasePointer(event.currentTarget, event.pointerId)
    rebound(visualRef.current)
  }

  const transition =
    visual.state === 'returning'
      ? 'transform 380ms cubic-bezier(0.2, 0.88, 0.25, 1.16), opacity 150ms ease-out, box-shadow 380ms ease-out'
      : visual.state === 'landing'
        ? 'transform 300ms cubic-bezier(0.12, 0.74, 0.2, 1), opacity 70ms ease-out 240ms, box-shadow 300ms ease-out'
        : 'none'

  const rootStyle: CSSProperties = {
    position: 'relative',
    isolation: 'isolate',
    display: 'inline-grid',
    width: chipSize + 10,
    height: chipSize + 10,
    placeItems: 'center',
    overflow: 'visible',
  }
  const chipStyle = {
    position: 'relative',
    zIndex: visual.state === 'idle' ? 1 : 450,
    display: 'grid',
    width: chipSize,
    height: chipSize,
    padding: 0,
    placeItems: 'center',
    color: palette.ink,
    fontFamily: '"Cormorant Garamond", Georgia, serif',
    fontSize: Math.max(11, chipSize * 0.27),
    fontWeight: 800,
    letterSpacing: '-0.02em',
    background: `radial-gradient(circle at 38% 30%, ${palette.light} 0 12%, ${palette.dark} 58% 100%)`,
    border: `${Math.max(3, chipSize * 0.075)}px dashed ${palette.edge}`,
    borderRadius: '50%',
    boxShadow: `0 ${visual.shadowLift}px ${visual.shadowLift * 1.35}px rgba(0, 0, 0, 0.36), inset 0 0 0 2px rgba(255,255,255,0.16), inset 0 0 0 7px rgba(0,0,0,0.18)`,
    opacity: visual.opacity,
    cursor:
      !canStartDrag
        ? 'not-allowed'
        : visual.state === 'dragging'
          ? 'grabbing'
          : 'grab',
    pointerEvents: canStartDrag ? 'auto' : 'none',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
    transform: transformFor(visual),
    transformOrigin: '50% 50%',
    transition,
    willChange: 'transform, opacity, box-shadow',
  } as CSSProperties

  return (
    <div
      className={`chip-drag-layer ${className}`.trim()}
      style={rootStyle}
      data-chip-drag-state={visual.state}
      data-chip-drag-enabled={canStartDrag ? 'true' : 'false'}
      data-chip-drop-target={visual.hoverTarget ?? ''}
      data-chip-value={selectedValue}
      data-chip-current-stake={currentStake}
      data-chip-available={Math.max(0, balance - currentStake)}
    >
      <div
        ref={chipRef}
        className="chip-drag-token"
        style={chipStyle}
        role="presentation"
        aria-hidden="true"
        data-chip-drag-state={visual.state}
        data-chip-drop-target={visual.hoverTarget ?? ''}
        data-chip-x={visual.x.toFixed(2)}
        data-chip-y={visual.y.toFixed(2)}
        data-chip-velocity-x={visual.velocity.x.toFixed(3)}
        data-chip-velocity-y={visual.velocity.y.toFixed(3)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={cancelPointerGesture}
        onLostPointerCapture={cancelPointerGesture}
      >
        <span
          style={{
            display: 'grid',
            width: '58%',
            height: '58%',
            placeItems: 'center',
            border: '1px solid rgba(255,255,255,0.35)',
            borderRadius: '50%',
            textShadow: '0 1px 2px rgba(0,0,0,0.58)',
          }}
        >
          {formatChipValue(selectedValue)}
        </span>
      </div>
    </div>
  )
}
