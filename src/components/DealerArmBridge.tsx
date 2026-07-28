import {
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react'
import type { DealMotionToken } from '../game/motion'

interface DealerArmBridgeProps {
  motion: DealMotionToken | null
  stageRef: RefObject<HTMLElement | null>
}

interface Point {
  x: number
  y: number
}

const ARM_BASE_LENGTH = 260

function vectorFrom(anchor: Point, point: Point) {
  const deltaX = point.x - anchor.x
  const deltaY = point.y - anchor.y

  return {
    angle: `${Math.atan2(deltaY, deltaX) * (180 / Math.PI)}deg`,
    reach: Math.max(0.18, Math.hypot(deltaX, deltaY) / ARM_BASE_LENGTH),
  }
}

function scenePoint(
  stageRect: DOMRect,
  imagePoint: Point,
  mobile: boolean,
): Point {
  if (mobile) {
    const scale = stageRect.width / 941
    return {
      x: imagePoint.x * scale,
      y: imagePoint.y * scale,
    }
  }

  const scale = Math.max(stageRect.width / 1672, stageRect.height / 941)
  const offsetX = (stageRect.width - 1672 * scale) / 2
  return {
    x: offsetX + imagePoint.x * scale,
    y: imagePoint.y * scale,
  }
}

function pointFromRect(rect: DOMRect, stageRect: DOMRect): Point {
  return {
    x: rect.left + rect.width / 2 - stageRect.left,
    y: rect.top + rect.height / 2 - stageRect.top,
  }
}

function armStyle(
  anchor: Point,
  rest: Point,
  shoe: Point,
  target: Point,
): Record<string, string | number> {
  const pull = {
    x: shoe.x + (anchor.x - shoe.x) * 0.08,
    y: shoe.y + (anchor.y - shoe.y) * 0.08,
  }
  const middle = {
    x: shoe.x + (target.x - shoe.x) * 0.58,
    y: shoe.y + (target.y - shoe.y) * 0.58 - 16,
  }
  const restVector = vectorFrom(anchor, rest)
  const shoeVector = vectorFrom(anchor, shoe)
  const pullVector = vectorFrom(anchor, pull)
  const middleVector = vectorFrom(anchor, middle)
  const targetVector = vectorFrom(anchor, target)

  return {
    '--dealer-anchor-x': `${anchor.x}px`,
    '--dealer-anchor-y': `${anchor.y}px`,
    '--dealer-rest-angle': restVector.angle,
    '--dealer-rest-reach': restVector.reach,
    '--dealer-shoe-angle': shoeVector.angle,
    '--dealer-shoe-reach': shoeVector.reach,
    '--dealer-pull-angle': pullVector.angle,
    '--dealer-pull-reach': pullVector.reach,
    '--dealer-middle-angle': middleVector.angle,
    '--dealer-middle-reach': middleVector.reach,
    '--dealer-target-angle': targetVector.angle,
    '--dealer-target-reach': targetVector.reach,
  }
}

/**
 * A stage-level sleeve keeps the moving hand visually connected to the dealer.
 * The card remains the animation completion source, so this layer never advances
 * game state and cannot produce a duplicate deal.
 */
export function DealerArmBridge({
  motion,
  stageRef,
}: DealerArmBridgeProps) {
  const bridgeRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!motion) return

    const stage = stageRef.current
    const bridge = bridgeRef.current
    if (!stage || !bridge) return

    const target = Array.from(
      stage.querySelectorAll<HTMLElement>('[data-reveal-card-id]'),
    ).find((element) => element.dataset.revealCardId === motion.cardId)
    const shoe = stage.querySelector<HTMLElement>('[data-dealer-shoe-anchor]')
    if (!target || !shoe) return

    const stageRect = stage.getBoundingClientRect()
    const mobile = stageRect.width <= 760
    const anchor = scenePoint(
      stageRect,
      mobile ? { x: 650, y: 555 } : { x: 1040, y: 468 },
      mobile,
    )
    const rest = scenePoint(
      stageRect,
      mobile ? { x: 610, y: 585 } : { x: 1055, y: 500 },
      mobile,
    )
    const shoeCenter = pointFromRect(shoe.getBoundingClientRect(), stageRect)
    const targetCenter = pointFromRect(
      target.getBoundingClientRect(),
      stageRect,
    )
    const wristOffset = mobile ? 45 : 68
    const shoeWrist = {
      x: shoeCenter.x - (mobile ? 8 : 12),
      y: shoeCenter.y - wristOffset,
    }
    const targetWrist = {
      x: targetCenter.x,
      y: targetCenter.y - wristOffset,
    }

    const style = armStyle(anchor, rest, shoeWrist, targetWrist)
    Object.entries(style).forEach(([name, value]) => {
      bridge.style.setProperty(name, String(value))
    })
    bridge.classList.add('is-ready')

    return () => bridge.classList.remove('is-ready')
  }, [motion, stageRef])

  if (!motion) return null

  return (
    <div
      ref={bridgeRef}
      className="dealer-arm-bridge"
      data-dealer-rig-card-id={motion.cardId}
      data-dealer-rig-sequence={motion.sequence}
      aria-hidden="true"
    >
      <span className="dealer-arm-shadow" />
      <span className="dealer-shirt-sleeve">
        <i />
      </span>
    </div>
  )
}
