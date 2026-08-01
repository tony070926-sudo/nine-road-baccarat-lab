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

  const finishPromise = finishRoundWithKeyboard(page)
  const tableStage = page.locator('[data-table-phase]')
  await expect(tableStage).toHaveAttribute('data-table-phase', 'settling', {
    timeout: 20_000,
  })
  await page
    .locator('[data-table-card-id] .playing-card')
    .evaluateAll(async (cards) => {
      await Promise.all(
        cards.flatMap((card) =>
          card.getAnimations().map((animation) =>
            animation.finished.catch(() => undefined),
          ),
        ),
      )
    })
  const preSweepCenters = await tableStage.evaluate((stage) =>
    Array.from(stage.querySelectorAll<HTMLElement>('[data-table-card-id]')).map(
      (shell) => {
        const card = shell.querySelector<HTMLElement>('.playing-card') ?? shell
        const rect = card.getBoundingClientRect()
        return {
          id: shell.dataset.tableCardId,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        }
      },
    ),
  )
  await expect(tableStage).toHaveAttribute('data-table-phase', 'clearing', {
    timeout: 20_000,
  })
  const clearingSnapshot = await tableStage.evaluate(async (stage) => {
    const locks = await navigator.locks.query()
    const shells = Array.from(
      stage.querySelectorAll<HTMLElement>('[data-table-card-id]'),
    )
    const sweepAnimations = shells.map((shell) => {
      const animation = shell.getAnimations()[0]
      animation?.pause()
      if (animation) animation.currentTime = 0
      return animation
    })
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    const centersAtStart = shells.map((shell) => {
      const card = shell.querySelector<HTMLElement>('.playing-card') ?? shell
      const rect = card.getBoundingClientRect()
      return {
        id: shell.dataset.tableCardId,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }
    })
    sweepAnimations.forEach((animation) => {
      if (!animation) return
      animation.currentTime = Number(
        animation.effect?.getComputedTiming().endTime ?? 0,
      )
    })
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    const centersAtEnd = shells.map((shell) => {
      const card = shell.querySelector<HTMLElement>('.playing-card') ?? shell
      const rect = card.getBoundingClientRect()
      return {
        id: shell.dataset.tableCardId,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }
    })
    const trayRect = stage
      .querySelector<HTMLElement>('[data-card-sweep-discard-tray]')
      ?.getBoundingClientRect()
    return {
      sweepState: stage.getAttribute('data-card-sweep-state'),
      heading: stage.querySelector('h2')?.textContent?.trim(),
      currentStep: stage
        .querySelector('[data-dealer-procedure-track]')
        ?.getAttribute('data-current-step-id'),
      cardCount: stage.querySelectorAll(
        '[data-table-card-id][data-card-sweep-round-id]',
      ).length,
      playerBetDisabled:
        stage.querySelector<HTMLButtonElement>('[data-bet-target="player"]')
          ?.disabled,
      tableLeaseHeld: locks.held?.some(
        (lock) => lock.name === 'nine-road-baccarat:active-table:v1',
      ),
      centersAtStart,
      centersAtEnd,
      trayCenter: trayRect
        ? {
            x: trayRect.left + trayRect.width / 2,
            y: trayRect.top + trayRect.height / 2,
          }
        : null,
    }
  })
  expect(clearingSnapshot).toMatchObject({
    sweepState: 'collecting',
    heading: '荷官正在收牌',
    currentStep: 'sweep-cards-to-discard-tray',
    playerBetDisabled: true,
    tableLeaseHeld: true,
  })
  expect(clearingSnapshot.cardCount).toBeGreaterThanOrEqual(4)
  expect(clearingSnapshot.cardCount).toBeLessThanOrEqual(6)
  expect(clearingSnapshot.trayCenter).not.toBeNull()
  for (const start of clearingSnapshot.centersAtStart) {
    const before = preSweepCenters.find(({ id }) => id === start.id)
    expect(before).toBeDefined()
    expect(Math.hypot(start.x - before!.x, start.y - before!.y)).toBeLessThan(1)
  }
  for (const end of clearingSnapshot.centersAtEnd) {
    expect(
      Math.hypot(
        end.x - clearingSnapshot.trayCenter!.x,
        end.y - clearingSnapshot.trayCenter!.y,
      ),
    ).toBeLessThan(2)
  }
  expect(await readStoredPending(page)).toBeNull()
  const durablySettled = await readStoredGame(page)
  expect(durablySettled.historyLength).toBe(before.historyLength + 1)
  expect(durablySettled.handNumber).toBe(before.handNumber + 1)

  await finishPromise
  const after = await readStoredGame(page)

  await expect(page.locator('[data-table-phase]')).toHaveAttribute(
    'data-table-phase',
    'betting',
  )
  expect(await readStoredPending(page)).toBeNull()
  expect(after.historyLength).toBe(before.historyLength + 1)
  expect(after.handNumber).toBe(before.handNumber + 1)
  await expect(page.locator('[data-table-card-id]')).toHaveCount(0)
  await expect(page.locator('[data-round-cards-cleared]')).toHaveCount(2)
  expect(
    await page.evaluate(async () => {
      const locks = await navigator.locks.query()
      return locks.held?.some(
        (lock) => lock.name === 'nine-road-baccarat:active-table:v1',
      )
    }),
  ).toBe(false)

  await page.reload()
  await expect(page.locator('[data-table-phase]')).toHaveAttribute(
    'data-table-phase',
    'betting',
  )
  await expect(page.locator('[data-card-sweep-round-id]')).toHaveCount(0)
  await expect(page.locator('[data-table-card-id]')).toHaveCount(0)
  expect((await readStoredGame(page)).historyLength).toBe(after.historyLength)
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
