import { expect, test, type Page } from '@playwright/test'
import {
  finishRoundWithKeyboard,
  openFreshTable,
  readStoredGame,
  readStoredPending,
  startPlayerRound,
} from './support/gameFixture'

async function openTableWithFullMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await expect(page.locator('[data-table-phase]')).toBeVisible()
  await expect(page.locator('[data-bet-target="player"]')).toBeEnabled()
}

async function visibleDealerRigCount(page: Page): Promise<number> {
  return page.locator('[data-dealer-rig-card-id]').evaluateAll((rigs) =>
    rigs.filter((rig) => {
      const style = getComputedStyle(rig)
      const rect = rig.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0.2 &&
        rect.width > 0 &&
        rect.height > 0
      )
    }).length,
  )
}

async function sampleQuickHandPeakOpacity(
  page: Page,
  timeoutMs = 1_200,
): Promise<number> {
  return page.evaluate(
    ({ timeout }) =>
      new Promise<number>((resolve) => {
        const deadline = performance.now() + timeout
        let peak = 0

        const sample = (now: number) => {
          document
            .querySelectorAll<HTMLElement>('[data-player-quick-hand]')
            .forEach((hand) => {
              peak = Math.max(peak, Number(getComputedStyle(hand).opacity))
            })

          if (peak > 0.2 || now >= deadline) {
            resolve(peak)
            return
          }
          requestAnimationFrame(sample)
        }

        requestAnimationFrame(sample)
      }),
    { timeout: timeoutMs },
  )
}

test('full motion uses one decoded dealer rig and shows the keyboard quick-open hand', async ({
  page,
}) => {
  await openTableWithFullMotion(page)
  const before = await readStoredGame(page)

  await startPlayerRound(page)

  await expect
    .poll(() => visibleDealerRigCount(page), { timeout: 12_000 })
    .toBe(1)

  const rig = page.locator('[data-dealer-rig-card-id]')
  await expect(rig).toHaveCount(1)
  await expect(rig).toHaveAttribute('data-dealer-rig-card-id', /.+/)
  await expect(page.locator('.dealer-motion-hand')).toHaveCount(0)

  const rigImages = rig.locator('img')
  await expect(rigImages).toHaveCount(3)
  const decodedImages = await rigImages.evaluateAll(async (images) => {
    await Promise.all(
      images.map((image) => (image as HTMLImageElement).decode()),
    )
    return images.map((image) => {
      const asset = image as HTMLImageElement
      return {
        complete: asset.complete,
        naturalHeight: asset.naturalHeight,
        naturalWidth: asset.naturalWidth,
      }
    })
  })
  expect(decodedImages).toHaveLength(3)
  for (const image of decodedImages) {
    expect(image.complete).toBe(true)
    expect(image.naturalWidth).toBeGreaterThan(0)
    expect(image.naturalHeight).toBeGreaterThan(0)
  }

  const manualCard = page.locator('.reveal-card.can-flip:not(:disabled)').first()
  await expect(manualCard).toBeVisible({ timeout: 15_000 })
  await manualCard.focus()
  await manualCard.press('Enter')

  expect(await sampleQuickHandPeakOpacity(page)).toBeGreaterThan(0.2)

  await finishRoundWithKeyboard(page)
  const after = await readStoredGame(page)

  await expect(page.locator('[data-table-phase]')).toHaveAttribute(
    'data-table-phase',
    'betting',
  )
  expect(await readStoredPending(page)).toBeNull()
  expect(after.historyLength).toBe(before.historyLength + 1)
  expect(after.handNumber).toBe(before.handNumber + 1)
})

test('reduced motion completes one round and clears the durable pending journal', async ({
  page,
}) => {
  await openFreshTable(page)
  expect(
    await page.evaluate(() =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ),
  ).toBe(true)
  const before = await readStoredGame(page)

  await startPlayerRound(page)
  await expect.poll(() => readStoredPending(page)).not.toBeNull()
  await finishRoundWithKeyboard(page)

  await expect(page.locator('[data-table-phase]')).toHaveAttribute(
    'data-table-phase',
    'betting',
  )
  await expect.poll(() => readStoredPending(page)).toBeNull()
  const after = await readStoredGame(page)
  expect(after.historyLength).toBe(before.historyLength + 1)
  expect(after.handNumber).toBe(before.handNumber + 1)
})
