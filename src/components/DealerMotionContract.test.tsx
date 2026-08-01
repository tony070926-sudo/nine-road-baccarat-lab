/// <reference types="node" />

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRef, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Card } from '../types'
import { DealerArmBridge } from './DealerArmBridge'
import { RevealPlayingCard } from './PlayingCard'

const CARD: Card = {
  id: 'card-1',
  suit: 'hearts',
  rank: '8',
  deck: 1,
}

const DEAL_MOTION = {
  roundId: 'round-1',
  cardId: CARD.id,
  sequence: 1,
}

const V3_HAND_ASSETS = [
  'dealer-hand-grasp-v3.webp',
  'dealer-hand-push-v3.webp',
  'dealer-hand-release-v3.webp',
  'player-hand-squeeze-left-v3.webp',
  'player-hand-squeeze-right-v3.webp',
  'player-hand-quick-open-v3.webp',
] as const

function revealCardProps(
  overrides: Partial<ComponentProps<typeof RevealPlayingCard>> = {},
): ComponentProps<typeof RevealPlayingCard> {
  return {
    card: CARD,
    index: 0,
    dealIndex: 0,
    side: 'player',
    faceUp: false,
    canFlip: false,
    isFlipping: false,
    isAutomatic: false,
    willAutoFlip: false,
    isPlaced: true,
    parkedForThirdCard: false,
    dealMotion: null,
    onFlip: () => undefined,
    onFlipComplete: () => undefined,
    onDealComplete: () => undefined,
    ...overrides,
  }
}

function occurrenceCount(markup: string, needle: string) {
  return markup.split(needle).length - 1
}

describe('dealer and player hand motion contracts', () => {
  it('keeps one dealer rig at stage level and none inside dealt cards', () => {
    const markup = renderToStaticMarkup(
      <div>
        <DealerArmBridge
          motion={DEAL_MOTION}
          stageRef={createRef<HTMLElement>()}
        />
        <RevealPlayingCard
          {...revealCardProps({ dealMotion: DEAL_MOTION })}
        />
        <RevealPlayingCard
          {...revealCardProps({
            card: { ...CARD, id: 'card-2' },
            index: 1,
            dealIndex: 1,
            side: 'banker',
            isFlipping: true,
            isAutomatic: true,
          })}
        />
      </div>,
    )

    expect(occurrenceCount(markup, 'data-dealer-rig-card-id=')).toBe(1)
    expect(occurrenceCount(markup, 'class="dealer-rig-vector"')).toBe(1)
    expect(markup).not.toContain('dealer-motion-hand')
  })

  it('renders exactly one dedicated hand for a manual quick reveal', () => {
    const markup = renderToStaticMarkup(
      <RevealPlayingCard
        {...revealCardProps({ isFlipping: true, isAutomatic: false })}
      />,
    )

    expect(occurrenceCount(markup, 'data-player-quick-hand')).toBe(1)
    expect(
      occurrenceCount(
        markup,
        'src="/assets/player-hand-quick-open-v3.webp"',
      ),
    ).toBe(1)
  })

  it('does not render a player hand for an automatic dealer reveal', () => {
    const markup = renderToStaticMarkup(
      <RevealPlayingCard
        {...revealCardProps({ isFlipping: true, isAutomatic: true })}
      />,
    )

    expect(markup).not.toContain('data-player-quick-hand')
    expect(markup).not.toContain('player-hand-quick-open-v3.webp')
  })

  it.each(V3_HAND_ASSETS)('%s is a nontrivial WebP asset', (fileName) => {
    const assetPath = resolve(process.cwd(), 'public/assets', fileName)

    expect(existsSync(assetPath), `${fileName} should exist`).toBe(true)
    const bytes = readFileSync(assetPath)
    expect(
      bytes.byteLength,
      `${fileName} should be larger than 1 KiB`,
    ).toBeGreaterThan(1_024)
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP')
  })
})
