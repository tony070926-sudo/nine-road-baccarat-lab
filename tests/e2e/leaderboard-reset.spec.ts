import { expect, test } from '@playwright/test'
import {
  finishRoundWithKeyboard,
  openFreshTable,
  readStoredGame,
} from './support/gameFixture'

const LEADERBOARD_PROFILE_KEY = 'nine-road-baccarat:leaderboard-profile:v1'

test('reset restores the table defaults while preserving the leaderboard high', async ({
  page,
}) => {
  await openFreshTable(page)

  await page.getByRole('radio', { name: '500', exact: true }).click()
  await page.locator('[data-bet-target="tie"]').click()
  await page.getByRole('button', { name: /确认下注/ }).click()
  await finishRoundWithKeyboard(page)
  expect((await readStoredGame(page)).balance).not.toBe(10_000)

  await page
    .getByRole('button', { name: '自报 · 未验证排行榜', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: '自报 · 未验证模拟排行榜' }),
  ).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        (key) => localStorage.getItem(key),
        LEADERBOARD_PROFILE_KEY,
      ),
    )
    .not.toBeNull()
  const profileBeforeReset = await page.evaluate(
    (key) => localStorage.getItem(key),
    LEADERBOARD_PROFILE_KEY,
  )

  await page.getByRole('button', { name: '重置模拟', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '重置本机牌桌模拟？' })
  await expect(dialog).toContainText(
    '排行榜匿名身份与已上报的历史最高不会被清除',
  )
  await dialog.getByRole('button', { name: '确认重置' }).click()

  await expect
    .poll(() => readStoredGame(page))
    .toMatchObject({
      balance: 10_000,
      handNumber: 0,
      historyLength: 0,
    })
  await expect(
    page.getByRole('radio', { name: '100', exact: true }),
  ).toBeChecked()
  await expect(page.locator('[data-chip-stack-amount]')).toHaveCount(0)
  await expect(page.locator('[data-leaderboard-active="true"]')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(
        (key) => localStorage.getItem(key),
        LEADERBOARD_PROFILE_KEY,
      ),
    )
    .toBe(profileBeforeReset)
})

test('a failed next page never keeps rows from the previous leaderboard page', async ({
  page,
}) => {
  await page.route('**/api/leaderboard?*', async (route) => {
    const requestUrl = new URL(route.request().url())
    const requestedPage = Number(requestUrl.searchParams.get('page') ?? '1')
    if (requestedPage === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'X-Leaderboard-Integrity': 'self-reported-unverified' },
        body: JSON.stringify({
          integrity: 'self-reported-unverified',
          total: 21,
          page: 1,
          pageSize: 20,
          entries: Array.from({ length: 20 }, (_, index) => ({
            rank: index + 1,
            displayName: `分页牌友${index + 1}`,
            highestBalance: 20_000 - index,
            achievedAt: '2026-08-01T12:00:00.000Z',
          })),
        }),
      })
      return
    }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'X-Leaderboard-Integrity': 'self-reported-unverified' },
      body: JSON.stringify({
        error: {
          code: 'leaderboard_unavailable',
          message: '排行榜分页暂时不可用。',
        },
      }),
    })
  })

  await openFreshTable(page)
  await page
    .getByRole('button', { name: '自报 · 未验证排行榜', exact: true })
    .click()
  const ranking = page.locator('.leaderboard-panel__ranking')
  await expect(ranking.getByText('分页牌友1', { exact: true })).toBeVisible()

  await ranking.getByRole('button', { name: '下一页' }).click()
  await expect(ranking.getByRole('alert')).toContainText('排行榜分页暂时不可用')
  await expect(ranking.locator('tbody tr')).toHaveCount(0)
  await expect(ranking).toContainText('第 2 / 2 页')
})
