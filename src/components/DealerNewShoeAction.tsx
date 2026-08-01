import type { ShoeState, Suit } from '../types'

interface DealerNewShoeActionProps {
  shoe: ShoeState | null
  mode: 'manual' | 'automatic'
}

const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
}

/**
 * Visual-only new-shoe ritual. The photographed shoe stays in the scene, so
 * the animation depicts loading a fresh pack, seating it, exposing the actual
 * indicator card, and moving the engine's full burn count to the discard tray.
 */
export function DealerNewShoeAction({
  shoe,
  mode,
}: DealerNewShoeActionProps) {
  if (!shoe) return null

  const burnCard = shoe.burnCard
  const suit = SUIT_SYMBOLS[burnCard.suit]
  const isRed = burnCard.suit === 'hearts' || burnCard.suit === 'diamonds'
  const additionalBurnedCards = Math.max(0, shoe.burnedCards - 1)

  return (
    <div
      className="dealer-new-shoe-action"
      data-dealer-new-shoe={mode}
      role="status"
      aria-label={`新牌靴亮出 ${burnCard.rank}${suit}，随后再销 ${additionalBurnedCards} 张，共销 ${shoe.burnedCards} 张`}
    >
      <span className="dealer-new-card-pack">
        <i />
        <i />
        <i />
      </span>
      <span
        className={`dealer-burn-card ${isRed ? 'is-red' : ''}`}
        data-burn-rank={burnCard.rank}
        data-burn-count={shoe.burnedCards}
        aria-hidden="true"
      >
        <span>
          <b>{burnCard.rank}</b>
          <em>{suit}</em>
        </span>
      </span>
      <span className="dealer-burn-tray" aria-hidden="true">
        <strong>{shoe.burnedCards}</strong>
        <small>销牌</small>
      </span>
    </div>
  )
}
