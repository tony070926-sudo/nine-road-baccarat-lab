import type { Bets, Settlement } from '../types'
import type { WagerChipLedger } from './chipPhysics'

export type SettlementActionKind = 'collect' | 'pay' | 'push'

export interface DealerSettlementMotion {
  id: string
  net: number
  bets: Bets
  returns: Settlement['breakdown']
  wagerChipLedger?: WagerChipLedger
}

export interface DealerSettlementStep {
  target: keyof Bets
  kind: SettlementActionKind
  amount: number
  returned: number
  commission: number
}

const TARGET_ORDER: Array<keyof Bets> = [
  'playerPair',
  'bankerPair',
  'player',
  'tie',
  'banker',
]

export const DEALER_SETTLEMENT_STEP_MS = 820
export const DEALER_SETTLEMENT_PRELUDE_MS = 520

export function dealerSettlementContactDelay(
  kind: SettlementActionKind,
  reducedMotion = false,
): number {
  if (reducedMotion) return 0
  if (kind === 'collect') return 205
  if (kind === 'push') return 640
  return 541
}

export function dealerSettlementSteps(
  motion: DealerSettlementMotion,
): DealerSettlementStep[] {
  const steps = TARGET_ORDER.flatMap((target) => {
    const amount = motion.bets[target]
    if (amount <= 0) return []

    const returned = motion.returns[target] ?? 0
    const kind: SettlementActionKind =
      returned === amount
        ? 'push'
        : returned > amount
          ? 'pay'
          : 'collect'

    const commission =
      target === 'banker' && kind === 'pay'
        ? Math.max(0, amount * 2 - returned)
        : 0

    return [{ target, kind, amount, returned, commission }]
  })

  const phaseOrder: Record<SettlementActionKind, number> = {
    collect: 0,
    push: 1,
    pay: 2,
  }
  return steps.sort((left, right) => phaseOrder[left.kind] - phaseOrder[right.kind])
}

export function dealerSettlementDuration(motion: DealerSettlementMotion) {
  return (
    DEALER_SETTLEMENT_PRELUDE_MS +
    Math.max(
      DEALER_SETTLEMENT_STEP_MS,
      dealerSettlementSteps(motion).length * DEALER_SETTLEMENT_STEP_MS,
    )
  )
}
