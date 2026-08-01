import { expect, test, type Page } from '@playwright/test'
import { openFreshTable } from './support/gameFixture'

const TABLE_V2_KEY = 'nine-road-baccarat:table:v2'
const AUDIO_MIX_KEY = 'nine-road-baccarat:audio-mix-v1'
const MOTION_PROFILE_KEY = 'nine-road-baccarat:motion-profile:v1'

async function readRawTableSnapshot(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), TABLE_V2_KEY)
}

async function expectTableSnapshot(page: Page, expected: string): Promise<void> {
  await expect
    .poll(() => readRawTableSnapshot(page))
    .toBe(expected)
}

async function openFullMotionTable(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await expect(page.locator('[data-table-phase]')).toBeVisible()
  await expect(page.locator('[data-bet-target="player"]')).toBeEnabled()
}

test('100-round probability lab is isolated from the durable table snapshot', async ({
  page,
}) => {
  await openFreshTable(page)
  const tableBefore = await readRawTableSnapshot(page)
  expect(tableBefore).not.toBeNull()

  await page.getByRole('button', { name: '概率实验室', exact: true }).click()
  const lab = page.locator('[data-probability-lab="true"]')
  await expect(lab).toBeVisible()

  await lab.getByRole('button', { name: '100 局', exact: true }).click()
  await lab.getByRole('button', { name: '开始实验', exact: true }).click()

  await expect(lab).toHaveAttribute('data-lab-status', 'complete')
  await expect(lab.locator('[data-lab-report="true"]')).toBeVisible()
  await expect(lab.getByRole('status')).toContainText('已完成 100 局')
  await expectTableSnapshot(page, tableBefore!)
})

test('four audio channels persist independently from the durable table snapshot', async ({
  page,
}) => {
  await openFreshTable(page)
  const tableBefore = await readRawTableSnapshot(page)
  expect(tableBefore).not.toBeNull()

  const audioToggle = page.getByRole('button', {
    name: /(?:开启|关闭)牌桌空间音效/,
  })
  if ((await audioToggle.getAttribute('aria-pressed')) !== 'true') {
    await audioToggle.click()
  }

  await page.getByRole('button', { name: '打开体验设置' }).click()
  const dialog = page.getByRole('dialog', { name: '牌桌体验设置' })
  const mixer = dialog.getByRole('region', { name: '牌桌声音分轨' })
  await expect(mixer).toBeVisible()

  const expectedMix = {
    master: 0.31,
    effects: 0.47,
    ambient: 0.19,
    voice: 0.63,
  }
  for (const [channel, level] of Object.entries(expectedMix)) {
    const slider = mixer.locator(`[data-audio-channel="${channel}"] input`)
    await expect(slider).toBeEnabled()
    await slider.fill(String(Math.round(level * 100)))
  }

  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = localStorage.getItem(key)
        return raw ? (JSON.parse(raw) as Record<string, number>) : null
      }, AUDIO_MIX_KEY),
    )
    .toEqual(expectedMix)
  await expectTableSnapshot(page, tableBefore!)

  await page.reload()
  await expect(page.locator('[data-table-phase]')).toBeVisible()
  await page.getByRole('button', { name: '打开体验设置' }).click()
  const restoredMixer = page
    .getByRole('dialog', { name: '牌桌体验设置' })
    .getByRole('region', { name: '牌桌声音分轨' })
  for (const [channel, level] of Object.entries(expectedMix)) {
    await expect(
      restoredMixer.locator(`[data-audio-channel="${channel}"] input`),
    ).toHaveValue(String(Math.round(level * 100)))
  }
  await expectTableSnapshot(page, tableBefore!)
})

