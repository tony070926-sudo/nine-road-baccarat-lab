import {
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react'
import {
  cardSweepMotionSteps,
  type CardSweepMotionToken,
} from '../game/cardSweepMotion'
import './DealerCardSweepAction.css'

interface DealerCardSweepActionProps {
  motion: CardSweepMotionToken | null
  stageRef: RefObject<HTMLElement | null>
}

const CARD_SWEEP_STYLE_PROPERTIES = [
  '--card-sweep-x',
  '--card-sweep-y',
  '--card-sweep-delay',
  '--card-sweep-duration',
] as const

const CARD_SWEEP_ATTRIBUTES = [
  'data-card-sweep-order',
  'data-card-sweep-round-id',
  'data-card-sweep-reduced-motion',
] as const

interface InlineStyleSnapshot {
  name: (typeof CARD_SWEEP_STYLE_PROPERTIES)[number]
  value: string
  priority: string
  present: boolean
}

interface AttributeSnapshot {
  name: string
  value: string | null
}

function restoreAttribute(
  element: HTMLElement,
  { name, value }: AttributeSnapshot,
) {
  if (value === null) {
    element.removeAttribute(name)
  } else {
    element.setAttribute(name, value)
  }
}

function elementCenter(rect: DOMRect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

/**
 * Visual-only card collection. The game state owns the clearing timer; this
 * layer only supplies measured trajectories and never advances a round from
 * an animation event.
 */
export function DealerCardSweepAction({
  motion,
  stageRef,
}: DealerCardSweepActionProps) {
  const discardTrayRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (!motion) return

    const stage = stageRef.current
    const discardTray = discardTrayRef.current
    if (!stage || !discardTray) return

    const priorStageState: AttributeSnapshot = {
      name: 'data-card-sweep-state',
      value: stage.getAttribute('data-card-sweep-state'),
    }
    stage.dataset.cardSweepState = 'collecting'

    const availableCards = Array.from(
      stage.querySelectorAll<HTMLElement>('[data-table-card-id]'),
    )
    const claimedCards = new Set<HTMLElement>()
    const matchedCards = cardSweepMotionSteps(motion).flatMap((step) => {
      const card = availableCards.find(
        (candidate) =>
          !claimedCards.has(candidate) &&
          candidate.dataset.tableCardId === step.cardId,
      )
      if (!card) return []
      claimedCards.add(card)
      return [{ card, step }]
    })
    const trayCenter = elementCenter(discardTray.getBoundingClientRect())
    const reducedMotion = motion.profile === 'reduced'
    const restoreCards: Array<() => void> = []

    matchedCards.forEach(({ card, step }, order) => {
      const styleSnapshot: InlineStyleSnapshot[] =
        CARD_SWEEP_STYLE_PROPERTIES.map((name) => ({
          name,
          value: card.style.getPropertyValue(name),
          priority: card.style.getPropertyPriority(name),
          present: Array.from(
            { length: card.style.length },
            (_, index) => card.style.item(index),
          ).includes(name),
        }))
      const attributeSnapshot: AttributeSnapshot[] =
        CARD_SWEEP_ATTRIBUTES.map((name) => ({
          name,
          value: card.getAttribute(name),
        }))
      const visualCard = card.querySelector<HTMLElement>('.playing-card') ?? card
      const cardCenter = elementCenter(visualCard.getBoundingClientRect())
      const x = reducedMotion ? 0 : trayCenter.x - cardCenter.x
      const y = reducedMotion ? 0 : trayCenter.y - cardCenter.y

      card.style.setProperty('--card-sweep-x', `${x}px`)
      card.style.setProperty('--card-sweep-y', `${y}px`)
      card.style.setProperty('--card-sweep-delay', `${step.delayMs}ms`)
      card.style.setProperty('--card-sweep-duration', `${step.durationMs}ms`)
      card.dataset.cardSweepOrder = String(order)
      card.dataset.cardSweepRoundId = motion.roundId
      card.dataset.cardSweepReducedMotion = String(reducedMotion)

      restoreCards.push(() => {
        styleSnapshot.forEach(({ name, value, priority, present }) => {
          if (present) {
            card.style.setProperty(name, value, priority)
          } else {
            card.style.removeProperty(name)
          }
        })
        attributeSnapshot.forEach((attribute) =>
          restoreAttribute(card, attribute),
        )
      })
    })

    return () => {
      restoreCards.forEach((restoreCard) => restoreCard())
      restoreAttribute(stage, priorStageState)
    }
  }, [motion, stageRef])

  if (!motion) return null

  return (
    <div
      className="dealer-card-sweep-action"
      data-card-sweep-round-id={motion.roundId}
      data-card-sweep-card-count={motion.cardIds.length}
      data-card-sweep-reduced-motion={motion.profile === 'reduced'}
      aria-hidden="true"
    >
      <span
        ref={discardTrayRef}
        className="dealer-card-sweep-discard-tray"
        data-card-sweep-discard-tray
      >
        <span className="dealer-card-sweep-discard-stack" />
        <span className="dealer-card-sweep-discard-lip" />
      </span>
    </div>
  )
}
