import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import {
  collectRuntimeErrors,
  finishRoundWithKeyboard,
  openFreshTable,
  readStoredGame,
  readStoredPending,
  startPlayerRound,
} from './support/gameFixture'

test('completes a keyboard round without duplicate settlement @cross-browser', async ({
  page,
}) => {
  const runtimeErrors = collectRuntimeErrors(page)
  await openFreshTable(page)
  const before = await readStoredGame(page)

  await startPlayerRound(page)
  await expect.poll(() => readStoredPending(page)).not.toBeNull()
  const pending = await readStoredPending(page)
  expect(pending?.revealedCount).toBe(0)

  await finishRoundWithKeyboard(page)
  const after = await readStoredGame(page)

  expect(after.historyLength).toBe(before.historyLength + 1)
  expect(after.handNumber).toBe(before.handNumber + 1)
  expect(after.balance).toBeGreaterThanOrEqual(0)
  expect(await readStoredPending(page)).toBeNull()
  expect(runtimeErrors).toEqual([])
})

test('keeps the mobile table within the viewport and exposes no serious axe violations', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openFreshTable(page)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
  await expect(page.locator('[data-bet-target="player"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /确认下注/ })).toBeVisible()

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const blocking = results.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  )
  expect(blocking).toEqual([])
})
