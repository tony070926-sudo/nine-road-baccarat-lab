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

test('keeps every betting target in the three-column felt layout @cross-browser', async ({
  page,
}) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    await openFreshTable(page)

    const layout = await page.locator('.felt-bet-grid').evaluate((grid) => {
      const targets = Array.from(
        grid.querySelectorAll<HTMLElement>('[data-bet-target]'),
      ).map((target) => {
        const rect = target.getBoundingClientRect()
        const centerElement = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        )

        return {
          name: target.dataset.betTarget,
          width: rect.width,
          height: rect.height,
          centerTarget:
            centerElement
              ?.closest<HTMLElement>('[data-bet-target]')
              ?.dataset.betTarget ?? null,
        }
      })

      return {
        columnCount: getComputedStyle(grid).gridTemplateColumns
          .split(/\s+/u)
          .filter(Boolean).length,
        targets,
      }
    })

    expect(layout.columnCount).toBe(3)
    expect(layout.targets.map((target) => target.name)).toEqual([
      'playerPair',
      'bankerPair',
      'player',
      'tie',
      'banker',
    ])
    for (const target of layout.targets) {
      expect(target.width).toBeGreaterThanOrEqual(44)
      expect(target.height).toBeGreaterThanOrEqual(44)
      expect(target.centerTarget).toBe(target.name)
    }
  }
})

test('removes the most recently placed chip in each betting zone with the keyboard', async ({
  page,
}) => {
  await openFreshTable(page)

  await page.getByRole('radio', { name: '100', exact: true }).click()
  const playerZone = page.locator('[data-bet-target="player"]')
  await playerZone.click()
  await page.getByRole('radio', { name: '50', exact: true }).click()
  await playerZone.click()

  const playerStack = page.locator(
    '[data-chip-stack-anchor="player"] [data-chip-stack-amount]',
  )
  await expect(playerStack).toHaveAttribute('data-chip-stack-amount', '150')
  expect(
    await playerStack
      .locator('.chip-stack-disc[data-chip-value]')
      .evaluateAll((chips) => chips.map((chip) => chip.getAttribute('data-chip-value'))),
  ).toEqual(['100', '50'])
  const accessibility = await new AxeBuilder({ page })
    .include('.bet-grid')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    accessibility.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([])

  const removeLast = page.locator('[data-remove-last-chip="player"]')
  await expect(removeLast).toHaveAttribute('data-last-chip-value', '50')
  await playerZone.focus()
  await page.keyboard.press('Tab')
  await expect(removeLast).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(playerStack).toHaveAttribute('data-chip-stack-amount', '100')
  await expect(removeLast).toHaveAttribute('data-last-chip-value', '100')

  await page.keyboard.press('Enter')
  await expect(playerStack).toHaveCount(0)
  await expect(removeLast).toBeDisabled()
})
