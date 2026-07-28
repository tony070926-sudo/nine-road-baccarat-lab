import { memo, useEffect, useMemo, useRef } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import {
  buildBeadPlate,
  buildBigRoad,
  buildDerivedRoad,
  roadColumnCount,
} from '../game/roads'
import type { BigRoadCell, RoadCell, RoadColor, RoundRecord, Winner } from '../types'

interface RoadBoardProps {
  records: RoundRecord[]
  fullscreen: boolean
  onToggleFullscreen: () => void
}

interface GridProps<T extends string> {
  title: string
  subtitle: string
  cells: Array<RoadCell<T>>
  columns?: number
  kind: 'bead' | 'big' | 'eye' | 'small' | 'cockroach'
  records?: RoundRecord[]
  bigCells?: BigRoadCell[]
  className?: string
  autoFollowKey?: number
  emptyLabel?: string
}

function OutcomeMark({
  winner,
  record,
}: {
  winner: Winner
  record: RoundRecord | undefined
}) {
  const label = winner === 'banker' ? '庄' : winner === 'player' ? '闲' : '和'
  return (
    <span className={`bead-mark bead-${winner}`} title={label}>
      <span>{label}</span>
      {record?.bankerPair && <i className="pair-dot pair-banker" title="庄对" />}
      {record?.playerPair && <i className="pair-dot pair-player" title="闲对" />}
    </span>
  )
}

function MainRoadMark({ cell }: { cell: BigRoadCell }) {
  const label =
    cell.value === 'banker'
      ? '庄'
      : cell.value === 'player'
        ? '闲'
        : '开局和'

  return (
    <span
      className={`main-road-mark main-${cell.value}`}
      title={`${label}${cell.tieCount ? ` · 和×${cell.tieCount}` : ''}`}
    >
      {cell.tieCount > 0 && (
        <>
          <i className="tie-slash" />
          {cell.tieCount > 1 && <b className="tie-count">{cell.tieCount}</b>}
        </>
      )}
      {cell.bankerPair && <i className="pair-dot pair-banker" title="庄对" />}
      {cell.playerPair && <i className="pair-dot pair-player" title="闲对" />}
    </span>
  )
}

function DerivedMark({
  color,
  kind,
}: {
  color: RoadColor
  kind: 'eye' | 'small' | 'cockroach'
}) {
  return <span className={`derived-mark derived-${kind} is-${color}`} />
}

function RoadGrid<T extends string>({
  title,
  subtitle,
  cells,
  columns,
  kind,
  records,
  bigCells,
  className = '',
  autoFollowKey,
  emptyLabel,
}: GridProps<T>) {
  const minimumColumns = kind === 'big' ? 26 : kind === 'eye' ? 18 : 12
  const columnCount = columns ?? roadColumnCount(cells, minimumColumns)
  const gridCells = Array.from({ length: 6 * columnCount }, (_, index) => index)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoFollowKey === undefined) return
    const frame = window.requestAnimationFrame(() => {
      const scroll = scrollRef.current
      if (scroll) scroll.scrollLeft = scroll.scrollWidth - scroll.clientWidth
    })
    return () => window.cancelAnimationFrame(frame)
  }, [autoFollowKey, columnCount])

  return (
    <section className={`road-card road-card-${kind} ${className}`}>
      <header className="road-card-header">
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </header>
      <div
        ref={scrollRef}
        className="road-scroll"
        tabIndex={0}
        aria-label={`${title}，可横向滚动`}
      >
        <div
          className={`road-grid road-grid-${kind}`}
          style={{ '--road-columns': columnCount } as React.CSSProperties}
        >
          {gridCells.map((index) => (
            <span className="road-grid-cell" key={index} aria-hidden="true" />
          ))}
          {cells.map((cell, index) => (
            <span
              className="road-result-cell"
              key={`${cell.row}-${cell.col}-${index}`}
              style={{ gridRow: cell.row + 1, gridColumn: cell.col + 1 }}
            >
              {kind === 'bead' && (
                <OutcomeMark
                  winner={cell.value as Winner}
                  record={records?.[cell.sourceIndex]}
                />
              )}
              {kind === 'big' && bigCells && <MainRoadMark cell={bigCells[index]} />}
              {(kind === 'eye' || kind === 'small' || kind === 'cockroach') && (
                <DerivedMark color={cell.value as RoadColor} kind={kind} />
              )}
            </span>
          ))}
          {cells.length === 0 && emptyLabel && (
            <span className="dealer-road-empty">{emptyLabel}</span>
          )}
        </div>
      </div>
    </section>
  )
}

