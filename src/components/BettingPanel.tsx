import { Fragment } from 'react'
import { CircleDollarSign, Eye, RotateCcw, Trash2 } from 'lucide-react'
import { ChipDragLayer } from './ChipDragLayer'
import { ChipStackVisual } from './ChipStackVisual'
import { TABLE_LIMITS, totalBets } from '../game/baccarat'
import type { WagerChipLedger } from '../game/chipPhysics'
import type { Bets, PlayMode } from '../types'

const BET_LABELS: Record<keyof Bets, string> = {
  player: '闲',
  banker: '庄',
  tie: '和',
  playerPair: '闲对',
  bankerPair: '庄对',
}

const CHIPS = [10, 50, 100, 500, 1_000]

const BET_OPTIONS: Array<{
  key: keyof Bets
  odds: string
  className: string
}> = [
  { key: 'playerPair', odds: '11 : 1', className: 'bet-player-pair' },
  { key: 'bankerPair', odds: '11 : 1', className: 'bet-banker-pair' },
  { key: 'player', odds: '1 : 1', className: 'bet-player' },
  { key: 'tie', odds: '8 : 1', className: 'bet-tie' },
  { key: 'banker', odds: '0.95 : 1', className: 'bet-banker' },
]

interface BettingPanelProps {
  bets: Bets
  wagerChipLedger: WagerChipLedger
  balance: number
  selectedChip: number
  isDealing: boolean
  isSettling: boolean
  dealingMode: PlayMode | null
  error: string | null
  hasLastBets: boolean
  onSelectChip: (chip: number) => void
  onAddBet: (
    target: keyof Bets,
    amount: number,
    source: 'tap' | 'drag',
  ) => boolean
  onRemoveLastBet: (target: keyof Bets) => boolean | void
  onClear: () => void
  onRepeat: () => void
  onFly: () => void
  onDeal: () => void
}

