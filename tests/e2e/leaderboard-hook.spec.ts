import { expect, test, type Page, type Route } from '@playwright/test'
import { dealRound } from '../../src/game/baccarat'
import type { ShoeState, Winner } from '../../src/types'
import {
  openFreshTable,
  readStoredGame,
} from './support/gameFixture'

const PROFILE_KEY = 'nine-road-baccarat:leaderboard-profile:v1'
const SYNC_KEY = 'nine-road-baccarat:leaderboard-sync:v1'
const TABLE_KEY = 'nine-road-baccarat:table:v2'
const INTEGRITY = 'self-reported-unverified'
const ACHIEVED_AT = '2026-08-01T12:00:00.000Z'

async function fulfillLeaderboardPage(route: Route, requestedPage = 1) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'X-Leaderboard-Integrity': INTEGRITY },
    body: JSON.stringify({
      integrity: INTEGRITY,
      total: 40,
      page: requestedPage,
      pageSize: 20,
      entries: [
        {
          rank: (requestedPage - 1) * 20 + 1,
          displayName: `第${requestedPage}页牌友`,
          highestBalance: 20_000 - requestedPage,
          achievedAt: ACHIEVED_AT,
        },
      ],
    }),
  })
}

async function fulfillSubmission(
  route: Route,
  highestBalance: number,
  rank = 1,
) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'X-Leaderboard-Integrity': INTEGRITY },
    body: JSON.stringify({
      integrity: INTEGRITY,
      entry: {
        rank,
        displayName: '九点玩家',
        highestBalance,
        achievedAt: ACHIEVED_AT,
      },
    }),
  })
}

async function readStoredShoe(page: Page): Promise<ShoeState> {
  return page.evaluate((tableKey) => {
    const envelope = JSON.parse(localStorage.getItem(tableKey) ?? '{}') as {
      game?: { shoe?: ShoeState }
    }
    if (!envelope.game?.shoe) throw new Error('Stored shoe is unavailable')
    return envelope.game.shoe
  }, TABLE_KEY)
}

async function playRound(page: Page, target: Winner, amount: 100 | 500) {
  const historyLengthBeforeRound = (await readStoredGame(page)).historyLength
  await page.getByRole('radio', { name: String(amount), exact: true }).click()
  await page.locator(`[data-bet-target="${target}"]`).click()
  await page.getByRole('button', { name: /确认下注/ }).click()

  const stage = page.locator('[data-table-phase]')
  const deadline = Date.now() + 35_000
  while (Date.now() < deadline) {
    const game = await readStoredGame(page)
    if (game.historyLength > historyLengthBeforeRound) {
      await expect(stage).toHaveAttribute('data-table-phase', 'betting')
      return
    }

    const card = page.locator('.reveal-card.can-flip:not(:disabled)').first()
    if (await card.isVisible().catch(() => false)) {
      await card.focus()
      await card.press('Enter')
    } else {
      await page.waitForTimeout(80)
    }
  }

  throw new Error('The baccarat round did not return to betting in time.')
}

test('public ranking loads and exposes an overflow region when profile storage fails', async ({
  page,
}) => {
  await page.addInitScript((profileKey) => {
    const originalGetItem = Storage.prototype.getItem
    Storage.prototype.getItem = function (key: string) {
      if (key === profileKey) throw new DOMException('blocked', 'SecurityError')
      return originalGetItem.call(this, key)
    }
  }, PROFILE_KEY)
  await page.route('**/api/leaderboard?*', (route) =>
    fulfillLeaderboardPage(route),
  )
  await page.setViewportSize({ width: 320, height: 900 })
  await openFreshTable(page)

  await page
    .getByRole('button', { name: '自报 · 未验证排行榜', exact: true })
    .click()

  await expect(page.getByText('第1页牌友', { exact: true })).toBeVisible()
  const tableRegion = page.getByRole('region', {
    name: '自报且未验证排行榜数据表',
  })
  await expect(tableRegion).toHaveAttribute('tabindex', '0')

  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(tableRegion).not.toHaveAttribute('tabindex')
})

