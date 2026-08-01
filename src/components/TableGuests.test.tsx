import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  buildTableGuestSettlementReactions,
  createTableGuests,
  type TableGuestRevealReaction,
} from '../game/tableGuests'
import { TableGuests } from './TableGuests'

const guests = createTableGuests({
  shoeId: 'component-shoe',
  handNumber: 2,
  count: 3,
})

describe('TableGuests', () => {
  it('exposes stable class and data hooks for betting intentions', () => {
    const markup = renderToStaticMarkup(
      <TableGuests guests={guests} phase="betting" />,
    )

    expect(markup).toContain('class="table-guests table-guests-betting"')
    expect(markup).toContain('data-table-guests="true"')
    expect(markup).toContain('data-guest-phase="betting"')
    expect(markup).toContain('data-guest-count="3"')
    expect(markup.match(/data-table-guest="true"/g)).toHaveLength(3)
    expect(markup).toContain('data-guest-message-kind="intent"')
  })

  it('keeps a later active guest in one of two mobile-visible slots', () => {
    const activeReaction: TableGuestRevealReaction = {
      id: 'reaction-1',
      eventId: 'event-1',
      phase: 'revealing',
      guestId: guests[2].id,
      side: 'banker',
      tone: 'surprised',
      message: '庄家对子亮了',
      messageKey: 'banker:pair',
    }
    const markup = renderToStaticMarkup(
      <TableGuests
        guests={guests}
        phase="revealing"
        activeReaction={activeReaction}
      />,
    )

    expect(markup.match(/data-guest-speaking="true"/g)).toHaveLength(1)
    expect(markup.match(/data-guest-speaking="false"/g)).toHaveLength(2)
    expect(
      markup.match(/data-guest-mobile-slot="(?:primary|secondary)"/g),
    ).toHaveLength(2)
    expect(markup.match(/data-guest-mobile-slot="hidden"/g)).toHaveLength(1)
    expect(markup).toMatch(
      new RegExp(
        `data-guest-id="${guests[2].id}"[^>]*data-guest-mobile-slot="primary"`,
      ),
    )
    expect(markup).toContain('data-guest-event="reaction-1"')
    expect(markup).toContain('庄家对子亮了')
    expect(markup).toContain('aria-live="off"')
  })

  it('maps public settlement reactions to guest outcome hooks', () => {
    const settlementReactions = buildTableGuestSettlementReactions({
      shoeId: 'component-shoe',
      handNumber: 2,
      guests,
      winner: 'banker',
      playerPair: false,
      bankerPair: false,
    })
    const markup = renderToStaticMarkup(
      <TableGuests
        guests={guests}
        phase="settled"
        settlementReactions={settlementReactions}
      />,
    )

    expect(markup).toContain('data-guest-phase="settled"')
    settlementReactions.forEach((reaction) => {
      expect(markup).toContain(`data-guest-outcome="${reaction.outcome}"`)
      expect(markup).toContain(reaction.message)
    })
  })
})
