import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_BETS,
  createSeededRandomInt,
  createShoe,
  dealRound,
} from '../game/baccarat'
import type { PendingRound } from '../types'
import { TableDealerHeader } from './TableDealerHeader'

function pendingRound(): PendingRound {
  const shoe = createShoe(createSeededRandomInt(17), 'HEADER-SHOE')
  const dealt = dealRound(shoe)
  return {
    id: 'header-round',
    playMode: 'bet',
    revealControl: 'player-squeeze',
    bets: { ...EMPTY_BETS, player: 100 },
    balanceBefore: 10_000,
    sourceShoeId: shoe.id,
    sourceCursor: shoe.cursor,
    shoeAfter: dealt.shoe,
    result: dealt.result,
  }
}

function renderHeader(phase: {
  pointCallActive: boolean
  physicalDealActive: boolean
  roundComplete?: boolean
}): string {
  return renderToStaticMarkup(
    <TableDealerHeader
      settlementHeading={null}
      settlementStatus={null}
      newShoeMotion={null}
      roundRequesting={false}
      roundPrelude={null}
      pendingRound={pendingRound()}
      pointCallActive={phase.pointCallActive}
      physicalDealActive={phase.physicalDealActive}
      roundComplete={phase.roundComplete ?? false}
      flippingCardId={null}
      revealActor={null}
      pendingNextRequiresUser
      pendingNextSide="player"
      settledRound={null}
      pendingManualSides={['player']}
      revealedCount={4}
      revealDisplayTotal={5}
      records={[]}
    />,
  )
}

describe('TableDealerHeader', () => {
  it('keeps the opening point call ahead of deal and player prompts', () => {
    const markup = renderHeader({
      pointCallActive: true,
      physicalDealActive: false,
    })
    expect(markup).toContain('荷官宣读开局点数')
    expect(markup).toContain('开局报点')
    expect(markup).toContain('报点中')
    expect(markup).not.toContain('请开')
    expect(markup).not.toContain('荷官正在发牌')
  })

  it('keeps a physical deal ahead of the player prompt', () => {
    const markup = renderHeader({
      pointCallActive: false,
      physicalDealActive: true,
    })
    expect(markup).toContain('荷官正在发牌')
    expect(markup).toContain('按顺序发牌')
    expect(markup).toContain('发牌中')
    expect(markup).not.toContain('请开')
  })

  it('shows the player prompt only after both procedural gates clear', () => {
    const markup = renderHeader({
      pointCallActive: false,
      physicalDealActive: false,
    })
    expect(markup).toContain('请开闲家牌')
  })

  it('announces the final result instead of reopening a completed hand', () => {
    const markup = renderHeader({
      pointCallActive: false,
      physicalDealActive: false,
      roundComplete: true,
    })
    expect(markup).toContain('荷官宣读最终结果')
    expect(markup).toContain('最终报点')
    expect(markup).toContain('结果确认中')
    expect(markup).not.toContain('请开')
  })
})
