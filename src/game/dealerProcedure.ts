import type { DealResult, Winner } from '../types'
import { handTotal } from './baccarat'

export type DealerProcedureSide = 'player' | 'banker'

/**
 * Presentation phases deliberately mirror the table's coarse visual phases.
 * The extra opening-deal and point-call inputs below make the physical
 * sub-steps explicit without allowing this visual planner to own game state.
 */
export type DealerProcedurePresentationPhase =
  | 'betting'
  | 'no-more-bets'
  | 'dealing'
  | 'revealing'
  | 'settling'

export type DealerProcedureSettlementState =
  | 'not-started'
  | 'collecting-losing-wagers'
  | 'returning-pushed-wagers'
  | 'paying-winners'
  | 'recording-road'
  | 'discarding-cards'
  | 'complete'

export type DealerProcedureWagerAction = 'collect' | 'push' | 'pay'

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
  | 'return-pushed-wagers'
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
  | 'return-pushed-wagers'
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
  /**
   * Omitted callers remain safe: a prepared round with no public cards starts
   * at the first physical deal, while a round with public cards resumes at the
   * reveal procedure. No completed physical action is guessed from precomputed
   * result data alone.
   */
  presentationPhase?: DealerProcedurePresentationPhase
  /** Number of P/B/P/B opening cards that have physically landed, from 0 to 4. */
  openingDealtCount?: number
  /**
   * Must be set only after the opening point call has actually been presented.
   * It defaults to false so restoration can safely repeat rather than skip it.
   */
  initialPointsAnnounced?: boolean
  settlementState?: DealerProcedureSettlementState
  /** Omit only the wager actions that the settled round did not perform. */
  settlementActions?: readonly DealerProcedureWagerAction[]
}

export interface DealerProcedurePlan {
  steps: DealerProcedureStep[]
  activeStepId: DealerProcedureStepId
  presentationPhase: DealerProcedurePresentationPhase
  openingDealtCount: number
  initialPointsAnnounced: boolean
  revealedCount: number
  revealComplete: boolean
}

type DealerProcedureStepDraft = Omit<DealerProcedureStep, 'status'>

const OPENING_DEAL = [
  {
    id: 'deal-opening-player-1',
    side: 'player',
    handCardNumber: 1,
  },
  {
    id: 'deal-opening-banker-1',
    side: 'banker',
    handCardNumber: 1,
  },
  {
    id: 'deal-opening-player-2',
    side: 'player',
    handCardNumber: 2,
  },
  {
    id: 'deal-opening-banker-2',
    side: 'banker',
    handCardNumber: 2,
  },
] as const satisfies ReadonlyArray<{
  id: DealerProcedureStepId
  side: DealerProcedureSide
  handCardNumber: 1 | 2
}>

function safeCount(value: number | undefined, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.min(maximum, Math.max(0, Math.trunc(value)))
}

function safeRevealCount(result: DealResult | null, revealedCount: number): number {
  if (!result) return 0
  return safeCount(revealedCount, result.dealOrder.length)
}

