import type { Bets } from '../types'

export type ChipDropTarget = keyof Bets

export const CHIP_DROP_TARGETS = [
  'player',
  'banker',
  'tie',
  'playerPair',
  'bankerPair',
] as const satisfies readonly ChipDropTarget[]

export interface ChipPoint {
  x: number
  y: number
}

export interface ChipMotionSample extends ChipPoint {
  time: number
}

export interface ChipVelocity {
  x: number
  y: number
}

export interface ChipRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface ChipDropZone {
  target: ChipDropTarget
  rect: ChipRect
}

export interface ChipDropResolution {
  accepted: boolean
  target: ChipDropTarget | null
  releasePoint: ChipPoint
  projectedPoint: ChipPoint
  snapPoint: ChipPoint | null
  usedProjection: boolean
}

export interface ChipDragPose {
  rotation: number
  scale: number
  shadowLift: number
}

export interface ChipStackPose extends ChipPoint {
  rotation: number
}

export type ChipVisualTier =
  | 'amber'
  | 'blue'
  | 'green'
  | 'red'
  | 'purple'
  | 'gold'

export interface ChipStackLayer extends ChipStackPose {
  index: number
  value: number
  label: string
  tier: ChipVisualTier
}

export interface ChipStackLayout {
  amount: number
  layers: ChipStackLayer[]
  hiddenCount: number
}

/**
 * Session-only denomination history for wagers. Accounting continues to use
 * Bets; this ledger exists solely so five placed 100 chips still look like
 * five 100 chips instead of being exchanged for one 500 chip.
 */
export type WagerChipLedger = Readonly<
  Record<ChipDropTarget, readonly number[]>
>

export const CHIP_STACK_IMPACT_MS = 215
export const CHIP_STACK_MAX_VISIBLE = 6
const CHIP_STACK_DISC_CENTER_OFFSET_Y = 5

export const CHIP_STACK_DENOMINATIONS = [
  1_000,
  500,
  100,
  50,
  10,
  5,
  1,
  0.5,
] as const

export function emptyWagerChipLedger(): WagerChipLedger {
  return {
    player: [],
    banker: [],
    tie: [],
    playerPair: [],
    bankerPair: [],
  }
}

export function clearWagerChipLedger(): WagerChipLedger {
  return emptyWagerChipLedger()
}

function normalizeChipValue(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 2) / 2
}

function chipValuesForAmount(amount: number): number[] {
  const normalizedAmount = normalizeChipValue(amount)
  if (normalizedAmount === null) return []

  let remainingUnits = Math.round(normalizedAmount * 2)
  const values: number[] = []

  CHIP_STACK_DENOMINATIONS.forEach((denomination) => {
    const denominationUnits = Math.round(denomination * 2)
    const count = Math.floor(remainingUnits / denominationUnits)
    for (let index = 0; index < count; index += 1) {
      values.push(denomination)
    }
    remainingUnits -= count * denominationUnits
  })

  return values
}

export function appendWagerChip(
  ledger: WagerChipLedger,
  target: ChipDropTarget,
  value: number,
): WagerChipLedger {
  const normalizedValue = normalizeChipValue(value)
  if (normalizedValue === null) return ledger

  return {
    ...ledger,
    [target]: [...ledger[target], normalizedValue],
  }
}

/**
 * Rebuilds a stable visual ledger when denomination history is unavailable,
 * such as repeat-bet and crash recovery. The financial totals remain Bets.
 */