test('all pace profiles persist independently from the durable table snapshot', async ({
  page,
}) => {
  await openFullMotionTable(page)
  const tableBefore = await readRawTableSnapshot(page)
  expect(tableBefore).not.toBeNull()

  await page.getByRole('button', { name: '打开体验设置' }).click()
  const settings = page
    .getByRole('dialog', { name: '牌桌体验设置' })
    .locator('[data-experience-settings]')
  await expect(settings).toBeVisible()

  for (const profile of ['cinematic', 'standard', 'fast'] as const) {
    const input = settings.locator(
      `[data-motion-profile-input="${profile}"]`,
    )
    await input.check()
    await expect(input).toBeChecked()
    await expect(settings).toHaveAttribute(
      'data-effective-motion-profile',
      profile,
    )
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'data-motion-profile',
      profile,
    )
    await expect
      .poll(() =>
        page.evaluate((key) => localStorage.getItem(key), MOTION_PROFILE_KEY),
      )
      .toBe(profile)
    await expectTableSnapshot(page, tableBefore!)
  }

  await page.reload()
  await expect(page.locator('[data-table-phase]')).toBeVisible()
  await page.getByRole('button', { name: '打开体验设置' }).click()
  const restoredSettings = page
    .getByRole('dialog', { name: '牌桌体验设置' })
    .locator('[data-experience-settings]')
  await expect(
    restoredSettings.locator('[data-motion-profile-input="fast"]'),
  ).toBeChecked()
  await expect(restoredSettings).toHaveAttribute(
    'data-effective-motion-profile',
    'fast',
  )
  await expectTableSnapshot(page, tableBefore!)
})

test('fast pace places the four opening cards within two seconds', async ({
  page,
}) => {
  await openFullMotionTable(page)
  await page.getByRole('button', { name: '打开体验设置' }).click()
  const dialog = page.getByRole('dialog', { name: '牌桌体验设置' })
  await dialog.locator('[data-motion-profile-input="fast"]').check()
  await dialog.getByRole('button', { name: '关闭' }).click()

  await page.getByRole('radio', { name: '100', exact: true }).click()
  await page.locator('[data-bet-target="player"]').click()
  await page.evaluate(() => {
    const timingWindow = window as typeof window & {
      __fastOpeningDeal?: {
        startedAt: number | null
        completedAt: number | null
      }
    }
    const timing = { startedAt: null, completedAt: null } as {
      startedAt: number | null
      completedAt: number | null
    }
    timingWindow.__fastOpeningDeal = timing

    const sample = () => {
      if (
        timing.startedAt === null &&
        document.querySelector(
          '[data-dealer-rig-card-id], .reveal-card.is-being-dealt',
        )
      ) {
        timing.startedAt = performance.now()
      }
      if (
        timing.startedAt !== null &&
        document.querySelectorAll('.reveal-card.is-placed').length >= 4
      ) {
        timing.completedAt = performance.now()
        observer.disconnect()
      }
    }
    const observer = new MutationObserver(sample)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'data-dealer-rig-card-id'],
      childList: true,
      subtree: true,
    })
    sample()
  })

  await page.getByRole('button', { name: /确认下注/ }).click()
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const timingWindow = window as typeof window & {
            __fastOpeningDeal?: { completedAt: number | null }
          }
          return timingWindow.__fastOpeningDeal?.completedAt ?? null
        }),
      { timeout: 10_000 },
    )
    .not.toBeNull()

  const elapsedMs = await page.evaluate(() => {
    const timingWindow = window as typeof window & {
      __fastOpeningDeal?: {
        startedAt: number | null
        completedAt: number | null
      }
    }
    const timing = timingWindow.__fastOpeningDeal
    if (timing?.startedAt === null || timing?.completedAt === null || !timing) {
      throw new Error('Fast opening-deal timing marks were not captured.')
    }
    return timing.completedAt - timing.startedAt
  })
  expect(elapsedMs).toBeLessThanOrEqual(2_000)
})

test('recorded WAV and OGG assets are served with audio MIME types', async ({
  request,
}) => {
  const assets = [
    {
      path: '/assets/audio/card-place-1.wav',
      contentType: /^audio\/(?:wav|x-wav)(?:;|$)/i,
    },
    {
      path: '/assets/audio/card-place-1.ogg',
      contentType: /^audio\/ogg(?:;|$)/i,
    },
    {
      path: '/assets/audio/room-crowd-loop.ogg',
      contentType: /^audio\/ogg(?:;|$)/i,
    },
  ] as const

  for (const asset of assets) {
    const response = await request.get(asset.path)
    expect(response.status(), asset.path).toBe(200)
    expect(response.headers()['content-type'], asset.path).toMatch(
      asset.contentType,
    )
    expect((await response.body()).byteLength, asset.path).toBeGreaterThan(512)
  }
})
