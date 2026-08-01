import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  appendWagerChip,
  emptyWagerChipLedger,
  rebuildWagerChipLedger,
} from '../game/chipPhysics'
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
        revealControl="player-squeeze"
        canSqueeze
        error={null}
        hasLastBets
        onSelectChip={vi.fn()}
        onAddBet={vi.fn(() => true)}
        onRemoveLastBet={vi.fn(() => true)}
        onClear={vi.fn()}
        onRepeat={vi.fn()}
        onRevealControlChange={vi.fn()}
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

  it('exposes a sibling control for the actual last chip in each wager stack', () => {
    const bets = {
      player: 150,
      banker: 0,
      tie: 0,
      playerPair: 0,
      bankerPair: 0,
    }
    const wagerChipLedger = appendWagerChip(
      appendWagerChip(emptyWagerChipLedger(), 'player', 100),
      'player',
      50,
    )
    const markup = renderToStaticMarkup(
      <BettingPanel
        bets={bets}
        wagerChipLedger={wagerChipLedger}
        balance={10_000}
        selectedChip={50}
        isDealing={false}
        isSettling={false}
        dealingMode={null}
        revealControl="player-squeeze"
        canSqueeze
        error={null}
        hasLastBets={false}
        onSelectChip={vi.fn()}
        onAddBet={vi.fn(() => true)}
        onRemoveLastBet={vi.fn(() => true)}
        onClear={vi.fn()}
        onRepeat={vi.fn()}
        onRevealControlChange={vi.fn()}
        onFly={vi.fn()}
        onDeal={vi.fn()}
      />,
    )

    expect(markup).toContain('data-remove-last-chip="player"')
    expect(markup).toContain('data-last-chip-value="50"')
    expect(markup).toContain('aria-label="撤回闲最后一枚筹码，50 分"')
    expect(markup).toContain('data-remove-last-chip="banker"')
  })

  it('offers an independent, accessible card-handling choice', () => {
    const markup = renderToStaticMarkup(
      <BettingPanel
        bets={{
          player: 100,
          banker: 0,
          tie: 0,
          playerPair: 0,
          bankerPair: 0,
        }}
        wagerChipLedger={emptyWagerChipLedger()}
        balance={10_000}
        selectedChip={100}
        isDealing={false}
        isSettling={false}
        dealingMode={null}
        revealControl="dealer-reveal"
        canSqueeze
        error={null}
        hasLastBets={false}
        onSelectChip={vi.fn()}
        onAddBet={vi.fn(() => true)}
        onRemoveLastBet={vi.fn(() => true)}
        onClear={vi.fn()}
        onRepeat={vi.fn()}
        onRevealControlChange={vi.fn()}
        onFly={vi.fn()}
        onDeal={vi.fn()}
      />,
    )

    expect(markup).toContain('<legend>本局开牌方式</legend>')
    expect(markup).toContain('data-reveal-control="dealer-reveal"')
    expect(markup).toContain('value="dealer-reveal"')
    expect(markup.match(/checked=""/g)).toHaveLength(1)
    expect(markup).toContain('只改变谁开牌，不改变结果')
  })
})
