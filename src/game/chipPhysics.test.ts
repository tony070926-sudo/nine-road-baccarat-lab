import { describe, expect, it } from 'vitest'
import type { Bets } from '../types'
import {
  appendWagerChip,
  canDragChip,
  chipDragPose,
  chipStackLandingPose,
  chipStackLayout,
  chipStackLayoutFromValues,
  chipStackPose,
  clearWagerChipLedger,
  emptyWagerChipLedger,
  findChipDropZone,
  projectChipPoint,
  removeLastWagerChip,
  resolveChipDrop,
  rebuildWagerChipLedger,
  sampleChipVelocity,
  totalChipBets,
  type ChipDropZone,
} from './chipPhysics'

const EMPTY_BETS: Bets = {
  player: 0,
  banker: 0,
  tie: 0,
  playerPair: 0,
  bankerPair: 0,
}

const ZONES: ChipDropZone[] = [
  {
    target: 'player',
    rect: {
      left: 100,
      top: 100,
      right: 220,
      bottom: 220,
      width: 120,
      height: 120,
    },
  },
  {
    target: 'banker',
    rect: {
      left: 240,
      top: 100,
      right: 360,
      bottom: 220,
      width: 120,
      height: 120,
    },
  },
]

describe('chip availability', () => {
  it('subtracts chips already placed before allowing another drag', () => {
    const currentBets = { ...EMPTY_BETS, player: 850 }

    expect(totalChipBets(currentBets)).toBe(850)
    expect(
      canDragChip({
        enabled: true,
        value: 100,
        balance: 1_000,
        currentBets,
      }),
    ).toBe(true)
    expect(
      canDragChip({
        enabled: true,
        value: 500,
        balance: 1_000,
        currentBets,
      }),
    ).toBe(false)
  })

  it('rejects disabled, non-positive, and non-finite chip values', () => {
    for (const value of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        canDragChip({
          enabled: true,
          value,
          balance: 1_000,
          currentBets: EMPTY_BETS,
        }),
      ).toBe(false)
    }

    expect(
      canDragChip({
        enabled: false,
        value: 100,
        balance: 1_000,
        currentBets: EMPTY_BETS,
      }),
    ).toBe(false)
  })
})

describe('chip pointer physics', () => {
  it('samples velocity in pixels per millisecond with smoothing', () => {
    expect(
      sampleChipVelocity(
        { x: 10, y: 20, time: 100 },
        { x: 26, y: 12, time: 116 },
        { x: 0, y: 0 },
        1,
      ),
    ).toEqual({ x: 1, y: -0.5 })

    expect(
      sampleChipVelocity(
        { x: 0, y: 0, time: 10 },
        { x: 10, y: 10, time: 10 },
        { x: 0, y: 0 },
        1,
      ),
    ).toEqual({ x: 10, y: 10 })
  })

  it('bounds inertial projection so a flick cannot cross the table', () => {
    expect(projectChipPoint({ x: 10, y: 10 }, { x: 0.1, y: 0 }, 50, 20)).toEqual({
      x: 15,
      y: 10,
    })
    expect(projectChipPoint({ x: 10, y: 10 }, { x: 10, y: 0 }, 50, 20)).toEqual({
      x: 30,
      y: 10,
    })
  })

  it('derives restrained rotation, lift, and scale from motion', () => {
    const pose = chipDragPose({ x: 1_000, y: 0 }, { x: 10, y: 0 })

    expect(pose.rotation).toBe(14)
    expect(pose.scale).toBeCloseTo(1.09)
    expect(pose.shadowLift).toBe(28)
  })
})

describe('chip drop resolution', () => {
  it('prioritizes the actual release zone over outward velocity', () => {
    const result = resolveChipDrop({
      releasePoint: { x: 210, y: 160 },
      velocity: { x: 3, y: 0 },
      zones: ZONES,
    })

    expect(result).toMatchObject({
      accepted: true,
      target: 'player',
      usedProjection: false,
      snapPoint: { x: 160, y: 160 },
    })
  })

  it('accepts a nearby projected flick and rejects a distant miss', () => {
    expect(
      resolveChipDrop({
        releasePoint: { x: 75, y: 160 },
        velocity: { x: 0.3, y: 0 },
        zones: ZONES,
      }),
    ).toMatchObject({
      accepted: true,
      target: 'player',
      usedProjection: true,
    })

    expect(
      resolveChipDrop({
        releasePoint: { x: 20, y: 20 },
        velocity: { x: 0, y: 0 },
        zones: ZONES,
      }),
    ).toMatchObject({
      accepted: false,
      target: null,
      snapPoint: null,
    })
  })

  it('chooses the nearest center when expanded responsive zones overlap', () => {
    expect(findChipDropZone({ x: 230, y: 160 }, ZONES, 20)?.target).toBe(
      'player',
    )
    expect(findChipDropZone({ x: 234, y: 160 }, ZONES, 20)?.target).toBe(
      'banker',
    )
  })

  it('keeps visual stack offsets deterministic and bounded', () => {
    expect(chipStackPose(0, 100)).toEqual({
      x: -3.5,
      y: 0,
      rotation: -6,
    })
    expect(chipStackPose(50_000, 100)).toEqual(
      chipStackPose(1_200, 100),
    )
    expect(Math.abs(chipStackPose(900, 100).x)).toBeLessThanOrEqual(3.5)
    expect(chipStackPose(900, 100).y).toBeGreaterThanOrEqual(-10)
  })

  it('lands the drag token on the persistent top-chip center', () => {
    const firstLayer = chipStackLayout(50).layers.at(-1)
    const mixedTopLayer = chipStackLayout(150).layers.at(-1)

    expect(chipStackLandingPose(0, 50)).toEqual({
      x: firstLayer?.x,
      y: 5 + (firstLayer?.y ?? 0),
      rotation: firstLayer?.rotation,
    })
    expect(chipStackLandingPose(50, 100)).toEqual({
      x: mixedTopLayer?.x,
      y: 5 + (mixedTopLayer?.y ?? 0),
      rotation: mixedTopLayer?.rotation,
    })

    const fiveHundreds = [100, 100, 100, 100, 100]
    const sixthTopLayer = chipStackLayoutFromValues(
      600,
      [...fiveHundreds, 100],
    ).layers.at(-1)
    expect(chipStackLandingPose(500, 100, fiveHundreds)).toEqual({
      x: sixthTopLayer?.x,
      y: 5 + (sixthTopLayer?.y ?? 0),
      rotation: sixthTopLayer?.rotation,
    })
  })
})

