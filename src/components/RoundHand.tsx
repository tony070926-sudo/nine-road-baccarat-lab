import type { DealMotionToken } from '../game/motion'
import type { PendingRound, RoundRecord } from '../types'
import {
  PlayingCard,
  RevealPlayingCard,
  type RevealInputMethod,
} from './PlayingCard'

export type SettledCardState = 'shown' | 'sweeping' | 'cleared'

interface RoundHandProps {
  side: 'player' | 'banker'
  settledRound: RoundRecord | null
  pendingRound: PendingRound | null
  roundReady: boolean
  visibleCardIds: Set<string>
  dealtCardIds: Set<string>
  activeDealMotion: DealMotionToken | null
  completedCardIds: Set<string>
  nextCardId: string | null
  nextCardRequiresUser: boolean
  flippingCardId: string | null
  revealActor: 'user' | 'dealer' | null
  pendingTotal: number | null
  settledCardState?: SettledCardState
  onFlip: (cardId: string, inputMethod: RevealInputMethod) => void
  onFlipComplete: (cardId: string) => void
  onDealComplete: (motion: DealMotionToken) => void
}

export function RoundHand({
  side,
  settledRound,
  pendingRound,
  roundReady,
  visibleCardIds,
  dealtCardIds,
  activeDealMotion,
  completedCardIds,
  nextCardId,
  nextCardRequiresUser,
  flippingCardId,
  revealActor,
  pendingTotal,
  settledCardState = 'shown',
  onFlip,
  onFlipComplete,
  onDealComplete,
}: RoundHandProps) {
  const isPlayer = side === 'player'
  const sideLabel = isPlayer ? '闲' : '庄'
  const sideEnglish = isPlayer ? 'PLAYER' : 'BANKER'
  const pendingCards = pendingRound
    ? isPlayer
      ? pendingRound.result.playerCards
      : pendingRound.result.bankerCards
    : []
  const settledCards = settledRound
    ? isPlayer
      ? settledRound.playerCards
      : settledRound.bankerCards
    : []
  const visiblePendingCards = pendingCards.filter((card) =>
    visibleCardIds.has(card.id),
  )
  const revealedSideCount = pendingCards.filter((card) =>
    completedCardIds.has(card.id),
  ).length
  const thirdCard = pendingCards[2] ?? null
  const isThirdCardStage = Boolean(
    thirdCard &&
      (nextCardId === thirdCard.id || flippingCardId === thirdCard.id),
  )
  const settledTotal = settledRound
    ? isPlayer
      ? settledRound.playerTotal
      : settledRound.bankerTotal
    : null
  const pair = settledRound
    ? isPlayer
      ? settledRound.playerPair
      : settledRound.bankerPair
    : false

  return (
    <div
      className={`hand hand-${side} ${pendingRound ? 'is-revealing' : ''} ${
        isThirdCardStage ? 'is-third-card-stage' : ''
      }`}
      data-hand-phase={isThirdCardStage ? 'third-card' : 'opening'}
      data-settled-card-state={
        settledRound && !pendingRound ? settledCardState : undefined
      }
    >
      <div className="hand-label">
        <span>
          {sideLabel} <small>{sideEnglish}</small>
        </span>
        <strong>
          {pendingRound ? (pendingTotal ?? '—') : (settledTotal ?? '—')}
          <small> 点</small>
        </strong>
      </div>

      <div
        className={`cards-row ${isThirdCardStage ? 'is-third-card-stage' : ''} ${
          !pendingRound && settledCardState === 'cleared' ? 'is-cleared' : ''
        }`}
      >
        {pendingRound ? (
          visiblePendingCards.map((card, index) => {
            const isFlipping = flippingCardId === card.id
            const dealMotion =
              activeDealMotion?.cardId === card.id
                ? activeDealMotion
                : null
            const isPlaced = dealtCardIds.has(card.id)
            return (
              <RevealPlayingCard
                card={card}
                index={index}
                dealIndex={pendingRound.result.dealOrder.findIndex(
                  (dealtCard) => dealtCard.id === card.id,
                )}
                side={side}
                faceUp={completedCardIds.has(card.id) || isFlipping}
                canFlip={
                  roundReady &&
                  isPlaced &&
                  nextCardId === card.id &&
                  nextCardRequiresUser &&
                  !flippingCardId
                }
                isFlipping={isFlipping}
                isAutomatic={isFlipping && revealActor === 'dealer'}
                isPlaced={isPlaced}
                dealMotion={dealMotion}
                willAutoFlip={
                  roundReady &&
                  isPlaced &&
                  nextCardId === card.id &&
                  !nextCardRequiresUser &&
                  !flippingCardId
                }
                parkedForThirdCard={index < 2 && isThirdCardStage}
                onFlip={onFlip}
                onFlipComplete={onFlipComplete}
                onDealComplete={onDealComplete}
                key={card.id}
              />
            )
          })
        ) : settledRound && settledCardState === 'cleared' ? (
          <span className="cards-cleared-marker" data-round-cards-cleared>
            牌面已收入弃牌盒
          </span>
        ) : settledRound ? (
          settledCards.map((card, index) => (
            <span
              className="settled-card-motion-shell"
              data-table-card-id={card.id}
              key={card.id}
            >
              <PlayingCard card={card} index={index} />
            </span>
          ))
        ) : null}
      </div>

      <div className="hand-tags">
        {pendingRound ? (
          <span className="reveal-side-note">
            {isThirdCardStage
              ? '增牌单独观看 · 首两张已收拢'
              : `已翻 ${revealedSideCount} / ${visiblePendingCards.length}`}
          </span>
        ) : settledRound && settledCardState === 'cleared' ? (
          <span>桌面已清</span>
        ) : (
          <>
            {settledRound?.natural && <span>自然牌</span>}
            {pair && <span>{sideLabel}对</span>}
            {settledCards.length === 3 && <span>补第三张</span>}
          </>
        )}
      </div>
    </div>
  )
}