test('a completed submission refreshes the latest page instead of its captured page', async ({
  page,
}) => {
  const requestedPages: number[] = []
  let releaseSubmission: () => void = () => undefined
  let markSubmissionStarted: () => void = () => undefined
  const submissionStarted = new Promise<void>((resolve) => {
    markSubmissionStarted = resolve
  })
  const submissionGate = new Promise<void>((resolve) => {
    releaseSubmission = resolve
  })

  await page.route('**/api/leaderboard*', async (route) => {
    if (route.request().method() === 'POST') {
      markSubmissionStarted()
      await submissionGate
      await fulfillSubmission(route, 10_000)
      return
    }
    const url = new URL(route.request().url())
    const requestedPage = Number(url.searchParams.get('page') ?? '1')
    requestedPages.push(requestedPage)
    await fulfillLeaderboardPage(route, requestedPage)
  })

  await openFreshTable(page)
  await submissionStarted
  await page
    .getByRole('button', { name: '自报 · 未验证排行榜', exact: true })
    .click()
  await expect(page.getByText('第1页牌友', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByText('第2页牌友', { exact: true })).toBeVisible()
  const firstPageRequestsBeforeSubmission = requestedPages.filter(
    (requestedPage) => requestedPage === 1,
  ).length
  const requestCountBeforeSubmission = requestedPages.length

  releaseSubmission()
  await expect
    .poll(() => requestedPages.length)
    .toBeGreaterThan(requestCountBeforeSubmission)
  await expect(page.getByText('第2页牌友', { exact: true })).toBeVisible()
  await expect(page.getByText('第1页牌友', { exact: true })).toHaveCount(0)
  expect(
    requestedPages.filter((requestedPage) => requestedPage === 1),
  ).toHaveLength(firstPageRequestsBeforeSubmission)
  expect(requestedPages.at(-1)).toBe(2)
})

test('refresh uses an identity-preserving no-change submission to update self rank', async ({
  page,
}) => {
  let submissionCount = 0
  await page.route('**/api/leaderboard*', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLeaderboardPage(route)
      return
    }
    submissionCount += 1
    const body = route.request().postDataJSON() as { highestBalance: number }
    await fulfillSubmission(
      route,
      body.highestBalance,
      submissionCount === 1 ? 7 : 9,
    )
  })

  await openFreshTable(page)
  await expect.poll(() => submissionCount).toBe(1)
  await page
    .getByRole('button', { name: '自报 · 未验证排行榜', exact: true })
    .click()
  const personalScore = page.getByLabel('我的历史最高')
  await expect(personalScore).toContainText('全局排名 #7')

  await page.getByRole('button', { name: '刷新排名', exact: true }).click()
  await expect.poll(() => submissionCount).toBe(2)
  await expect(personalScore).toContainText('全局排名 #9')
})

test('a durable high-score outbox survives profile write failure and a later lower score', async ({
  page,
}) => {
  const submittedBalances: number[] = []
  await page.route('**/api/leaderboard*', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLeaderboardPage(route)
      return
    }
    const body = route.request().postDataJSON() as { highestBalance: number }
    submittedBalances.push(body.highestBalance)
    if (body.highestBalance === 10_000) {
      await fulfillSubmission(route, body.highestBalance)
      return
    }
    await route.abort('internetdisconnected')
  })

  await openFreshTable(page)
  await expect.poll(() => submittedBalances).toContain(10_000)
  await expect
    .poll(() =>
      page.evaluate((syncKey) => {
        const state = JSON.parse(localStorage.getItem(syncKey) ?? '{}') as {
          self?: { highestBalance?: number } | null
        }
        return state.self?.highestBalance ?? null
      }, SYNC_KEY),
    )
    .toBe(10_000)

  await page.evaluate((profileKey) => {
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === profileKey) {
        const profile = JSON.parse(value) as { highestBalance?: number }
        if ((profile.highestBalance ?? 0) > 10_000) {
          throw new DOMException('profile write blocked', 'QuotaExceededError')
        }
      }
      return originalSetItem.call(this, key, value)
    }
  }, PROFILE_KEY)

  const winningRound = dealRound(await readStoredShoe(page)).result
  await playRound(page, winningRound.winner, 500)
  const highBalance = (await readStoredGame(page)).balance
  expect(highBalance).toBeGreaterThan(10_000)
  await expect.poll(() => submittedBalances).toContain(highBalance)

  await page
    .getByRole('button', { name: '自报 · 未验证排行榜', exact: true })
    .click()
  await expect(page.getByLabel('我的历史最高')).toContainText(
    highBalance.toLocaleString('zh-CN'),
  )
  await expect(page.locator('.leaderboard-panel__sync')).toContainText(
    '新的历史最高已保留在当前页面和本机待同步队列',
  )

  let lowerBalance = highBalance
  for (let attempt = 0; attempt < 10 && lowerBalance === highBalance; attempt += 1) {
    const nextRound = dealRound(await readStoredShoe(page)).result
    const losingTarget: Winner =
      nextRound.winner === 'player'
        ? 'banker'
        : nextRound.winner === 'banker'
          ? 'player'
          : 'player'
    await playRound(page, losingTarget, 100)
    lowerBalance = (await readStoredGame(page)).balance
  }
  expect(lowerBalance).toBeLessThan(highBalance)
  expect(lowerBalance).toBeGreaterThan(10_000)

  const persisted = await page.evaluate(
    ({ profileKey, syncKey }) => {
      const profile = JSON.parse(localStorage.getItem(profileKey) ?? '{}') as {
        highestBalance?: number
      }
      const sync = JSON.parse(localStorage.getItem(syncKey) ?? '{}') as {
        pending?: { highestBalance?: number } | null
      }
      return {
        profileHigh: profile.highestBalance ?? null,
        pendingHigh: sync.pending?.highestBalance ?? null,
      }
    },
    { profileKey: PROFILE_KEY, syncKey: SYNC_KEY },
  )
  expect(persisted.profileHigh).toBe(10_000)
  expect(persisted.pendingHigh).toBe(highBalance)
  await page
    .getByRole('button', { name: '自报 · 未验证排行榜', exact: true })
    .click()
  await expect(page.getByLabel('我的历史最高')).toContainText(
    highBalance.toLocaleString('zh-CN'),
  )
  await expect(page.locator('.leaderboard-panel__sync')).toContainText(
    '新的历史最高已保留在当前页面和本机待同步队列',
  )
  expect(submittedBalances.slice(1).every((balance) => balance === highBalance)).toBe(
    true,
  )
})

