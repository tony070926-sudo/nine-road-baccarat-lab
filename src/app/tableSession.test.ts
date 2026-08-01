import { describe, expect, it } from 'vitest'
import type { PersistedPendingRound, PlayMode } from '../types'
import {
  EMPTY_BETS,
  createSeededRandomInt,
  createShoe,
  dealRound,
} from '../game/baccarat'
import { pendingRoundFromPersisted } from './tableSession'

function storedPending(playMode: PlayMode): PersistedPendingRound {
  const sourceShoe = createShoe(
    createSeededRandomInt(20260802),
    'SESSION-REVEAL-CONTROL',
  )
  const dealt = dealRound(sourceShoe)
  return {
    version: 1,
    id: `session-${playMode}`,
    playMode,
    bets:
      playMode === 'fly'
        ? { ...EMPTY_BETS }
        : { ...EMPTY_BETS, player: 100 },
    balanceBefore: 10_000,
    sourceShoeId: sourceShoe.id,
    sourceCursor: sourceShoe.cursor,
    shoeAfter: dealt.shoe,
    result: dealt.result,
    revealedCount: 0,
  }
}

describe('pendingRoundFromPersisted', () => {
  it('normalizes legacy reveal control defaults by play mode', () => {
    expect(
      pendingRoundFromPersisted(storedPending('bet')).revealControl,
    ).toBe('player-squeeze')
    expect(
      pendingRoundFromPersisted(storedPending('fly')).revealControl,
    ).toBe('dealer-reveal')
  })

  it('preserves an explicit dealer reveal choice for a wagered round', () => {
    expect(
      pendingRoundFromPersisted({
        ...storedPending('bet'),
        revealControl: 'dealer-reveal',
      }).revealControl,
    ).toBe('dealer-reveal')
  })
})
