import { casinoAudio } from '../audio/casinoAudio'
import type { TableCoordinator } from '../game/tableCoordinator'
import type { PersistedTableEnvelopeV2 } from '../game/tableState'
import {
  focusFirstBetZone,
  type DurableSettlementCompletion,
} from './durableSettlement'

export interface BettingOpenDealerCallState {
  completionTokens: Set<string>
  roundKeys: Set<string>
}

export const BETTING_OPEN_DEALER_CALL_HISTORY_LIMIT = 128

export function createBettingOpenDealerCallState(): BettingOpenDealerCallState {
  return {
    completionTokens: new Set(),
    roundKeys: new Set(),
  }
}

function rememberRecentValue(values: Set<string>, value: string): void {
  values.add(value)
  if (values.size <= BETTING_OPEN_DEALER_CALL_HISTORY_LIMIT) return

  const oldestValue = values.values().next().value
  if (oldestValue !== undefined) values.delete(oldestValue)
}

/**
 * Atomically consumes one locally committed settlement-completion event before
 * its optional voice enhancement is attempted. Hydration, passive adoption and
 * a competing writer's already-complete snapshot must never open the microphone.
 */
export function consumeBettingOpenDealerCallEvent(
  state: BettingOpenDealerCallState,
  input: {
    completionStatus: 'committed' | 'already-complete'
    roundId: string
    writerId: string
    snapshot: Pick<
      PersistedTableEnvelopeV2,
      | 'commitId'
      | 'game'
      | 'lastMutation'
      | 'lastWriterId'
      | 'pending'
      | 'presentationPending'
      | 'revision'
    >
  },
): string | null {
  const { completionStatus, roundId, snapshot, writerId } = input
  if (
    completionStatus !== 'committed' ||
    snapshot.lastMutation !== 'complete-presentation' ||
    snapshot.lastWriterId !== writerId ||
    snapshot.pending !== null ||
    snapshot.presentationPending != null ||
    snapshot.game.history.at(-1)?.id !== roundId
  ) {
    return null
  }

  const { id: shoeId, handNumber } = snapshot.game.shoe
  const completionToken = `${roundId}:${snapshot.revision}:${snapshot.commitId}`
  const roundKey = `${shoeId}:hand-${handNumber}`
  if (
    state.completionTokens.has(completionToken) ||
    state.roundKeys.has(roundKey)
  ) {
    return null
  }

  // Set iteration order is insertion order, so each collection doubles as a
  // bounded FIFO while the synchronous pair of writes remains one consume.
  rememberRecentValue(state.completionTokens, completionToken)
  rememberRecentValue(state.roundKeys, roundKey)
  return `betting-open:${roundKey}:${completionToken}`
}

type SuccessfulSettlementCompletion = Extract<
  DurableSettlementCompletion,
  { status: 'committed' | 'already-complete' }
>

const callStateByCoordinator = new WeakMap<
  TableCoordinator,
  BettingOpenDealerCallState
>()

/** Call only after the owner has released its table lease. */
export function presentLocallyCompletedBettingOpen(
  coordinator: TableCoordinator,
  completion: SuccessfulSettlementCompletion,
  roundId: string,
): void {
  focusFirstBetZone()
  if (completion.status !== 'committed') return

  let state = callStateByCoordinator.get(coordinator)
  if (!state) {
    state = createBettingOpenDealerCallState()
    callStateByCoordinator.set(coordinator, state)
  }
  const eventId = consumeBettingOpenDealerCallEvent(state, {
    completionStatus: completion.status,
    roundId,
    writerId: coordinator.writerId,
    snapshot: completion.snapshot,
  })
  if (!eventId) return

  void casinoAudio.playDealerCall(eventId, '请下注')
}
