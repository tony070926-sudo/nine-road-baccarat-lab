import { CircleDollarSign, RotateCcw, Trash2 } from 'lucide-react'
import { totalBets } from '../game/baccarat'
import type { Bets } from '../types'

const BET_LABELS: Record<keyof Bets, string> = {
  player: '闲',
  banker: '庄',
  tie: '和',
  playerPair: '闲对',
  bankerPair: '庄对',
}

const CHIPS = [10, 50, 100, 500, 1_000]

interface BettingPanelProps {
  bets: Bets
  balance: number
  selectedChip: number
  isDealing: boolean
  error: string | null
  hasLastBets: boolean
  onSelectChip: (chip: number) => void
  onAddBet: (target: keyof Bets) => void
  onClear: () => void
  onRepeat: () => void
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
  error,
  hasLastBets,
  onSelectChip,
  onAddBet,
  onClear,
  onRepeat,
  onDeal,
}: BettingPanelProps) {
  const stake = totalBets(bets)

  const betOptions: Array<{
    key: keyof Bets
    odds: string
    hint: string
    className: string
  }> = [
    { key: 'player', odds: '净赢 1 : 1', hint: '总返还 2.00×', className: 'bet-player' },
    { key: 'tie', odds: '净赢 8 : 1', hint: '总返还 9.00×', className: 'bet-tie' },
    { key: 'banker', odds: '净赢 0.95 : 1', hint: '已扣 5% 佣金', className: 'bet-banker' },
    { key: 'playerPair', odds: '净赢 11 : 1', hint: '首两张同点数', className: 'bet-pair' },
    { key: 'bankerPair', odds: '净赢 11 : 1', hint: '首两张同点数', className: 'bet-pair' },
  ]

  return (
    <aside className="betting-panel" aria-label="模拟下注区">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">PRACTICE CHIPS</p>
          <h2>模拟下注</h2>
        </div>
        <div className="balance-block">
          <span>教学分余额</span>
          <strong>{formatPoints(balance)}</strong>
        </div>
      </div>

      <div className="bet-grid">
        {betOptions.map((option) => (
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
            <span className="bet-zone-hint">{option.hint}</span>
            {bets[option.key] > 0 && (
              <strong className="placed-chip">{formatPoints(bets[option.key])}</strong>
            )}
          </button>
        ))}
      </div>

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

      <div className="bet-summary" aria-live="polite">
        <span>
          本局投注 <strong>{formatPoints(stake)}</strong>
        </span>
        <span>
          可用余额 <strong>{formatPoints(balance - stake)}</strong>
        </span>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="bet-actions">
        <button className="secondary-button" onClick={onClear} disabled={isDealing || stake === 0}>
          <Trash2 size={16} />
          清空
        </button>
        <button
          className="secondary-button"
          onClick={onRepeat}
          disabled={isDealing || !hasLastBets}
        >
          <RotateCcw size={16} />
          重复
        </button>
        <button className="deal-button" onClick={onDeal} disabled={isDealing}>
          <CircleDollarSign size={19} />
          {isDealing ? '开牌中…' : '确认并开牌'}
        </button>
      </div>

      <p className="limit-note">
        练习桌限额：庄/闲 10–10,000 · 和/对子 10–1,000。教学分不可购买、兑换或提现。
      </p>
    </aside>
  )
}
