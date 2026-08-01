import { expect, test } from '@playwright/test'
import {
  collectRuntimeErrors,
  finishRoundWithKeyboard,
  openFreshTable,
  readStoredGame,
  readStoredPending,
  startPlayerRound,
  stubLeaderboardWrites,
} from './support/gameFixture'

async function failTableMutation(
  page: import('@playwright/test').Page,
  mutation: 'prepare-round' | 'reveal-card' | 'settle-round',
) {
  await page.evaluate((blockedMutation) => {
    const prototype = Storage.prototype as Storage & {
      __tableOriginalSetItem?: Storage['setItem']
    }
    if (!prototype.__tableOriginalSetItem) {
      prototype.__tableOriginalSetItem = prototype.setItem
    }
    const original = prototype.__tableOriginalSetItem
    prototype.setItem = function (key: string, value: string) {
      if (
        key === 'nine-road-baccarat:table:v2' &&
        value.includes(`"lastMutation":"${blockedMutation}"`)
      ) {
        throw new DOMException('Injected durable write failure', 'QuotaExceededError')
      }
      return original.call(this, key, value)
    }
  }, mutation)
}

async function restoreTableWrites(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const prototype = Storage.prototype as Storage & {
      __tableOriginalSetItem?: Storage['setItem']
    }
    if (prototype.__tableOriginalSetItem) {
      prototype.setItem = prototype.__tableOriginalSetItem
      delete prototype.__tableOriginalSetItem
    }
  })
}

test('reload resumes the same durable round and settles once', async ({ page }) => {
  await openFreshTable(page)
  await startPlayerRound(page)

  const firstCard = page.locator('.reveal-card.can-flip:not(:disabled)').first()
  await expect(firstCard).toBeVisible()
  await firstCard.focus()
  await firstCard.press('Enter')
  await expect
    .poll(async () => (await readStoredPending(page))?.revealedCount ?? 0)
    .toBeGreaterThan(0)

  const beforeReload = await readStoredPending(page)
  expect(beforeReload).not.toBeNull()
  await page.reload()
  await expect(page.locator('[data-table-phase]')).toBeVisible()
  const afterReload = await readStoredPending(page)
  expect(afterReload?.id).toBe(beforeReload?.id)
  expect(afterReload?.revealedCount).toBeGreaterThanOrEqual(
    beforeReload?.revealedCount ?? 0,
  )

  await finishRoundWithKeyboard(page)
  expect((await readStoredGame(page)).historyLength).toBe(1)
  expect(await readStoredPending(page)).toBeNull()
})

test('reload resumes a dealer-controlled round and settles once', async ({ page }) => {
  await stubLeaderboardWrites(page)
  const runtimeErrors = collectRuntimeErrors(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await expect(page.locator('[data-table-phase]')).toBeVisible()
  const before = await readStoredGame(page)

  await page.locator('[data-bet-target="player"]').click()
  await page.getByText('荷官开牌', { exact: true }).click()
  await page.getByRole('button', { name: /确认下注/ }).click()
  await expect.poll(() => readStoredPending(page)).not.toBeNull()

  const beforeReload = await readStoredPending(page)
  expect(beforeReload?.revealControl).toBe('dealer-reveal')
  await page.reload()
  await expect(page.locator('[data-table-phase]')).toBeVisible()

  const afterReload = await readStoredPending(page)
  expect(afterReload?.id).toBe(beforeReload?.id)
  expect(afterReload?.revealControl).toBe('dealer-reveal')
  expect(afterReload?.revealedCount).toBeGreaterThanOrEqual(
    beforeReload?.revealedCount ?? 0,
  )

  let maximumManualCardCount = 0
  await expect
    .poll(
      async () => {
        maximumManualCardCount = Math.max(
          maximumManualCardCount,
          await page.locator('.reveal-card.can-flip:not(:disabled)').count(),
        )
        return (await readStoredGame(page)).historyLength
      },
      { timeout: 35_000, intervals: [20, 40, 80] },
    )
    .toBe(before.historyLength + 1)

  expect(maximumManualCardCount).toBe(0)
  expect(await readStoredPending(page)).toBeNull()
  await expect(page.locator('[data-table-phase]')).toHaveAttribute(
    'data-table-phase',
    'betting',
  )
  expect(runtimeErrors).toEqual([])
})

test('a second tab cannot advance the leased table', async ({
  browserName,
  context,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'The concurrency gate runs once in Chromium.')

  await openFreshTable(page)
  await startPlayerRound(page)
  await expect.poll(() => readStoredPending(page)).not.toBeNull()

  const secondPage = await context.newPage()
  await secondPage.goto('/')
  await expect(secondPage.getByText(/另一标签页|独占控制权/).first()).toBeVisible()
  await expect(secondPage.locator('.table-deal-button')).toBeDisabled()

  await page.bringToFront()
  await finishRoundWithKeyboard(page)
  await secondPage.reload()
  await expect(secondPage.locator('[data-table-phase]')).toHaveAttribute(
    'data-table-phase',
    'betting',
  )
  expect((await readStoredGame(secondPage)).historyLength).toBe(1)
})

test('durable write failures never advance cards, balance, or history', async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'Fault injection runs once in Chromium.')

  await openFreshTable(page)
  const before = await readStoredGame(page)

  await failTableMutation(page, 'prepare-round')
  await page.getByRole('radio', { name: '100' }).click()
  await page.locator('[data-bet-target="player"]').click()
  await page.getByRole('button', { name: /确认下注/ }).click()
  await expect(page.getByText(/无法耐久锁定本局/)).toBeVisible()
  expect(await readStoredPending(page)).toBeNull()
  expect(await readStoredGame(page)).toEqual(before)

  await restoreTableWrites(page)
  await page.getByRole('button', { name: /确认下注/ }).click()
  await expect.poll(() => readStoredPending(page)).not.toBeNull()

  await failTableMutation(page, 'reveal-card')
  const firstCard = page.locator('.reveal-card.can-flip:not(:disabled)').first()
  await expect(firstCard).toBeVisible()
  await firstCard.focus()
  await firstCard.press('Enter')
  await expect(page.getByText(/本张翻牌未能耐久写入/)).toBeVisible()
  expect((await readStoredPending(page))?.revealedCount).toBe(0)

  await restoreTableWrites(page)
  await firstCard.focus()
  await firstCard.press('Enter')
  await expect
    .poll(async () => (await readStoredPending(page))?.revealedCount ?? 0)
    .toBeGreaterThan(0)

  await failTableMutation(page, 'settle-round')
  const settlementFailure = page.getByText(/结算未能耐久写入/)
  const deadline = Date.now() + 35_000
  while (Date.now() < deadline && !(await settlementFailure.isVisible().catch(() => false))) {
    const card = page.locator('.reveal-card.can-flip:not(:disabled)').first()
    if (await card.isVisible().catch(() => false)) {
      await card.focus()
      await card.press('Enter')
    } else {
      await page.waitForTimeout(80)
    }
  }
  await expect(settlementFailure).toBeVisible()
  expect((await readStoredGame(page)).historyLength).toBe(0)
  expect(await readStoredPending(page)).not.toBeNull()

  await page.reload()
  await finishRoundWithKeyboard(page)
  const afterRecovery = await readStoredGame(page)
  expect(afterRecovery.historyLength).toBe(1)
  expect(afterRecovery.handNumber).toBe(before.handNumber + 1)
  expect(await readStoredPending(page)).toBeNull()
})
