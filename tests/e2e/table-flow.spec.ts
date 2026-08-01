import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  collectRuntimeErrors,
  finishRoundWithKeyboard,
  openFreshTable,
  readStoredGame,
  readStoredPending,
  startPlayerRound,
  stubLeaderboardWrites,
} from './support/gameFixture'

async function waitForDealerControlledRound(
  page: Page,
  expectedHistoryLength: number,
): Promise<number> {
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
    .toBe(expectedHistoryLength)
  return maximumManualCardCount
}

test('completes a keyboard round without duplicate settlement @cross-browser', async ({
  page,
}) => {
  // This assertion owns the core table runtime boundary. Keep the unrelated
  // public leaderboard deterministic so shared-IP quotas from other browser
  // contexts cannot turn a handled 429 into browser console noise here.
  await stubLeaderboardWrites(page)
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

  await startPlayerRound(page)
  await expect(page.locator('.cards-row.is-cleared')).toHaveCount(0)
  await finishRoundWithKeyboard(page, before.historyLength + 2)
  const afterSecond = await readStoredGame(page)
  expect(afterSecond.historyLength).toBe(before.historyLength + 2)
  expect(afterSecond.handNumber).toBe(before.handNumber + 2)
  await expect(page.locator('[data-table-phase]')).toHaveAttribute(
    'data-table-phase',
    'betting',
  )
  await expect(page.locator('.cards-row.is-cleared')).toHaveCount(2)
  expect(runtimeErrors).toEqual([])
})

test('lets a wagered player hand the full round to the dealer @cross-browser', async ({
  page,
}) => {
  await stubLeaderboardWrites(page)
  const runtimeErrors = collectRuntimeErrors(page)
  await openFreshTable(page)
  const before = await readStoredGame(page)
  const revealControl = page.locator('.reveal-control')

  await expect(revealControl).toHaveAttribute(
    'data-reveal-control',
    'dealer-reveal',
  )
  await expect(page.getByRole('radio', { name: '荷官开牌' })).toBeDisabled()

  await page.locator('[data-bet-target="player"]').click()
  await expect(revealControl).toHaveAttribute(
    'data-reveal-control',
    'player-squeeze',
  )
  const playerControl = page.getByRole('radio', { name: '自己咪牌' })
  const dealerControl = page.getByRole('radio', { name: '荷官开牌' })
  await playerControl.focus()
  await playerControl.press('ArrowRight')
  await expect(dealerControl).toBeChecked()
  await dealerControl.press('ArrowLeft')
  await expect(playerControl).toBeChecked()
  await page.getByText('荷官开牌', { exact: true }).click()
  await expect(dealerControl).toBeChecked()
  await page.getByRole('button', { name: /确认下注/ }).click()

  await expect.poll(() => readStoredPending(page)).not.toBeNull()
  expect((await readStoredPending(page))?.revealControl).toBe('dealer-reveal')

  expect(
    await waitForDealerControlledRound(page, before.historyLength + 1),
  ).toBe(0)
  expect(await readStoredPending(page)).toBeNull()
  await expect(page.locator('[data-table-phase]')).toHaveAttribute(
    'data-table-phase',
    'betting',
  )
  expect(runtimeErrors).toEqual([])
})

test('keeps side-bet-only and fly rounds dealer controlled', async ({ page }) => {
  await stubLeaderboardWrites(page)
  await openFreshTable(page)
  const before = await readStoredGame(page)

  await page.locator('[data-bet-target="tie"]').click()
  await expect(page.locator('.reveal-control')).toHaveAttribute(
    'data-reveal-control',
    'dealer-reveal',
  )
  await expect(page.getByRole('radio', { name: '荷官开牌' })).toBeDisabled()
  await page.getByRole('button', { name: /确认下注/ }).click()
  await expect.poll(() => readStoredPending(page)).not.toBeNull()
  expect((await readStoredPending(page))?.revealControl).toBe('dealer-reveal')
  expect(
    await waitForDealerControlledRound(page, before.historyLength + 1),
  ).toBe(0)

  await page.getByRole('button', { name: /飞牌/ }).click()
  await expect.poll(() => readStoredPending(page)).not.toBeNull()
  expect((await readStoredPending(page))?.revealControl).toBe('dealer-reveal')
  expect(
    await waitForDealerControlledRound(page, before.historyLength + 2),
  ).toBe(0)
})

test('keeps the player squeeze choice visible through full-motion settlement', async ({
  page,
}) => {
  await stubLeaderboardWrites(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await expect(page.locator('[data-table-phase]')).toBeVisible()
  const before = await readStoredGame(page)

  await page.locator('[data-bet-target="player"]').click()
  await expect(page.locator('.reveal-control')).toHaveAttribute(
    'data-reveal-control',
    'player-squeeze',
  )
  await page.getByRole('button', { name: /确认下注/ }).click()

  const table = page.locator('[data-table-phase]')
  const deadline = Date.now() + 35_000
  while (
    Date.now() < deadline &&
    (await table.getAttribute('data-table-phase')) !== 'settling'
  ) {
    const card = page.locator('.reveal-card.can-flip:not(:disabled)').first()
    if (await card.isVisible().catch(() => false)) {
      await card.focus()
      await card.press('Enter')
    } else {
      await page.waitForTimeout(80)
    }
  }

  await expect(table).toHaveAttribute('data-table-phase', 'settling')
  await expect(page.locator('.reveal-control')).toHaveAttribute(
    'data-reveal-control',
    'player-squeeze',
  )
  await expect(page.getByRole('radio', { name: '自己咪牌' })).toBeChecked()
  await expect
    .poll(() => readStoredGame(page), { timeout: 35_000 })
    .toMatchObject({ historyLength: before.historyLength + 1 })
  await expect(table).toHaveAttribute('data-table-phase', 'betting', {
    timeout: 35_000,
  })
})

test('keeps the mobile table horizontally contained, controls reachable, and axe-clean', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openFreshTable(page)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
  await expect(page.locator('[data-bet-target="player"]')).toBeVisible()
  for (const control of [
    page.getByRole('button', { name: /飞牌/ }),
    page.getByRole('button', { name: /确认下注/ }),
  ]) {
    await control.scrollIntoViewIfNeeded()
    await expect(control).toBeInViewport()
    const box = await control.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }

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
    await page.locator('[data-bet-target="player"]').click()

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

    const revealTargets = await page
      .locator('.reveal-control-options label')
      .evaluateAll((labels) =>
        labels.map((label) => {
          const rect = label.getBoundingClientRect()
          return { width: rect.width, height: rect.height }
        }),
      )
    expect(revealTargets).toHaveLength(2)
    for (const target of revealTargets) {
      expect(target.width).toBeGreaterThanOrEqual(44)
      expect(target.height).toBeGreaterThanOrEqual(44)
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
