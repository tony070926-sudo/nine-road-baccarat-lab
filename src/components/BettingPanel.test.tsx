import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { rebuildWagerChipLedger } from '../game/chipPhysics'
import { BettingPanel } from './BettingPanel'

describe('BettingPanel settlement presentation', () => {
  it('shows committed balance without subtracting the frozen wager again', () => {
    const bets = {
      player: 100,
      banker: 0,
      tie: 0,
      playerPair: 0,
      bankerPair: 0,
    }
    const markup = renderToStaticMarkup(
      <BettingPanel
        bets={bets}
        wagerChipLedger={rebuildWagerChipLedger(bets)}
        balance={9_800}
        selectedChip={100}
        isDealing
        isSettling
        dealingMode="bet"
        error={null}
        hasLastBets
        onSelectChip={vi.fn()}
        onAddBet={vi.fn(() => true)}
        onClear={vi.fn()}
        onRepeat={vi.fn()}
        onFly={vi.fn()}
        onDeal={vi.fn()}
      />,
    )

    expect(markup).toContain('data-betting-phase="settling"')
    expect(markup).toContain('结算后余额')
    expect(markup).toContain('9,800')
    expect(markup).not.toContain('下注后可用')
    expect(markup).toContain('data-chip-stack-anchor="player"')
  })
})
