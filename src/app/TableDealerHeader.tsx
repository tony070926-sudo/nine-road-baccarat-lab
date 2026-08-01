import type {
  NewShoeMotion,
  RevealActor,
  RoundPrelude,
} from './tableTypes'
import {
  formatNumber,
  outcomeLabel,
  revealScopeLabel,
  revealSideLabel,
} from './tableUi'
import { isFlyRound } from '../game/records'
import { resolveRevealControl, type RevealSide } from '../game/reveal'
import type { PendingRound, RoundRecord } from '../types'
import { DealerRoadPanel } from '../components/RoadBoard'

interface TableDealerHeaderProps {
  settlementHeading: string | null
  settlementStatus: string | null
  newShoeMotion: NewShoeMotion | null
  roundRequesting: boolean
  roundPrelude: RoundPrelude | null
  pendingRound: PendingRound | null
  roundReady: boolean
  flippingCardId: string | null
  revealActor: RevealActor | null
  pendingNextRequiresUser: boolean
  pendingNextSide: RevealSide | null
  settledRound: RoundRecord | null
  pendingManualSides: RevealSide[]
  revealedCount: number
  revealDisplayTotal: number
  records: RoundRecord[]
}

export function TableDealerHeader({
  settlementHeading,
  settlementStatus,
  newShoeMotion,
  roundRequesting,
  roundPrelude,
  pendingRound,
  roundReady,
  flippingCardId,
  revealActor,
  pendingNextRequiresUser,
  pendingNextSide,
  settledRound,
  pendingManualSides,
  revealedCount,
  revealDisplayTotal,
  records,
}: TableDealerHeaderProps) {
  const heading = settlementHeading
    ?? (newShoeMotion
      ? '荷官正在更换牌靴'
      : roundRequesting
        ? '正在锁定牌桌'
        : roundPrelude
          ? '停止下注'
          : pendingRound
            ? !roundReady
              ? '荷官正在发牌'
              : flippingCardId
                ? revealActor === 'dealer'
                  ? '荷官正在开牌'
                  : '请翻开牌面'
                : pendingNextRequiresUser
                  ? `请开${pendingNextSide ? revealSideLabel(pendingNextSide) : ''}牌`
                  : '荷官正在开牌'
            : settledRound
              ? outcomeLabel(settledRound.winner)
              : '请下注')

  return (
    <>
      <div className="table-stage-heading dealer-call-panel">
        <div>
          <p className="eyebrow">LIVE DEALER · 第一视角</p>
          <h2>{heading}</h2>
        </div>
        {newShoeMotion ? (
          <div className="round-net reveal-progress">
            <span>
              {newShoeMotion.mode === 'automatic' ? '自动换靴' : '手动换靴'}
            </span>
            <strong>
              亮 {newShoeMotion.shoe.burnCard.rank} · 共销{' '}
              {newShoeMotion.shoe.burnedCards} 张
            </strong>
          </div>
        ) : roundRequesting ? (
          <div className="round-net reveal-progress">
            <span>正在取得独占控制</span>
            <strong>LOCKING TABLE</strong>
          </div>
        ) : roundPrelude ? (
          <div className="round-net reveal-progress">
            <span>
              {roundPrelude.playMode === 'fly'
                ? '飞牌 · 无下注'
                : resolveRevealControl(roundPrelude.pending) === 'dealer-reveal'
                  ? '荷官开牌 · 已锁注'
                  : '自己咪牌 · 已锁注'}
            </span>
            <strong>NO MORE BETS</strong>
          </div>
        ) : pendingRound ? (
          <div className="round-net reveal-progress">
            <span>
              {!roundReady
                ? '按顺序发牌'
                : pendingRound.playMode === 'fly'
                  ? '飞牌 · 自动'
                  : revealScopeLabel(pendingManualSides)}
            </span>
            <strong>{revealedCount} / {revealDisplayTotal}</strong>
          </div>
        ) : settledRound ? (
          <div
            className={`round-net ${
              isFlyRound(settledRound)
                ? 'fly'
                : settledRound.settlement.net >= 0
                  ? 'positive'
                  : 'negative'
            }`}
          >
            <span>{isFlyRound(settledRound) ? '飞牌结果' : '本局净输赢'}</span>
            <strong>
              {isFlyRound(settledRound)
                ? '已写入路单'
                : `${settledRound.settlement.net > 0 ? '+' : ''}${formatNumber(
                    settledRound.settlement.net,
                  )}`}
            </strong>
          </div>
        ) : (
          <div className="round-net table-ready-badge">
            <span>8 副真实牌靴</span>
            <strong>BETTING OPEN</strong>
          </div>
        )}
      </div>

      <div className="dealer-sightline">
        <DealerRoadPanel records={records} />
        <span aria-hidden="true">
          <i />
          荷官
          <strong>
            {settlementStatus
              ?? (newShoeMotion
                ? '烧牌中'
                : roundRequesting
                  ? '锁桌中'
                  : roundPrelude
                    ? '停止下注'
                    : pendingRound
                      ? !roundReady
                        ? '发牌中'
                        : '牌局进行中'
                      : '等待下注')}
          </strong>
        </span>
      </div>
    </>
  )
}
