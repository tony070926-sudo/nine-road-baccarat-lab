import type { DealResult, Winner } from '../types'
import { handTotal } from './baccarat'

export type DealerProcedureSide = 'player' | 'banker'

export type DealerProcedureSettlementState =
  | 'not-started'
  | 'collecting-losing-wagers'
  | 'paying-winners'
  | 'recording-road'
  | 'discarding-cards'
  | 'complete'

export type DealerProcedureStepKind =
  | 'place-bets'
  | 'no-more-bets'
  | 'deal-opening-card'
  | 'reveal-opening-hands'
  | 'announce-initial-points'
  | 'deal-player-third-card'
  | 'deal-banker-third-card'
  | 'announce-final-result'
  | 'collect-losing-wagers'
  | 'pay-winning-wagers'
  | 'record-road'
  | 'sweep-cards-to-discard-tray'
  | 'open-next-round'

export type DealerProcedureStepStatus = 'complete' | 'active' | 'pending'

export type DealerProcedureStepId =
  | 'place-bets'
  | 'no-more-bets'
  | `deal-opening-${DealerProcedureSide}-${1 | 2}`
  | 'reveal-opening-hands'
  | 'announce-initial-points'
  | 'deal-player-third-card'
  | 'deal-banker-third-card'
  | 'announce-final-result'
  | 'collect-losing-wagers'
  | 'pay-winning-wagers'
  | 'record-road'
  | 'sweep-cards-to-discard-tray'
  | 'open-next-round'

export type DealerProcedureAnnouncement =
  | {
      kind: 'initial-points'
      playerTotal: number
      bankerTotal: number
      natural: boolean
    }
  | {
      kind: 'final-result'
      playerTotal: number
      bankerTotal: number
      winner: Winner
    }

export interface DealerProcedureStep {
  id: DealerProcedureStepId
  kind: DealerProcedureStepKind
  status: DealerProcedureStepStatus
  side?: DealerProcedureSide
  handCardNumber?: 1 | 2 | 3
  progress?: {
    completed: number
    total: number
  }
  announcement?: DealerProcedureAnnouncement
}

export interface DealerProcedureRoundState {
  result: DealResult
  revealedCount: number
}

export interface DealerProcedurePlanInput {
  round: DealerProcedureRoundState | null
  settlementState?: DealerProcedureSettlementState
}

export interface DealerProcedurePlan {
  steps: DealerProcedureStep[]
  activeStepId: DealerProcedureStepId
  revealedCount: number
  revealComplete: boolean
}

type DealerProcedureStepDraft = Omit<DealerProcedureStep, 'status'>

const OPENING_DEAL: ReadonlyArray<{
  side: DealerProcedureSide
  handCardNumber: 1 | 2
}> = [
  { side: 'player', handCardNumber: 1 },
  { side: 'banker', handCardNumber: 1 },
  { side: 'player', handCardNumber: 2 },
  { side: 'banker', handCardNumber: 2 },
]

const ACTIVE_SETTLEMENT_STEP: Record<
  DealerProcedureSettlementState,
  DealerProcedureStepId
> = {
  'not-started': 'announce-final-result',
  'collecting-losing-wagers': 'collect-losing-wagers',
  'paying-winners': 'pay-winning-wagers',
  'recording-road': 'record-road',
  'discarding-cards': 'sweep-cards-to-discard-tray',
  complete: 'open-next-round',
}

function safeRevealCount(result: DealResult, revealedCount: number): number {
  if (!Number.isFinite(revealedCount)) return 0
  return Math.min(
    result.dealOrder.length,
    Math.max(0, Math.trunc(revealedCount)),
  )
}

function withStepStatuses(
  drafts: DealerProcedureStepDraft[],
  activeStepId: DealerProcedureStepId,
): DealerProcedureStep[] {
  const activeIndex = drafts.findIndex((step) => step.id === activeStepId)

  return drafts.map((step, index) => ({
    ...step,
    status:
      index < activeIndex
        ? 'complete'
        : index === activeIndex
          ? 'active'
          : 'pending',
  }))
}

