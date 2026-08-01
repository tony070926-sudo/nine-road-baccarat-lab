import { BookOpen, FlaskConical, History, Trophy } from 'lucide-react'
import type { MouseEventHandler } from 'react'

type TableDetailView = 'road' | 'history' | 'leaderboard' | 'lab' | null

interface TableDetailActionsProps {
  detailView: TableDetailView
  onChange: (view: TableDetailView) => void
  onOpenRules: MouseEventHandler<HTMLButtonElement>
}

export function TableDetailActions({
  detailView,
  onChange,
  onOpenRules,
}: TableDetailActionsProps) {
  const toggle = (view: Exclude<TableDetailView, null>) => {
    onChange(detailView === view ? null : view)
  }

  return (
    <div className="table-detail-actions">
      <button
        className={detailView === 'road' ? 'is-active' : ''}
        onClick={() => toggle('road')}
        aria-pressed={detailView === 'road'}
      >
        查看路单大屏
      </button>
      <button
        className={detailView === 'history' ? 'is-active' : ''}
        onClick={() => toggle('history')}
        aria-pressed={detailView === 'history'}
      >
        <History size={16} />
        完整牌局记录
      </button>
      <button
        className={detailView === 'leaderboard' ? 'is-active' : ''}
        onClick={() => toggle('leaderboard')}
        aria-pressed={detailView === 'leaderboard'}
      >
        <Trophy size={16} />
        自报 · 未验证排行榜
      </button>
      <button
        className={detailView === 'lab' ? 'is-active' : ''}
        onClick={() => toggle('lab')}
        aria-pressed={detailView === 'lab'}
      >
        <FlaskConical size={16} />
        概率实验室
      </button>
      <button onClick={onOpenRules}>
        <BookOpen size={16} />
        规则与真实性
      </button>
    </div>
  )
}
