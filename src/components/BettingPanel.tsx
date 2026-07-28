import { CircleDollarSign, Eye, RotateCcw, Trash2 } from 'lucide-react'
import { totalBets } from '../game/baccarat'
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
  balance: number
  selectedChip: number
  isDealing: boolean
  dealingMode: PlayMode | null
  error: string | null
  hasLastBets: boolean
  onSelectChip: (chip: number) => void
  onAddBet: (target: keyof Bets) => void
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

export function BettingPanel({
  bets,
  balance,
  selectedChip,
  isDealing,
  dealingMode,
  error,
  hasLastBets,
  onSelectChip,
  onAddBet,
  onClear,
  onRepeat,
  onFly,
  onDeal,
}: BettingPanelProps) {
  const stake = totalBets(bets)

  return (
    <aside className="betting-panel casino-betting-layer" aria-label="模拟下注区">
      <div className="felt-betting-heading">
        <div>
          <span className="dealer-call-dot" aria-hidden="true" />
          <p>{isDealing ? 'NO MORE BETS · 停止下注' : 'PLACE YOUR BETS · 请将筹码放到下注区'}</p>
        </div>
        <div className="table-credit" aria-live="polite">
          <span>模拟积分 · 不可兑换</span>
          <strong>{formatPoints(balance)}</strong>
        </div>
      </div>

      <div className="bet-grid felt-bet-grid">
        {BET_OPTIONS.map((option) => (
          <button
            key={option.key}
            className={`bet-zone ${option.className} ${bets[option.key] > 0 ? 'has-bet' : ''}`}
            onClick={() => onAddBet(option.key)}
            disabled={isDealing}
            aria-label={`下注${BET_LABELS[option.key]}，当前 ${bets[option.key]} 分`}
          >
            <span className="bet-zone-label">
              {BET_LABELS[option.key]}
              {option.key === 'player' && <small>PLAYER</small>}
              {option.key === 'banker' && <small>BANKER</small>}
              {option.key === 'tie' && <small>TIE</small>}
            </span>
            <span className="bet-zone-odds">{option.odds}</span>
            {bets[option.key] > 0 && (
              <span
                className="placed-chip table-chip-stack"
                key={`${option.key}-${bets[option.key]}`}
                aria-hidden="true"
              >
                <i />
                <i />
                <strong>{formatPoints(bets[option.key])}</strong>
              </span>
            )}
          </button>
        ))}
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
        <span>
          本局筹码 <strong>{formatPoints(stake)}</strong>
        </span>
        <span>
          下注后可用 <strong>{formatPoints(balance - stake)}</strong>
        </span>
        <small>点击筹码，再点击桌面下注区</small>
      </div>

      {error && <p className="form-error table-form-error">{error}</p>}
    </aside>
  )
}
