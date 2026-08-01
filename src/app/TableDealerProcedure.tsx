import { useMemo } from 'react'
import { DealerProcedureTrack } from '../components/DealerProcedureTrack'
import { buildDealerProcedurePlan } from '../game/dealerProcedure'
import type { SettlementActionKind } from '../game/settlementMotion'
import { openingDealCardIds } from '../game/reveal'
import type { PendingRound, RoundRecord } from '../types'
import type { RoundPrelude } from './tableTypes'
import type { SettlementPresentation } from './useSettlementPresentation'

interface TableDealerProcedureProps {
  pendingRound: PendingRound | null
  roundPrelude: RoundPrelude | null
  settledRound: RoundRecord | null
  settlementPresentation: SettlementPresentation | null
  revealedCount: number
  dealtCardIds: Set<string>
  roundReady: boolean
  roundRequesting: boolean
  initialPointsAnnouncedRoundId: string | null
  settlementActions?: readonly SettlementActionKind[]
}

export function TableDealerProcedure({
  pendingRound,
  roundPrelude,
  settledRound,
  settlementPresentation,
  revealedCount,
  dealtCardIds,
  roundReady,
  roundRequesting,
  initialPointsAnnouncedRoundId,
  settlementActions,
}: TableDealerProcedureProps) {
  const plan = useMemo(() => {
    const procedureResult =
      pendingRound?.result ??
      roundPrelude?.pending.result ??
      (settlementPresentation ? settledRound : null)
    const procedureRevealedCount = pendingRound
      ? revealedCount
      : procedureResult && settlementPresentation
        ? procedureResult.dealOrder.length
        : 0
    const openingDealtCount = pendingRound
      ? openingDealCardIds(pendingRound.result).filter((cardId) =>
          dealtCardIds.has(cardId),
        ).length
      : settlementPresentation
        ? 4
        : 0
    const openingDealInProgress =
      Boolean(pendingRound) && !roundReady && openingDealtCount < 4

    return buildDealerProcedurePlan({
      round: procedureResult
        ? { result: procedureResult, revealedCount: procedureRevealedCount }
        : null,
      presentationPhase: settlementPresentation
        ? 'settling'
        : roundRequesting || roundPrelude
          ? 'no-more-bets'
          : pendingRound
            ? openingDealInProgress
              ? 'dealing'
              : 'revealing'
            : 'betting',
      openingDealtCount,
      initialPointsAnnounced: Boolean(
        settlementPresentation ||
        (pendingRound && initialPointsAnnouncedRoundId === pendingRound.id),
      ),
      settlementState: settlementPresentation?.state,
      settlementActions,
    })
  }, [
    dealtCardIds,
    pendingRound,
    revealedCount,
    roundPrelude,
    roundReady,
    roundRequesting,
    settledRound,
    settlementPresentation,
    initialPointsAnnouncedRoundId,
    settlementActions,
  ])

  return (
    <DealerProcedureTrack
      plan={plan}
      className="table-dealer-procedure"
    />
  )
}
