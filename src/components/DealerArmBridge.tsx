import {
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react'
import {
  cappedMotionPoint,
  dealMotionConfig,
  type DealMotionToken,
} from '../game/motion'

interface DealerArmBridgeProps {
  motion: DealMotionToken | null
  revealCardId?: string | null
  stageRef: RefObject<HTMLElement | null>
}

interface Point {
  x: number
  y: number
}

type DealerRigMode = 'deal' | 'reveal'

const DEALER_RIG_BASE_REACH = {
  desktop: 150,
  mobile: 105,
} as const

function vectorFrom(anchor: Point, point: Point, baseReach: number) {
  const deltaX = point.x - anchor.x
  const deltaY = point.y - anchor.y

  return {
    angle: `${Math.atan2(deltaY, deltaX) * (180 / Math.PI) - 90}deg`,
    reach: Math.min(
      1.52,
      Math.max(0.58, Math.hypot(deltaX, deltaY) / baseReach),
    ),
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

function rigStyle(
  anchor: Point,
  rest: Point,
  approach: Point,
  pull: Point,
  middle: Point,
  target: Point,
  baseReach: number,
): Record<string, string | number> {
  const restVector = vectorFrom(anchor, rest, baseReach)
  const approachVector = vectorFrom(anchor, approach, baseReach)
  const pullVector = vectorFrom(anchor, pull, baseReach)
  const middleVector = vectorFrom(anchor, middle, baseReach)
  const targetVector = vectorFrom(anchor, target, baseReach)

  return {
    '--dealer-rig-anchor-x': `${anchor.x}px`,
    '--dealer-rig-anchor-y': `${anchor.y}px`,
    '--dealer-rig-rest-angle': restVector.angle,
    '--dealer-rig-rest-reach': restVector.reach,
    '--dealer-rig-approach-angle': approachVector.angle,
    '--dealer-rig-approach-reach': approachVector.reach,
    '--dealer-rig-pull-angle': pullVector.angle,
    '--dealer-rig-pull-reach': pullVector.reach,
    '--dealer-rig-middle-angle': middleVector.angle,
    '--dealer-rig-middle-reach': middleVector.reach,
    '--dealer-rig-target-angle': targetVector.angle,
    '--dealer-rig-target-reach': targetVector.reach,
  }
}

function setCardTrajectory(
  cardElement: HTMLElement,
  shoeElement: HTMLElement,
  stageRect: DOMRect,
) {
  const inlineAnimation = cardElement.style.animation
  cardElement.style.animation = 'none'
  const cardRect = cardElement.getBoundingClientRect()
  const shoeRect = shoeElement.getBoundingClientRect()
  const shoeCenter = pointFromRect(shoeRect, stageRect)
  const targetCenter = pointFromRect(cardRect, stageRect)
  const motionConfig = dealMotionConfig(stageRect.width)
  const releasePoint = cappedMotionPoint(
    shoeCenter,
    targetCenter,
    motionConfig.maximumReleaseTravel,
  )
  const glidePoint = {
    x: releasePoint.x + (targetCenter.x - releasePoint.x) * 0.62,
    y: releasePoint.y + (targetCenter.y - releasePoint.y) * 0.62 - 3,
  }
  const nearPoint = {
    x: releasePoint.x + (targetCenter.x - releasePoint.x) * 0.97,
    y: releasePoint.y + (targetCenter.y - releasePoint.y) * 0.97 - 0.5,
  }
  const fromX = shoeCenter.x - targetCenter.x
  const fromY = shoeCenter.y - targetCenter.y

  cardElement.style.setProperty(
    '--deal-motion-duration',
    `${motionConfig.durationMs}ms`,
  )
  cardElement.style.setProperty('--deal-from-x', `${fromX}px`)
  cardElement.style.setProperty('--deal-from-y', `${fromY}px`)
  cardElement.style.setProperty('--deal-pull-x', `${fromX * 0.96}px`)
  cardElement.style.setProperty('--deal-pull-y', `${fromY * 0.96 - 5}px`)
  cardElement.style.setProperty(
    '--deal-release-x',
    `${releasePoint.x - targetCenter.x}px`,
  )
  cardElement.style.setProperty(
    '--deal-release-y',
    `${releasePoint.y - targetCenter.y - 3}px`,
  )
  cardElement.style.setProperty(
    '--deal-mid-x',
    `${glidePoint.x - targetCenter.x}px`,
  )
  cardElement.style.setProperty(
    '--deal-mid-y',
    `${glidePoint.y - targetCenter.y}px`,
  )
  cardElement.style.setProperty(
    '--deal-near-x',
    `${nearPoint.x - targetCenter.x}px`,
  )
  cardElement.style.setProperty(
    '--deal-near-y',
    `${nearPoint.y - targetCenter.y}px`,
  )
  void cardElement.offsetWidth
  if (inlineAnimation) {
    cardElement.style.animation = inlineAnimation
  } else {
    cardElement.style.removeProperty('animation')
  }

  return { shoeCenter, releasePoint, motionConfig }
}

/**
 * The only animated dealer limb on the stage. During a deal it follows the
 * card from the shoe through a short push and releases it before the long felt
 * glide. During an automatic reveal it approaches the active card from the
 * dealer's torso. This layer is visual only; the card remains the completion
 * source, so a late animation cannot advance the round twice.
 */
export function DealerArmBridge({
  motion,
  revealCardId = null,
  stageRef,
}: DealerArmBridgeProps) {
  const bridgeRef = useRef<HTMLDivElement>(null)
  const activeCardId = motion?.cardId ?? revealCardId
  const motionSequence = motion?.sequence
  const mode: DealerRigMode | null = motion
    ? 'deal'
    : revealCardId
      ? 'reveal'
      : null

  useLayoutEffect(() => {
    if (!activeCardId || !mode) return

    const stage = stageRef.current
    const bridge = bridgeRef.current
    if (!stage || !bridge) return

    const target = Array.from(
      stage.querySelectorAll<HTMLElement>('[data-reveal-card-id]'),
    ).find((element) => element.dataset.revealCardId === activeCardId)
    if (!target) return

    const stageRect = stage.getBoundingClientRect()
    const mobile = stageRect.width <= 760
    const baseReach = mobile
      ? DEALER_RIG_BASE_REACH.mobile
      : DEALER_RIG_BASE_REACH.desktop
    let style: Record<string, string | number>

    if (mode === 'deal') {
      const shoe = stage.querySelector<HTMLElement>('[data-dealer-shoe-anchor]')
      if (!shoe) return

      const { shoeCenter, releasePoint, motionConfig } = setCardTrajectory(
        target,
        shoe,
        stageRect,
      )
      const anchor = scenePoint(
        stageRect,
        mobile ? { x: 650, y: 555 } : { x: 1040, y: 468 },
        mobile,
      )
      const rest = {
        x: anchor.x + (mobile ? 32 : 46),
        y: anchor.y - (mobile ? 22 : 34),
      }
      const pull = {
        x: shoeCenter.x + (anchor.x - shoeCenter.x) * 0.08,
        y: shoeCenter.y + (anchor.y - shoeCenter.y) * 0.08,
      }
      const middle = {
        x: shoeCenter.x + (releasePoint.x - shoeCenter.x) * 0.58,
        y: shoeCenter.y + (releasePoint.y - shoeCenter.y) * 0.58 - 6,
      }
      style = rigStyle(
        anchor,
        rest,
        shoeCenter,
        pull,
        middle,
        releasePoint,
        baseReach,
      )
      style['--dealer-rig-duration'] = `${motionConfig.durationMs}ms`
    } else {
      const targetCenter = pointFromRect(
        target.getBoundingClientRect(),
        stageRect,
      )
      const playerSide = target.classList.contains('reveal-card-player')
      const anchor = scenePoint(
        stageRect,
        mobile ? { x: 650, y: 555 } : { x: 1040, y: 468 },
        mobile,
      )
      const grip = {
        x: targetCenter.x + (playerSide ? 4 : -4),
        y: targetCenter.y + (mobile ? 5 : 9),
      }
      const approach = {
        x: grip.x + (playerSide ? 18 : -18),
        y: grip.y - (mobile ? 24 : 34),
      }
      const pull = {
        x: approach.x + (anchor.x - approach.x) * 0.1,
        y: approach.y + (anchor.y - approach.y) * 0.1,
      }
      const middle = {
        x: approach.x + (grip.x - approach.x) * 0.55,
        y: approach.y + (grip.y - approach.y) * 0.55,
      }
      const rest = {
        x: anchor.x + (approach.x - anchor.x) * 0.42,
        y: anchor.y + (approach.y - anchor.y) * 0.42,
      }
      style = rigStyle(
        anchor,
        rest,
        approach,
        pull,
        middle,
        grip,
        baseReach,
      )
      style['--dealer-rig-duration'] = mobile ? '650ms' : '720ms'
    }

    Object.entries(style).forEach(([name, value]) => {
      bridge.style.setProperty(name, String(value))
    })
    bridge.classList.add('is-ready')

    return () => bridge.classList.remove('is-ready')
  }, [activeCardId, mode, motionSequence, stageRef])

  if (!activeCardId || !mode) return null

  return (
    <div
      ref={bridgeRef}
      className={`dealer-arm-bridge dealer-arm-bridge-${mode}`}
      data-dealer-rig-card-id={activeCardId}
      data-dealer-rig-mode={mode}
      data-dealer-rig-sequence={motionSequence ?? `reveal-${activeCardId}`}
      aria-hidden="true"
    >
      <span className="dealer-rig-vector">
        <img
          className="dealer-rig-pose dealer-rig-pose-grasp"
          src="/assets/dealer-hand-grasp-v3.webp"
          alt=""
          draggable="false"
          decoding="async"
        />
        <img
          className="dealer-rig-pose dealer-rig-pose-push"
          src="/assets/dealer-hand-push-v3.webp"
          alt=""
          draggable="false"
          decoding="async"
        />
        <img
          className="dealer-rig-pose dealer-rig-pose-release"
          src="/assets/dealer-hand-release-v3.webp"
          alt=""
          draggable="false"
          decoding="async"
        />
        <span className="dealer-rig-contact-shadow" />
      </span>
    </div>
  )
}