export const DealerRoadPanel = memo(function DealerRoadPanel({
  records,
}: {
  records: RoundRecord[]
}) {
  const big = useMemo(() => buildBigRoad(records), [records])
  const columns = roadColumnCount(big, 18)

  return (
    <RoadGrid
      title={`本靴大路 · ${records.length} 局`}
      subtitle="红庄 · 蓝闲 · 绿和"
      cells={big}
      bigCells={big}
      columns={columns}
      kind="big"
      className="dealer-road-panel"
      autoFollowKey={records.length}
      emptyLabel="等待第一局"
    />
  )
})

export function RoadBoard({ records, fullscreen, onToggleFullscreen }: RoadBoardProps) {
  const bead = buildBeadPlate(records)
  const big = buildBigRoad(records)
  const eye = buildDerivedRoad(records, 1)
  const small = buildDerivedRoad(records, 2)
  const cockroach = buildDerivedRoad(records, 3)

  const bankerCount = records.filter((record) => record.winner === 'banker').length
  const playerCount = records.filter((record) => record.winner === 'player').length
  const tieCount = records.filter((record) => record.winner === 'tie').length
  const bankerPairCount = records.filter((record) => record.bankerPair).length
  const playerPairCount = records.filter((record) => record.playerPair).length

  return (
    <section className={`road-board ${fullscreen ? 'is-fullscreen' : ''}`} id="road-board">
      <div className="section-heading road-heading">
        <div>
          <p className="eyebrow">LIVE SCOREBOARD · 当前牌靴</p>
          <h2>百家乐路单大屏</h2>
        </div>
        <div className="road-heading-actions">
          <div className="road-legend" aria-label="路单图例">
            <span>
              <i className="legend-dot legend-banker" />庄 {bankerCount}
            </span>
            <span>
              <i className="legend-dot legend-player" />闲 {playerCount}
            </span>
            <span>
              <i className="legend-dot legend-tie" />和 {tieCount}
            </span>
            <span className="pair-count">庄对 {bankerPairCount} · 闲对 {playerPairCount}</span>
          </div>
          <button
            className="icon-button"
            onClick={onToggleFullscreen}
            aria-label={fullscreen ? '退出路单大屏' : '进入路单大屏'}
            title={fullscreen ? '退出大屏' : '路单大屏'}
          >
            {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </div>

      <div className="road-layout">
        <RoadGrid
          title="大路"
          subtitle="红庄 · 蓝闲 · 绿线为和"
          cells={big}
          bigCells={big}
          kind="big"
          className="road-main"
        />
        <RoadGrid
          title="珠盘路"
          subtitle="逐局顺序"
          cells={bead}
          records={records}
          kind="bead"
          className="road-bead"
        />
        <RoadGrid
          title="大眼仔"
          subtitle="列形规律"
          cells={eye}
          kind="eye"
          className="road-eye"
        />
        <RoadGrid
          title="小路"
          subtitle="隔列比较"
          cells={small}
          kind="small"
          className="road-small"
        />
        <RoadGrid
          title="曱甴路"
          subtitle="三列回看"
          cells={cockroach}
          kind="cockroach"
          className="road-cockroach"
        />
      </div>

      <p className="road-disclaimer">
        路单只记录已经发生的结果；下三路的红蓝表示结构是否相似，不代表庄闲，也不能预测下一局。
      </p>
    </section>
  )
}