/**
 * Builds a visual-only dealer procedure. It neither deals cards nor settles
 * wagers, and therefore cannot alter the baccarat engine's mathematical state.
 * Optional third-card actions and point calls are withheld until the relevant
 * cards have been exposed, preventing the procedure display from leaking the
 * precomputed result.
 */
export function buildDealerProcedurePlan({
  round,
  settlementState = 'not-started',
}: DealerProcedurePlanInput): DealerProcedurePlan {
  if (!round) {
    return {
      steps: [
        {
          id: 'place-bets',
          kind: 'place-bets',
          status: 'active',
        },
      ],
      activeStepId: 'place-bets',
      revealedCount: 0,
      revealComplete: false,
    }
  }

  const { result } = round
  const revealedCount = safeRevealCount(result, round.revealedCount)
  const openingHandsRevealed = revealedCount >= 4
  const revealComplete = revealedCount === result.dealOrder.length
  const playerHasThirdCard = result.playerCards.length === 3
  const bankerHasThirdCard = result.bankerCards.length === 3

  const drafts: DealerProcedureStepDraft[] = [
    { id: 'place-bets', kind: 'place-bets' },
    { id: 'no-more-bets', kind: 'no-more-bets' },
    ...OPENING_DEAL.map(
      ({ side, handCardNumber }): DealerProcedureStepDraft => ({
        id: `deal-opening-${side}-${handCardNumber}`,
        kind: 'deal-opening-card',
        side,
        handCardNumber,
      }),
    ),
    {
      id: 'reveal-opening-hands',
      kind: 'reveal-opening-hands',
      progress: {
        completed: Math.min(4, revealedCount),
        total: 4,
      },
    },
    {
      id: 'announce-initial-points',
      kind: 'announce-initial-points',
      announcement: openingHandsRevealed
        ? {
            kind: 'initial-points',
            playerTotal: handTotal(result.playerCards.slice(0, 2)),
            bankerTotal: handTotal(result.bankerCards.slice(0, 2)),
            natural: result.natural,
          }
        : undefined,
    },
  ]

  if (openingHandsRevealed && playerHasThirdCard) {
    drafts.push({
      id: 'deal-player-third-card',
      kind: 'deal-player-third-card',
      side: 'player',
      handCardNumber: 3,
    })
  }

  if (openingHandsRevealed && bankerHasThirdCard) {
    drafts.push({
      id: 'deal-banker-third-card',
      kind: 'deal-banker-third-card',
      side: 'banker',
      handCardNumber: 3,
    })
  }

  drafts.push(
    {
      id: 'announce-final-result',
      kind: 'announce-final-result',
      announcement: revealComplete
        ? {
            kind: 'final-result',
            playerTotal: result.playerTotal,
            bankerTotal: result.bankerTotal,
            winner: result.winner,
          }
        : undefined,
    },
    {
      id: 'collect-losing-wagers',
      kind: 'collect-losing-wagers',
    },
    { id: 'pay-winning-wagers', kind: 'pay-winning-wagers' },
    { id: 'record-road', kind: 'record-road' },
    {
      id: 'sweep-cards-to-discard-tray',
      kind: 'sweep-cards-to-discard-tray',
    },
    { id: 'open-next-round', kind: 'open-next-round' },
  )

  let activeStepId: DealerProcedureStepId
  if (!openingHandsRevealed) {
    activeStepId = 'reveal-opening-hands'
  } else if (playerHasThirdCard && revealedCount < 5) {
    activeStepId = 'deal-player-third-card'
  } else {
    const bankerThirdCardRevealCount = playerHasThirdCard ? 6 : 5
    if (bankerHasThirdCard && revealedCount < bankerThirdCardRevealCount) {
      activeStepId = 'deal-banker-third-card'
    } else if (!revealComplete) {
      activeStepId = 'announce-final-result'
    } else {
      activeStepId = ACTIVE_SETTLEMENT_STEP[settlementState]
    }
  }

  return {
    steps: withStepStatuses(drafts, activeStepId),
    activeStepId,
    revealedCount,
    revealComplete,
  }
}