test('429 keeps the outbox for an explicit retry without scheduling background retries', async ({
  page,
}) => {
  const submittedBalances: number[] = []
  await page.route('**/api/leaderboard*', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLeaderboardPage(route)
      return
    }
    const body = route.request().postDataJSON() as { highestBalance: number }
    submittedBalances.push(body.highestBalance)
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'Retry-After': '3600' },
      body: JSON.stringify({
        error: { code: 'RATE_LIMITED', message: '提交过于频繁。' },
      }),
    })
  })

  await openFreshTable(page)
  await expect.poll(() => submittedBalances).toEqual([10_000])

  await page.evaluate(() => globalThis.dispatchEvent(new Event('online')))
  await page.waitForTimeout(250)
  expect(submittedBalances).toEqual([10_000])

  const winningRound = dealRound(await readStoredShoe(page)).result
  await playRound(page, winningRound.winner, 500)
  const highBalance = (await readStoredGame(page)).balance
  expect(highBalance).toBeGreaterThan(10_000)
  await expect
    .poll(() =>
      page.evaluate((syncKey) => {
        const state = JSON.parse(localStorage.getItem(syncKey) ?? '{}') as {
          pending?: { highestBalance?: number } | null
        }
        return state.pending?.highestBalance ?? null
      }, SYNC_KEY),
    )
    .toBe(highBalance)
  await page.waitForTimeout(250)
  expect(submittedBalances).toEqual([10_000])

  await page.evaluate(() => globalThis.dispatchEvent(new Event('online')))
  await page.waitForTimeout(250)
  expect(submittedBalances).toEqual([10_000])

  await page
    .getByRole('button', { name: '自报 · 未验证排行榜', exact: true })
    .click()
  await expect(page.getByRole('button', { name: '重试上报' })).toBeVisible()
  await page.getByRole('button', { name: '重试上报' }).click()
  await expect.poll(() => submittedBalances).toEqual([10_000, highBalance])
})

test('a forced retry does not carry its cooldown bypass into a newer queued score', async ({
  page,
}) => {
  const submittedBalances: number[] = []
  let markForcedSubmissionStarted: () => void = () => undefined
  let releaseForcedSubmission: () => void = () => undefined
  const forcedSubmissionStarted = new Promise<void>((resolve) => {
    markForcedSubmissionStarted = resolve
  })
  const forcedSubmissionGate = new Promise<void>((resolve) => {
    releaseForcedSubmission = resolve
  })

  await page.route('**/api/leaderboard*', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLeaderboardPage(route)
      return
    }

    const body = route.request().postDataJSON() as { highestBalance: number }
    submittedBalances.push(body.highestBalance)
    if (submittedBalances.length === 2) {
      markForcedSubmissionStarted()
      await forcedSubmissionGate
    }
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'Retry-After': '3600' },
      body: JSON.stringify({
        error: { code: 'RATE_LIMITED', message: '提交过于频繁。' },
      }),
    })
  })

  await openFreshTable(page)
  await expect.poll(() => submittedBalances).toEqual([10_000])

  await page
    .getByRole('button', { name: '自报 · 未验证排行榜', exact: true })
    .click()
  await page.getByRole('button', { name: '重试上报' }).click()
  await forcedSubmissionStarted
  expect(submittedBalances).toEqual([10_000, 10_000])

  const winningRound = dealRound(await readStoredShoe(page)).result
  await playRound(page, winningRound.winner, 500)
  const highBalance = (await readStoredGame(page)).balance
  expect(highBalance).toBeGreaterThan(10_000)
  await expect
    .poll(() =>
      page.evaluate((syncKey) => {
        const state = JSON.parse(localStorage.getItem(syncKey) ?? '{}') as {
          pending?: { highestBalance?: number } | null
        }
        return state.pending?.highestBalance ?? null
      }, SYNC_KEY),
    )
    .toBe(highBalance)

  releaseForcedSubmission()
  await page
    .getByRole('button', { name: '自报 · 未验证排行榜', exact: true })
    .click()
  await expect(page.getByRole('button', { name: '重试上报' })).toBeVisible()
  await page.evaluate(() => globalThis.dispatchEvent(new Event('online')))
  await page.waitForTimeout(250)

  expect(submittedBalances).toEqual([10_000, 10_000])
})
