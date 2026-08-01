import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { LeaderboardScore } from '../leaderboard/types'
import {
  LeaderboardPanel,
  isOwnScore,
  leaderboardScoreRank,
  syncStatusText,
} from './LeaderboardPanel'

describe('LeaderboardPanel', () => {
  it('stays visually hidden when inactive while remaining safe to mount', () => {
    const markup = renderToStaticMarkup(
      <LeaderboardPanel
        active={false}
        currentBalance={10_000}
        recordedHighestBalance={10_000}
        scoreEventId={null}
      />,
    )

    expect(markup).toBe('')
  })

  it('renders ranking, nickname, sync, pagination and reset disclosure', () => {
    const markup = renderToStaticMarkup(
      <LeaderboardPanel
        active
        currentBalance={10_000}
        recordedHighestBalance={10_000}
        scoreEventId={null}
      />,
    )

    expect(markup).toContain('data-leaderboard-active="true"')
    expect(markup).toContain('自报 · 未验证模拟排行榜')
    expect(markup).toContain('2–16 个字符')
    expect(markup).toContain('同步状态')
    expect(markup).toContain('上一页')
    expect(markup).toContain('下一页')
    expect(markup).toContain('模拟成绩、重置不清除历史最高')
    expect(markup).toContain('可能被设备持有人篡改')
    expect(markup).toContain('不可用于奖励、奖金或公平竞赛依据')
    expect(markup).toContain('role="region"')
    expect(markup).toContain('aria-label="自报且未验证排行榜数据表"')
    expect(markup).not.toContain('tabindex=')
    expect(markup).toContain('仅原始上报凭证保存在当前浏览器')
    expect(markup).toContain('服务端保存匿名玩家编号、凭证哈希')
    expect(markup).toContain('公开榜单不展示这些标识')
    expect(markup).toContain('HMAC 网络指纹')
    expect(markup).toContain('服务端不保存原始网络地址')
  })

  it('keeps errors visible ahead of a stale synced status', () => {
    expect(syncStatusText('synced', true)).toBe('排行榜暂未同步')
    expect(syncStatusText('error', false)).toBe('排行榜暂未同步')
  })

  it('uses the server-provided global self rank independently of the current page', () => {
    const self = {
      displayName: '牌友甲',
      highestBalance: 12_345.5,
      achievedAt: '2026-08-01T12:00:00.000Z',
      rank: 42,
    } satisfies LeaderboardScore & { rank: number }

    expect(leaderboardScoreRank(self)).toBe(42)
    expect(leaderboardScoreRank({ ...self, rank: 0 })).toBeNull()
  })

  it('uses a valid server rank to disambiguate identical public score tuples', () => {
    const self: LeaderboardScore = {
      displayName: '同名牌友',
      highestBalance: 12_000,
      achievedAt: '2026-08-01T12:00:00.000Z',
      rank: 7,
    }
    const matchingEntry = { ...self, rank: 7 }
    const otherIdentityEntry = { ...self, rank: 8 }

    expect(isOwnScore(matchingEntry, self)).toBe(true)
    expect(isOwnScore(otherIdentityEntry, self)).toBe(false)
    expect(isOwnScore(otherIdentityEntry, { ...self, rank: undefined })).toBe(true)
  })
})