describe('bounded physical chip stacks', () => {
  it('decomposes a mixed wager into deterministic casino denominations', () => {
    const layout = chipStackLayout(1_260)

    expect(layout.layers.map((layer) => layer.value)).toEqual([
      1_000,
      100,
      100,
      50,
      10,
    ])
    expect(layout.hiddenCount).toBe(0)
    expect(layout.layers.at(-1)?.y).toBeLessThan(0)
  })

  it('supports half-point Banker payouts without floating-point residue', () => {
    expect(chipStackLayout(9.5).layers.map((layer) => layer.value)).toEqual([
      5,
      1,
      1,
      1,
      1,
      0.5,
    ])
    expect(chipStackLayout(95).layers.map((layer) => layer.value)).toEqual([
      50,
      10,
      10,
      10,
      10,
      5,
    ])
  })

  it('caps large stacks and reports the compressed chip count', () => {
    const layout = chipStackLayout(10_000, 4)

    expect(layout.layers).toHaveLength(4)
    expect(layout.layers.every((layer) => layer.value === 1_000)).toBe(true)
    expect(layout.hiddenCount).toBe(6)
  })

  it('returns no layers for invalid or non-positive amounts', () => {
    expect(chipStackLayout(0).layers).toEqual([])
    expect(chipStackLayout(Number.NaN).layers).toEqual([])
    expect(chipStackLayout(-10).layers).toEqual([])
  })
})

describe('visual wager denomination ledger', () => {
  it('preserves each placed denomination and its order without mutating prior state', () => {
    const empty = emptyWagerChipLedger()
    const first = appendWagerChip(empty, 'player', 100)
    const mixed = appendWagerChip(
      appendWagerChip(
        appendWagerChip(first, 'player', 50),
        'player',
        500,
      ),
      'player',
      10,
    )

    expect(empty.player).toEqual([])
    expect(first.player).toEqual([100])
    expect(mixed.player).toEqual([100, 50, 500, 10])
    expect(
      chipStackLayoutFromValues(660, mixed.player).layers.map(
        (layer) => layer.value,
      ),
    ).toEqual([100, 50, 500, 10])
  })

  it('keeps five 100 chips visible as five red layers', () => {
    let ledger = emptyWagerChipLedger()
    for (let index = 0; index < 5; index += 1) {
      ledger = appendWagerChip(ledger, 'player', 100)
    }

    const layout = chipStackLayoutFromValues(500, ledger.player)
    expect(layout.layers.map((layer) => layer.value)).toEqual([
      100,
      100,
      100,
      100,
      100,
    ])
    expect(layout.layers.every((layer) => layer.tier === 'red')).toBe(true)
  })

  it('removes the real top chip one at a time without rebuilding denominations', () => {
    const playerLedger = [100, 50, 500, 10].reduce(
      (ledger, value) => appendWagerChip(ledger, 'player', value),
      emptyWagerChipLedger(),
    )
    const withBankerChip = appendWagerChip(playerLedger, 'bankerPair', 50)

    const firstRemoval = removeLastWagerChip(withBankerChip, 'player')
    const secondRemoval = removeLastWagerChip(
      firstRemoval.nextLedger,
      'player',
    )

    expect(firstRemoval.removedValue).toBe(10)
    expect(firstRemoval.nextLedger.player).toEqual([100, 50, 500])
    expect(secondRemoval.removedValue).toBe(500)
    expect(secondRemoval.nextLedger.player).toEqual([100, 50])
    expect(secondRemoval.nextLedger.bankerPair).toEqual([50])
    expect(withBankerChip.player).toEqual([100, 50, 500, 10])
  })

  it('returns the original ledger when the target has no chip to remove', () => {
    const ledger = appendWagerChip(
      emptyWagerChipLedger(),
      'banker',
      100,
    )
    const removal = removeLastWagerChip(ledger, 'player')

    expect(removal.removedValue).toBeNull()
    expect(removal.nextLedger).toBe(ledger)
  })

  it('clears and deterministically rebuilds ledgers without mutating inputs', () => {
    const bets = {
      ...EMPTY_BETS,
      player: 1_260,
      playerPair: 20,
    }
    const original = appendWagerChip(
      emptyWagerChipLedger(),
      'banker',
      100,
    )
    const cleared = clearWagerChipLedger()
    const rebuilt = rebuildWagerChipLedger(bets)

    expect(original.banker).toEqual([100])
    expect(cleared).toEqual({
      player: [],
      banker: [],
      tie: [],
      playerPair: [],
      bankerPair: [],
    })
    expect(rebuilt.player).toEqual([1_000, 100, 100, 50, 10])
    expect(rebuilt.playerPair).toEqual([10, 10])
    expect(rebuildWagerChipLedger(bets)).toEqual(rebuilt)
  })
})
