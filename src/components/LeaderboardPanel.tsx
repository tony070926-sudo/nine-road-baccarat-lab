import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLeaderboard } from '../leaderboard/useLeaderboard'
import type {
  LeaderboardEntry,
  LeaderboardScore,
} from '../leaderboard/types'
import './LeaderboardPanel.css'

interface LeaderboardPanelProps {
  active: boolean
  currentBalance: number
  recordedHighestBalance: number
  scoreEventId: string | null
}

function formatBalance(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  }).format(value)
}

function formatAchievedAt(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

// eslint-disable-next-line react-refresh/only-export-components
export function isOwnScore(
  entry: LeaderboardEntry,
  self: LeaderboardScore | null,
): boolean {
  const selfRank = leaderboardScoreRank(self)
  return (
    self !== null &&
    (selfRank === null || entry.rank === selfRank) &&
    entry.displayName === self.displayName &&
    entry.highestBalance === self.highestBalance &&
    entry.achievedAt === self.achievedAt
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function syncStatusText(
  status: ReturnType<typeof useLeaderboard>['syncStatus'],
  hasPendingError: boolean,
): string {
  if (status === 'error' || hasPendingError) return '排行榜暂未同步'
  if (status === 'syncing') return '正在同步历史最高…'
  if (status === 'synced') return '历史最高已同步'
  return '等待新的历史最高'
}

// eslint-disable-next-line react-refresh/only-export-components
export function leaderboardScoreRank(score: LeaderboardScore | null): number | null {
  if (!score || !('rank' in score)) return null
  const rank = score.rank
  return Number.isSafeInteger(rank) && (rank as number) >= 1
    ? (rank as number)
    : null
}

function useHorizontalOverflow<T extends HTMLElement>(active: boolean) {
  const elementRef = useRef<T>(null)
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    const measure = () => {
      const next = element.scrollWidth > element.clientWidth + 1
      setHasHorizontalOverflow((current) => (current === next ? current : next))
    }
    measure()

    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(element)
    if (element.firstElementChild) observer?.observe(element.firstElementChild)
    globalThis.addEventListener?.('resize', measure)

    return () => {
      observer?.disconnect()
      globalThis.removeEventListener?.('resize', measure)
    }
  }, [active])

  return { elementRef, hasHorizontalOverflow }
}

export function LeaderboardPanel({
  active,
  currentBalance,
  recordedHighestBalance,
  scoreEventId,
}: LeaderboardPanelProps) {
  const leaderboard = useLeaderboard({
    active,
    currentBalance,
    recordedHighestBalance,
    scoreEventId,
  })
  const [nameEdit, setNameEdit] = useState({ source: '', value: '' })
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const profileDisplayName = leaderboard.profile?.displayName ?? ''
  const displayName =
    nameEdit.source === profileDisplayName ? nameEdit.value : profileDisplayName
  const { elementRef: tableScrollRef, hasHorizontalOverflow } =
    useHorizontalOverflow<HTMLDivElement>(active)

  if (!active) return null

  const ownRank = leaderboardScoreRank(leaderboard.self)

  const submitDisplayName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const error = leaderboard.saveDisplayName(displayName)
    setDisplayNameError(error)
  }

  return (
    <section
      className="leaderboard-panel"
      id="leaderboard"
      aria-labelledby="leaderboard-title"
      data-leaderboard-active="true"
    >
      <header className="leaderboard-panel__header">
        <div>
          <p className="leaderboard-panel__eyebrow">SELF-REPORTED SIMULATION RANKING</p>
          <h2 id="leaderboard-title">自报 · 未验证模拟排行榜</h2>
          <p>
            成绩由客户端匿名自报，可能被设备持有人篡改；仅供娱乐与概率教学，不可用于奖励、奖金或公平竞赛依据。模拟成绩、重置不清除历史最高。
          </p>
        </div>
        <button
          type="button"
          className="leaderboard-panel__refresh"
          onClick={leaderboard.refresh}
          disabled={leaderboard.loadStatus === 'loading'}
        >
          {leaderboard.loadStatus === 'loading' ? '刷新中…' : '刷新排名'}
        </button>
      </header>

      <div className="leaderboard-panel__account-grid">
        <form
          className="leaderboard-panel__profile"
          onSubmit={submitDisplayName}
        >
          <label htmlFor="leaderboard-display-name">排行榜昵称</label>
          <div>
            <input
              id="leaderboard-display-name"
              type="text"
              value={displayName}
              autoComplete="nickname"
              aria-describedby="leaderboard-name-help leaderboard-name-error"
              disabled={!leaderboard.profile}
              onChange={(event) => {
                setNameEdit({
                  source: profileDisplayName,
                  value: event.currentTarget.value,
                })
                setDisplayNameError(null)
              }}
            />
            <button type="submit" disabled={!leaderboard.profile}>
              保存昵称
            </button>
          </div>
          <small id="leaderboard-name-help">2–16 个字符，仅显示昵称与模拟成绩</small>
          {displayNameError && (
            <p id="leaderboard-name-error" role="alert">
              {displayNameError}
            </p>
          )}
        </form>

        <div className="leaderboard-panel__personal" aria-label="我的历史最高">
          <span>我的历史最高</span>
          <strong>
            {leaderboard.profile
              ? formatBalance(leaderboard.profile.highestBalance)
              : '准备中…'}
          </strong>
          <small>
            {ownRank
              ? `全局排名 #${ownRank}`
              : leaderboard.self
                ? '全局排名尚未返回'
                : '排名会在同步后显示'}
          </small>
        </div>

        <div
          className={`leaderboard-panel__sync leaderboard-panel__sync--${leaderboard.syncStatus}`}
          role="status"
          aria-live="polite"
        >
          <span>同步状态</span>
          <strong>
            {syncStatusText(
              leaderboard.syncStatus,
              Boolean(leaderboard.profileError || leaderboard.syncError),
            )}
          </strong>
          {(leaderboard.profileError || leaderboard.syncError) && (
            <>
              <small>{leaderboard.profileError ?? leaderboard.syncError}</small>
              {leaderboard.syncCanRetry && (
                <button type="button" onClick={leaderboard.retrySync}>
                  重试上报
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="leaderboard-panel__ranking" aria-busy={leaderboard.loadStatus === 'loading'}>
        {leaderboard.loadError && (
          <div className="leaderboard-panel__load-error" role="alert">
            <span>{leaderboard.loadError}</span>
            <button type="button" onClick={leaderboard.refresh}>
              重新加载
            </button>
          </div>
        )}

        <div
          ref={tableScrollRef}
          className="leaderboard-panel__table-scroll"
          role="region"
          aria-label="自报且未验证排行榜数据表"
          tabIndex={hasHorizontalOverflow ? 0 : undefined}
        >
          <table>
            <caption>全体玩家自报、未验证的历史最高教学分排名</caption>
            <thead>
              <tr>
                <th scope="col">排名</th>
                <th scope="col">玩家</th>
                <th scope="col">历史最高</th>
                <th scope="col">达成时间</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.entries.map((entry) => {
                const currentPlayer = isOwnScore(entry, leaderboard.self)
                return (
                  <tr
                    key={`${entry.rank}-${entry.displayName}-${entry.achievedAt}`}
                    className={
                      currentPlayer ? 'leaderboard-panel__current-player' : undefined
                    }
                    data-current-player={currentPlayer || undefined}
                  >
                    <th scope="row">#{entry.rank}</th>
                    <td>
                      {entry.displayName}
                      {currentPlayer && <span>我</span>}
                    </td>
                    <td>{formatBalance(entry.highestBalance)}</td>
                    <td>{formatAchievedAt(entry.achievedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {leaderboard.loadStatus === 'ready' && leaderboard.entries.length === 0 && (
          <p className="leaderboard-panel__empty">还没有公开成绩，成为第一位上榜玩家。</p>
        )}
        {leaderboard.loadStatus === 'loading' && leaderboard.entries.length === 0 && (
          <p className="leaderboard-panel__empty" role="status">
            正在读取排行榜…
          </p>
        )}

        <footer className="leaderboard-panel__pagination">
          <span>共 {leaderboard.total.toLocaleString('zh-CN')} 位玩家</span>
          <div>
            <button
              type="button"
              onClick={() => leaderboard.goToPage(leaderboard.page - 1)}
              disabled={leaderboard.page <= 1 || leaderboard.loadStatus === 'loading'}
            >
              上一页
            </button>
            <span>
              第 {leaderboard.page} / {leaderboard.totalPages} 页
            </span>
            <button
              type="button"
              onClick={() => leaderboard.goToPage(leaderboard.page + 1)}
              disabled={
                leaderboard.page >= leaderboard.totalPages ||
                leaderboard.loadStatus === 'loading'
              }
            >
              下一页
            </button>
          </div>
        </footer>
      </div>

      <p className="leaderboard-panel__privacy">
        仅原始上报凭证保存在当前浏览器；服务端保存匿名玩家编号、凭证哈希，以及用于限额的 HMAC
        网络指纹。公开榜单不展示这些标识，服务端不保存原始网络地址。
      </p>
    </section>
  )
}