function formatPoints(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatCompactLimit(value: number): string {
  return value >= 1_000 ? `${value / 1_000}K` : String(value)
}

export function BettingPanel({
  bets,
  wagerChipLedger,
  balance,
  selectedChip,
  isDealing,
  isSettling,
  dealingMode,
  error,
  hasLastBets,
  onSelectChip,
  onAddBet,
  onRemoveLastBet,
  onClear,
  onRepeat,
  onFly,
  onDeal,
}: BettingPanelProps) {
  const stake = totalBets(bets)

  return (
    <aside
      className="betting-panel casino-betting-layer"
      aria-label="模拟下注区"
      data-betting-phase={isSettling ? 'settling' : isDealing ? 'locked' : 'betting'}
    >
      <div className="felt-betting-heading">
        <div>
          <span className="dealer-call-dot" aria-hidden="true" />
          <p>
            <span className="betting-call-secondary">
              {isDealing ? 'NO MORE BETS · ' : 'PLACE YOUR BETS · '}
            </span>
            {isDealing ? '停止下注' : '请将筹码放到下注区'}
          </p>
        </div>
        <div className="table-credit" aria-live="polite">
          <span>模拟积分 · 不可兑换</span>
          <strong>{formatPoints(balance)}</strong>
        </div>
      </div>

      <div className="bet-grid felt-bet-grid">
        {BET_OPTIONS.map((option) => {
          const limit = TABLE_LIMITS[option.key]
          const limitLabel =
            `${limit.min.toLocaleString('zh-CN')} 至 ` +
            `${limit.max.toLocaleString('zh-CN')} 分，每次 ` +
            `${limit.step.toLocaleString('zh-CN')} 分`
          const lastChip = wagerChipLedger[option.key].at(-1)

          return (
            <Fragment key={option.key}>
              <button
                className={`bet-zone ${option.className} ${bets[option.key] > 0 ? 'has-bet' : ''}`}
                onClick={() => onAddBet(option.key, selectedChip, 'tap')}
                disabled={isDealing}
                data-bet-target={option.key}
                data-chip-drop-target={option.key}
                aria-label={`下注${BET_LABELS[option.key]}，当前 ${bets[option.key]} 分，限额 ${limitLabel}`}
              >
                <span className="bet-zone-label">
                  {BET_LABELS[option.key]}
                  {option.key === 'player' && <small>PLAYER</small>}
                  {option.key === 'banker' && <small>BANKER</small>}
                  {option.key === 'tie' && <small>TIE</small>}
                </span>
                <span className="bet-zone-meta">
                  <span className="bet-zone-odds">{option.odds}</span>
                  <small>
                    限额 {formatCompactLimit(limit.min)}–{formatCompactLimit(limit.max)}
                  </small>
                </span>
                <span
                  className="table-chip-anchor"
                  data-chip-stack-anchor={option.key}
                  aria-hidden="true"
                >
                  {bets[option.key] > 0 && (
                    <ChipStackVisual
                      amount={bets[option.key]}
                      chips={wagerChipLedger[option.key]}
                      className="placed-chip table-chip-stack"
                    />
                  )}
                </span>
              </button>
              <button
                type="button"
                className="bet-zone-undo"
                style={{ gridArea: option.key }}
                onClick={() => onRemoveLastBet(option.key)}
                disabled={isDealing || lastChip === undefined}
                data-remove-last-chip={option.key}
                data-last-chip-value={lastChip}
                aria-label={
                  lastChip === undefined
                    ? `${BET_LABELS[option.key]}下注区没有可撤回筹码`
                    : `撤回${BET_LABELS[option.key]}最后一枚筹码，${formatPoints(lastChip)} 分`
                }
              >
                <RotateCcw size={12} aria-hidden="true" />
                <span aria-hidden="true">
                  {lastChip === undefined ? '—' : formatCompactLimit(lastChip)}
                </span>
              </button>
            </Fragment>
          )
        })}
      </div>

      <div className="player-rail">
        <div className="rail-actions rail-actions-left">
          <button className="table-tool-button" onClick={onClear} disabled={isDealing || stake === 0}>
            <Trash2 size={16} />
            清桌
          </button>
          <button
            className="table-tool-button"
            onClick={onRepeat}
            disabled={isDealing || !hasLastBets}
          >
            <RotateCcw size={16} />
            重复
          </button>
        </div>

        <div className="chip-rack-console">
          <div>
            <span className="chip-rack-label">选择筹码</span>
            <div className="chip-rack" role="radiogroup" aria-label="选择筹码">
              {CHIPS.map((chip, index) => (
                <button
                  key={chip}
                  className={`chip chip-${index + 1} ${selectedChip === chip ? 'is-selected' : ''}`}
                  onClick={() => onSelectChip(chip)}
                  role="radio"
                  aria-checked={selectedChip === chip}
                  disabled={isDealing}
                >
                  <span>{chip >= 1_000 ? `${chip / 1_000}K` : chip}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="physical-chip-drag-source">
            <span>拖到下注区</span>
            <ChipDragLayer
              enabled={!isDealing}
              selectedValue={selectedChip}
              balance={balance}
              currentBets={bets}
              currentWagerChips={wagerChipLedger}
              chipSize={42}
              onDrop={(target, value) => onAddBet(target, value, 'drag')}
            />
          </div>
        </div>

        <div className="rail-actions rail-actions-right">
          <button className="fly-button table-fly-button" onClick={onFly} disabled={isDealing}>
            <Eye size={17} />
            {dealingMode === 'fly' ? '飞牌中' : '飞牌旁观'}
          </button>
          <button
            className="deal-button table-deal-button"
            onClick={onDeal}
            disabled={isDealing || stake === 0}
          >
            <CircleDollarSign size={18} />
            {dealingMode === 'bet' ? '停止下注' : `确认下注 ${stake > 0 ? formatPoints(stake) : ''}`}
          </button>
        </div>
      </div>

      <div className="bet-summary table-bet-summary" aria-live="polite">
        {isSettling ? (
          <>
            <span>
              本局筹码 <strong>{formatPoints(stake)}</strong>
            </span>
            <span>
              结算后余额 <strong>{formatPoints(balance)}</strong>
            </span>
            <small>余额已提交，筹码动画仅展示结算过程</small>
          </>
        ) : (
          <>
            <span>
              本局筹码 <strong>{formatPoints(stake)}</strong>
            </span>
            <span>
              下注后可用 <strong>{formatPoints(balance - stake)}</strong>
            </span>
            <small>点击下注区，或拖动实体筹码</small>
          </>
        )}
      </div>

      {error && <p className="form-error table-form-error">{error}</p>}
    </aside>
  )
}