export function rebuildWagerChipLedger(
  bets: Readonly<Bets>,
): WagerChipLedger {
  return {
    player: chipValuesForAmount(bets.player),
    banker: chipValuesForAmount(bets.banker),
    tie: chipValuesForAmount(bets.tie),
    playerPair: chipValuesForAmount(bets.playerPair),
    bankerPair: chipValuesForAmount(bets.bankerPair),
  }
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

const distanceSquared = (first: ChipPoint, second: ChipPoint) => {
  const deltaX = first.x - second.x
  const deltaY = first.y - second.y
  return deltaX * deltaX + deltaY * deltaY
}

export function chipRectCenter(rect: ChipRect): ChipPoint {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

export function totalChipBets(bets: Readonly<Bets>): number {
  return CHIP_DROP_TARGETS.reduce((total, target) => total + bets[target], 0)
}

export function canDragChip({
  enabled,
  value,
  balance,
  currentBets,
}: {
  enabled: boolean
  value: number
  balance: number
  currentBets: Readonly<Bets>
}): boolean {
  if (
    !enabled ||
    !Number.isFinite(value) ||
    value <= 0 ||
    !Number.isFinite(balance) ||
    balance < 0
  ) {
    return false
  }

  return value <= balance - totalChipBets(currentBets)
}

/**
 * Returns a smoothed velocity in CSS pixels per millisecond. Keeping this
 * unit makes short release projection windows easy to reason about.
 */
export function sampleChipVelocity(
  previous: ChipMotionSample,
  current: ChipMotionSample,
  previousVelocity: ChipVelocity = { x: 0, y: 0 },
  response = 0.42,
): ChipVelocity {
  const elapsed = Math.max(1, current.time - previous.time)
  const weight = clamp(response, 0, 1)
  const instantX = (current.x - previous.x) / elapsed
  const instantY = (current.y - previous.y) / elapsed

  return {
    x: previousVelocity.x * (1 - weight) + instantX * weight,
    y: previousVelocity.y * (1 - weight) + instantY * weight,
  }
}

/**
 * Adds a short, bounded inertial projection. A fast flick can finish over a
 * nearby zone, but can never jump across a large part of the table.
 */
export function projectChipPoint(
  point: ChipPoint,
  velocity: ChipVelocity,
  projectionMs = 72,
  maximumDistance = 32,
): ChipPoint {
  const rawX = velocity.x * Math.max(0, projectionMs)
  const rawY = velocity.y * Math.max(0, projectionMs)
  const rawDistance = Math.hypot(rawX, rawY)
  const scale =
    rawDistance > maximumDistance && rawDistance > 0
      ? maximumDistance / rawDistance
      : 1

  return {
    x: point.x + rawX * scale,
    y: point.y + rawY * scale,
  }
}

function pointInRect(
  point: ChipPoint,
  rect: ChipRect,
  margin = 0,
): boolean {
  return (
    point.x >= rect.left - margin &&
    point.x <= rect.right + margin &&
    point.y >= rect.top - margin &&
    point.y <= rect.bottom + margin
  )
}

/**
 * Picks the closest zone center when responsive layouts make hit areas
 * overlap. Direct containment should be called with margin 0; a small margin
 * can then provide forgiving edge snapping.
 */
export function findChipDropZone(
  point: ChipPoint,
  zones: readonly ChipDropZone[],
  margin = 0,
): ChipDropZone | null {
  const candidates = zones.filter((zone) =>
    pointInRect(point, zone.rect, Math.max(0, margin)),
  )

  if (candidates.length === 0) return null

  return candidates.reduce((closest, candidate) =>
    distanceSquared(point, chipRectCenter(candidate.rect)) <
    distanceSquared(point, chipRectCenter(closest.rect))
      ? candidate
      : closest,
  )
}

/**
 * A release physically inside a zone always wins. Otherwise the short
 * velocity projection and edge margin allow a deliberate flick to land.
 */
export function resolveChipDrop({
  releasePoint,
  velocity,
  zones,
  projectionMs = 72,
  maximumProjection = 32,
  snapMargin = 14,
}: {
  releasePoint: ChipPoint
  velocity: ChipVelocity
  zones: readonly ChipDropZone[]
  projectionMs?: number
  maximumProjection?: number
  snapMargin?: number
}): ChipDropResolution {
  const projectedPoint = projectChipPoint(
    releasePoint,
    velocity,
    projectionMs,
    maximumProjection,
  )
  const directZone = findChipDropZone(releasePoint, zones)
  const projectedZone =
    directZone ?? findChipDropZone(projectedPoint, zones, snapMargin)
  const targetZone = directZone ?? projectedZone

  if (!targetZone) {
    return {
      accepted: false,
      target: null,
      releasePoint,
      projectedPoint,
      snapPoint: null,
      usedProjection: false,
    }
  }

  return {
    accepted: true,
    target: targetZone.target,
    releasePoint,
    projectedPoint,
    snapPoint: chipRectCenter(targetZone.rect),
    usedProjection: directZone === null,
  }
}

export function chipDragPose(
  displacement: ChipPoint,
  velocity: ChipVelocity,
): ChipDragPose {
  const speed = Math.hypot(velocity.x, velocity.y)

  return {
    rotation: clamp(displacement.x * 0.035 + velocity.x * 4.5, -14, 14),
    scale: 1.055 + clamp(speed * 0.012, 0, 0.035),
    shadowLift: 12 + clamp(speed * 7, 0, 16),
  }
}

/**
 * Produces a small deterministic offset so consecutive chips do not appear
 * as one perfectly flat disk when the host renders the resulting wager.
 */
export function chipStackPose(
  currentAmount: number,
  chipValue: number,
): ChipStackPose {
  const stackIndex =
    chipValue > 0
      ? clamp(Math.floor(Math.max(0, currentAmount) / chipValue), 0, 12)
      : 0

  return {
    x: (((stackIndex * 7) % 11) - 5) * 0.7,
    y: stackIndex === 0 ? 0 : -Math.min(10, stackIndex * 1.35),
    rotation: ((stackIndex * 11) % 13) - 6,
  }
}

/**
 * Resolves the physical drag token onto the center of the new persistent top
 * chip. The 5px baseline is invariant across responsive chip sizes because
 * the shared stack reserves 16px above the discs and a 3px bottom inset.
 */
export function chipStackLandingPose(
  currentAmount: number,
  chipValue: number,
  currentChipValues?: readonly number[],
): ChipStackPose {
  const layout = chipStackLayoutFromValues(
    currentAmount + chipValue,
    [
      ...(currentChipValues ?? chipValuesForAmount(currentAmount)),
      chipValue,
    ],
  )
  const topLayer = layout.layers.at(-1)

  if (!topLayer) {
    return { x: 0, y: CHIP_STACK_DISC_CENTER_OFFSET_Y, rotation: 0 }
  }

  return {
    x: topLayer.x,
    y: CHIP_STACK_DISC_CENTER_OFFSET_Y + topLayer.y,
    rotation: topLayer.rotation,
  }
}

function chipVisualTier(value: number): ChipVisualTier {
  if (value >= 1_000) return 'gold'
  if (value >= 500) return 'purple'
  if (value >= 100) return 'red'
  if (value >= 50) return 'blue'
  if (value >= 10) return 'green'
  return 'amber'
}

function chipValueLabel(value: number): string {
  if (value >= 1_000) return `${value / 1_000}K`
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/**
 * Builds a deterministic, bounded visual stack from an aggregate wager.
 * Half-point integer units avoid floating-point drift for 5% Banker payouts,
 * while the visible layer cap prevents large bets from creating huge DOMs.
 */
export function chipStackLayout(
  amount: number,
  maximumVisible = CHIP_STACK_MAX_VISIBLE,
): ChipStackLayout {
  if (!Number.isFinite(amount) || amount <= 0 || maximumVisible <= 0) {
    return {
      amount: 0,
      layers: [],
      hiddenCount: 0,
    }
  }

  const normalizedAmount = Math.round(amount * 2) / 2
  return chipStackLayoutFromValues(
    normalizedAmount,
    chipValuesForAmount(normalizedAmount),
    maximumVisible,
  )
}

/** Builds a bounded stack while preserving the supplied bottom-to-top order. */
export function chipStackLayoutFromValues(
  amount: number,
  chipValues: readonly number[],
  maximumVisible = CHIP_STACK_MAX_VISIBLE,
): ChipStackLayout {
  if (!Number.isFinite(amount) || amount <= 0 || maximumVisible <= 0) {
    return {
      amount: 0,
      layers: [],
      hiddenCount: 0,
    }
  }

  const normalizedAmount = Math.round(amount * 2) / 2
  const normalizedValues = chipValues.flatMap((value) => {
    const normalizedValue = normalizeChipValue(value)
    return normalizedValue === null ? [] : [normalizedValue]
  })
  const visibleCount = Math.min(
    normalizedValues.length,
    Math.max(0, Math.floor(maximumVisible)),
  )
  const values = normalizedValues.slice(-visibleCount)

  const layers = values.map<ChipStackLayer>((value, index) => ({
    index,
    value,
    label: chipValueLabel(value),
    tier: chipVisualTier(value),
    x: ((((index * 7) % 9) - 4) * 0.46),
    y: -index * 2.35,
    rotation: ((index * 13) % 15) - 7,
  }))

  return {
    amount: normalizedAmount,
    layers,
    hiddenCount: Math.max(0, normalizedValues.length - layers.length),
  }
}