function withStepStatuses(
  drafts: DealerProcedureStepDraft[],
  activeStepId: DealerProcedureStepId,
): DealerProcedureStep[] {
  const activeIndex = drafts.findIndex((step) => step.id === activeStepId)
  if (activeIndex < 0) {
    throw new Error(`Dealer procedure step ${activeStepId} is unavailable`)
  }

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

function activeRevealStep(input: {
  openingDealtCount: number
  openingHandsRevealed: boolean
  initialPointsAnnounced: boolean
  playerHasThirdCard: boolean
  bankerHasThirdCard: boolean
  bankerDecisionPublic: boolean
  revealedCount: number
  revealComplete: boolean
}): DealerProcedureStepId {
  if (input.openingDealtCount < OPENING_DEAL.length) {
    return OPENING_DEAL[input.openingDealtCount].id
  }
  if (!input.openingHandsRevealed) return 'reveal-opening-hands'
  if (!input.initialPointsAnnounced) return 'announce-initial-points'
  if (input.playerHasThirdCard && input.revealedCount < 5) {
    return 'deal-player-third-card'
  }

  const bankerThirdCardRevealCount = input.playerHasThirdCard ? 6 : 5
  if (
    input.bankerDecisionPublic &&
    input.bankerHasThirdCard &&
    input.revealedCount < bankerThirdCardRevealCount
  ) {
    return 'deal-banker-third-card'
  }
  if (!input.revealComplete) return 'reveal-opening-hands'
  return 'announce-final-result'
}

function activeSettlementStep(
  settlementState: DealerProcedureSettlementState,
  settlementActions: ReadonlySet<DealerProcedureWagerAction>,
): DealerProcedureStepId {
  if (settlementState === 'not-started') {
    if (settlementActions.has('collect')) return 'collect-losing-wagers'
    if (settlementActions.has('push')) return 'return-pushed-wagers'
    if (settlementActions.has('pay')) return 'pay-winning-wagers'
    return 'record-road'
  }
  if (settlementState === 'collecting-losing-wagers') {
    return 'collect-losing-wagers'
  }
  if (settlementState === 'returning-pushed-wagers') {
    return 'return-pushed-wagers'
  }
  if (settlementState === 'paying-winners') return 'pay-winning-wagers'
  if (settlementState === 'recording-road') return 'record-road'
  if (settlementState === 'discarding-cards') {
    return 'sweep-cards-to-discard-tray'
  }
  return 'open-next-round'
}

/**
 * Builds a visual-only dealer procedure. It neither deals cards nor settles
 * wagers, and therefore cannot alter the baccarat engine's mathematical state.
 * Optional third-card actions and point calls are withheld until the rules
 * that determine them depend only on cards already exposed to the table.
 */
export function buildDealerProcedurePlan({
  round,
  presentationPhase: requestedPresentationPhase,
  openingDealtCount: requestedOpeningDealtCount,
  initialPointsAnnounced = false,
  settlementState = 'not-started',
  settlementActions: requestedSettlementActions,
}: DealerProcedurePlanInput): DealerProcedurePlan {
  const result = round?.result ?? null
  const revealedCount = safeRevealCount(result, round?.revealedCount ?? 0)
  const presentationPhase =
    requestedPresentationPhase ??
    (round ? (revealedCount > 0 ? 'revealing' : 'dealing') : 'betting')
  const openingDealtCount = Math.max(
    safeCount(requestedOpeningDealtCount, OPENING_DEAL.length),
    // Any public reveal proves that the full P/B/P/B opening deal landed first.
    revealedCount > 0 ? OPENING_DEAL.length : 0,
  )
  const openingHandsRevealed = result !== null && revealedCount >= 4
  const revealComplete =
    result !== null && revealedCount === result.dealOrder.length
  const playerHasThirdCard = result?.playerCards.length === 3
  const bankerHasThirdCard = result?.bankerCards.length === 3
  const bankerDecisionPublic =
    openingHandsRevealed &&
    // If Player drew, Banker depends on that still-hidden third card. If Player
    // stood, the opening totals alone determine Banker's action.
    (!playerHasThirdCard || revealedCount >= 5)
  const settlementActions = new Set<DealerProcedureWagerAction>(
    requestedSettlementActions ?? ['collect', 'push', 'pay'],
  )

  const drafts: DealerProcedureStepDraft[] = [
    { id: 'place-bets', kind: 'place-bets' },
    { id: 'no-more-bets', kind: 'no-more-bets' },
    ...OPENING_DEAL.map(
      ({ id, side, handCardNumber }): DealerProcedureStepDraft => ({
        id,
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

  if (bankerDecisionPublic && bankerHasThirdCard) {
    drafts.push({
      id: 'deal-banker-third-card',
      kind: 'deal-banker-third-card',
      side: 'banker',
      handCardNumber: 3,
    })
  }

  drafts.push({
    id: 'announce-final-result',
    kind: 'announce-final-result',
    announcement:
      result && revealComplete
        ? {
            kind: 'final-result',
            playerTotal: result.playerTotal,
            bankerTotal: result.bankerTotal,
            winner: result.winner,
          }
        : undefined,
  })
  if (settlementActions.has('collect')) {
    drafts.push({
      id: 'collect-losing-wagers',
      kind: 'collect-losing-wagers',
    })
  }
  if (settlementActions.has('push')) {
    drafts.push({
      id: 'return-pushed-wagers',
      kind: 'return-pushed-wagers',
    })
  }
  if (settlementActions.has('pay')) {
    drafts.push({ id: 'pay-winning-wagers', kind: 'pay-winning-wagers' })
  }
  drafts.push(
    { id: 'record-road', kind: 'record-road' },
    {
      id: 'sweep-cards-to-discard-tray',
      kind: 'sweep-cards-to-discard-tray',
    },
    { id: 'open-next-round', kind: 'open-next-round' },
  )

  const revealStepId = activeRevealStep({
    openingDealtCount,
    openingHandsRevealed,
    initialPointsAnnounced,
    playerHasThirdCard,
    bankerHasThirdCard,
    bankerDecisionPublic,
    revealedCount,
    revealComplete,
  })

  let activeStepId: DealerProcedureStepId
  switch (presentationPhase) {
    case 'betting':
      activeStepId = 'place-bets'
      break
    case 'no-more-bets':
      activeStepId = 'no-more-bets'
      break
    case 'dealing':
      activeStepId =
        openingDealtCount < OPENING_DEAL.length
          ? OPENING_DEAL[openingDealtCount].id
          : 'reveal-opening-hands'
      break
    case 'settling':
      activeStepId = revealComplete
        ? activeSettlementStep(settlementState, settlementActions)
        : revealStepId
      break
    case 'revealing':
      activeStepId = revealStepId
      break
  }

  return {
    steps: withStepStatuses(drafts, activeStepId),
    activeStepId,
    presentationPhase,
    openingDealtCount,
    initialPointsAnnounced,
    revealedCount,
    revealComplete,
  }
}
