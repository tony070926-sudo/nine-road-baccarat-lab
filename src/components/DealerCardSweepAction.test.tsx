import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  cardSweepMotionDuration,
  cardSweepMotionSteps,
  createCardSweepMotionToken,
  type CardSweepMotionInput,
} from '../game/cardSweepMotion'
import { DealerCardSweepAction } from './DealerCardSweepAction'

const effectHarness = vi.hoisted(() => ({
  cleanup: undefined as void | (() => void),
  tray: null as HTMLElement | null,
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useLayoutEffect: (effect: () => void | (() => void)) => {
      effectHarness.cleanup = effect()
    },
    useRef: () => ({ current: effectHarness.tray }),
  }
})

function dataAttributeName(property: string) {
  return `data-${property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}

function fakeElement(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  initialAttributes: Record<string, string> = {},
  initialStyles: Record<string, { value: string; priority?: string }> = {},
) {
  const attributes = new Map(Object.entries(initialAttributes))
  const styles = new Map(
    Object.entries(initialStyles).map(([name, style]) => [
      name,
      { value: style.value, priority: style.priority ?? '' },
    ]),
  )
  const style = {
    get length() {
      return styles.size
    },
    item: (index: number) => Array.from(styles.keys())[index] ?? '',
    getPropertyValue: (name: string) => styles.get(name)?.value ?? '',
    getPropertyPriority: (name: string) =>
      styles.get(name)?.priority ?? '',
    setProperty: (name: string, value: string, priority = '') => {
      styles.set(name, { value, priority })
    },
    removeProperty: (name: string) => {
      const priorValue = styles.get(name)?.value ?? ''
      styles.delete(name)
      return priorValue
    },
  }
  const element = {
    dataset: new Proxy<Record<string, string>>({}, {
      get: (_target, property: string) =>
        attributes.get(dataAttributeName(property)),
      set: (_target, property: string, value: string) => {
        attributes.set(dataAttributeName(property), String(value))
        return true
      },
    }),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value)
    },
    removeAttribute: (name: string) => {
      attributes.delete(name)
    },
    querySelector: () => null,
    getBoundingClientRect: () => rect as DOMRect,
    style,
  }

  return element as unknown as HTMLElement
}

function motion(
  profile: CardSweepMotionInput['profile'] = 'standard',
  cardIds = ['card-1', 'card-2', 'card-3', 'card-4'],
) {
  return createCardSweepMotionToken({
    roundId: 'round-28',
    cardIds,
    profile,
  })
}

function withTableCards(
  stage: HTMLElement,
  cards: readonly HTMLElement[],
) {
  Object.defineProperty(stage, 'querySelectorAll', {
    configurable: true,
    value: () => cards,
  })
  return stage
}

describe('DealerCardSweepAction', () => {
  it('exposes a visual-only round and card-count contract', () => {
    const markup = renderToStaticMarkup(
      <DealerCardSweepAction
        motion={motion()}
        stageRef={createRef<HTMLElement>()}
      />,
    )

    expect(markup).toContain('data-card-sweep-round-id="round-28"')
    expect(markup).toContain('data-card-sweep-card-count="4"')
    expect(markup).toContain('data-card-sweep-reduced-motion="false"')
    expect(markup).toContain('data-card-sweep-discard-tray')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).not.toMatch(/<(?:button|a)\b/)
    expect(markup).not.toContain('role=')
  })

  it('renders nothing without an active collection motion', () => {
    const markup = renderToStaticMarkup(
      <DealerCardSweepAction
        motion={null}
        stageRef={createRef<HTMLElement>()}
      />,
    )

    expect(markup).toBe('')
  })

  it('numbers only found cards and precisely restores prior DOM state', () => {
    const firstCard = fakeElement(
      { left: 10, top: 20, width: 20, height: 20 },
      {
        'data-table-card-id': 'card-1',
        'data-card-sweep-order': 'legacy',
      },
      {
        '--card-sweep-x': { value: '7px', priority: 'important' },
      },
    )
    const untouchedCard = fakeElement(
      { left: 40, top: 40, width: 20, height: 20 },
      { 'data-table-card-id': 'card-2' },
    )
    const thirdCard = fakeElement(
      { left: 60, top: 80, width: 20, height: 20 },
      { 'data-table-card-id': 'card-3' },
    )
    const stage = withTableCards(
      fakeElement(
        { left: 0, top: 0, width: 400, height: 300 },
        { 'data-card-sweep-state': 'paused' },
      ),
      [firstCard, untouchedCard, thirdCard],
    )
    effectHarness.tray = fakeElement({
      left: 100,
      top: 200,
      width: 20,
      height: 20,
    })

    renderToStaticMarkup(
      <DealerCardSweepAction
        motion={createCardSweepMotionToken({
          roundId: 'round-29',
          cardIds: ['missing-1', 'card-1', 'card-3', 'missing-2'],
          profile: 'standard',
        })}
        stageRef={{ current: stage }}
      />,
    )

    expect(stage.dataset.cardSweepState).toBe('collecting')
    expect(firstCard.dataset.cardSweepOrder).toBe('0')
    expect(thirdCard.dataset.cardSweepOrder).toBe('1')
    expect(untouchedCard.dataset.cardSweepOrder).toBeUndefined()
    expect(firstCard.style.getPropertyValue('--card-sweep-x')).toBe('90px')
    expect(firstCard.style.getPropertyValue('--card-sweep-y')).toBe('180px')
    expect(firstCard.style.getPropertyValue('--card-sweep-delay')).toBe(
      '55ms',
    )
    expect(thirdCard.style.getPropertyValue('--card-sweep-delay')).toBe(
      '110ms',
    )

    effectHarness.cleanup?.()

    expect(stage.dataset.cardSweepState).toBe('paused')
    expect(firstCard.dataset.cardSweepOrder).toBe('legacy')
    expect(firstCard.dataset.cardSweepRoundId).toBeUndefined()
    expect(firstCard.style.getPropertyValue('--card-sweep-x')).toBe('7px')
    expect(firstCard.style.getPropertyPriority('--card-sweep-x')).toBe(
      'important',
    )
    expect(firstCard.style.getPropertyValue('--card-sweep-y')).toBe('')
    expect(thirdCard.dataset.cardSweepOrder).toBeUndefined()
    expect(thirdCard.style.getPropertyValue('--card-sweep-delay')).toBe('')
  })

  it('uses zero-distance trajectories for reduced motion', () => {
    const card = fakeElement(
      { left: 10, top: 20, width: 20, height: 20 },
      { 'data-table-card-id': 'card-1' },
    )
    const stage = withTableCards(
      fakeElement({
        left: 0,
        top: 0,
        width: 400,
        height: 300,
      }),
      [card],
    )
    effectHarness.tray = fakeElement({
      left: 100,
      top: 200,
      width: 20,
      height: 20,
    })

    renderToStaticMarkup(
      <DealerCardSweepAction
        motion={createCardSweepMotionToken({
          roundId: 'round-30',
          cardIds: ['card-1', 'missing-1', 'missing-2', 'missing-3'],
          profile: 'reduced',
        })}
        stageRef={{ current: stage }}
      />,
    )

    expect(card.style.getPropertyValue('--card-sweep-x')).toBe('0px')
    expect(card.style.getPropertyValue('--card-sweep-y')).toBe('0px')
    expect(card.style.getPropertyValue('--card-sweep-delay')).toBe('0ms')
    expect(card.dataset.cardSweepReducedMotion).toBe('true')

    effectHarness.cleanup?.()

    expect(stage.dataset.cardSweepState).toBeUndefined()
    expect(card.dataset.cardSweepReducedMotion).toBeUndefined()
  })

  it.each(['standard', 'fast'] as const)(
    'uses the model completion point for the %s profile',
    (profile) => {
      const token = motion(profile)
      const cards = token.cardIds.map((cardId, index) =>
        fakeElement(
          { left: 10 + index * 20, top: 20, width: 20, height: 20 },
          { 'data-table-card-id': cardId },
        ),
      )
      const stage = withTableCards(
        fakeElement({
          left: 0,
          top: 0,
          width: 400,
          height: 300,
        }),
        cards,
      )
      effectHarness.tray = fakeElement({
        left: 100,
        top: 200,
        width: 20,
        height: 20,
      })

      renderToStaticMarkup(
        <DealerCardSweepAction
          motion={token}
          stageRef={{ current: stage }}
        />,
      )

      const modelSteps = cardSweepMotionSteps(token)
      const visualCompletionPoints = cards.map((card) =>
        Number.parseFloat(
          card.style.getPropertyValue('--card-sweep-delay'),
        ) +
        Number.parseFloat(
          card.style.getPropertyValue('--card-sweep-duration'),
        ),
      )

      expect(
        cards.map((card) =>
          card.style.getPropertyValue('--card-sweep-delay'),
        ),
      ).toEqual(modelSteps.map((step) => `${step.delayMs}ms`))
      expect(
        cards.map((card) =>
          card.style.getPropertyValue('--card-sweep-duration'),
        ),
      ).toEqual(modelSteps.map((step) => `${step.durationMs}ms`))
      expect(Math.max(...visualCompletionPoints)).toBe(
        cardSweepMotionDuration(token),
      )

      effectHarness.cleanup?.()
    },
  )

  it('keeps motion CSS gated by the collecting stage state', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/DealerCardSweepAction.css'),
      'utf8',
    )

    expect(css).toContain('[data-card-sweep-state="collecting"]')
    expect(css).toContain('.casino-table-stage.is-clearing-cards')
    expect(css).toContain(
      '[data-table-card-id][data-card-sweep-order]',
    )
    expect(css).toContain('animation-name: dealer-card-sweep-reduced')
  })

  it('does not use animation completion to advance game state', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/DealerCardSweepAction.tsx'),
      'utf8',
    )

    expect(source).not.toMatch(/onAnimationEnd|animationend/i)
    expect(source).toContain("stage.dataset.cardSweepState = 'collecting'")
    expect(source).toContain("'[data-table-card-id]'")
  })
})
