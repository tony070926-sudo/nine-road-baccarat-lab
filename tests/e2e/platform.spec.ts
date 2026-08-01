import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { openFreshTable } from './support/gameFixture'

test('Pages returns real 404 responses and correct asset MIME types @cross-browser', async ({
  page,
  request,
}) => {
  const missingPage = await request.get('/definitely-missing-e2e-page')
  expect(missingPage.status()).toBe(404)
  expect(missingPage.headers()['cache-control']).not.toContain('immutable')

  const missingScript = await request.get('/assets/e2e-missing.js')
  expect(missingScript.status()).toBe(404)
  expect(missingScript.headers()['cache-control']).not.toContain('immutable')
  expect(missingScript.headers()['x-content-type-options']).toBe('nosniff')

  await openFreshTable(page)
  const assetUrls = await page.evaluate(() => ({
    script: document.querySelector<HTMLScriptElement>('script[type="module"]')?.src,
    stylesheet: document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')?.href,
  }))
  expect(assetUrls.script).toBeTruthy()
  expect(assetUrls.stylesheet).toBeTruthy()

  const script = await request.get(assetUrls.script!)
  const stylesheet = await request.get(assetUrls.stylesheet!)
  expect(script.status()).toBe(200)
  expect(script.headers()['content-type']).toContain('javascript')
  expect(stylesheet.status()).toBe(200)
  expect(stylesheet.headers()['content-type']).toContain('text/css')

  const sourceMap = await request.get(`${assetUrls.script}.map`)
  expect(sourceMap.status()).toBe(404)
})

test('initial table and rules dialog have no serious axe violations', async ({ page }) => {
  await openFreshTable(page)
  const initial = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    initial.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([])

  await page.getByRole('button', { name: /规则/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const dialog = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    dialog.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([])
})

test('reduced motion completes without infinite decorative animation', async ({ page }) => {
  await openFreshTable(page)
  expect(
    await page.evaluate(() =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ),
  ).toBe(true)

  const infiniteAnimations = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations === Infinity)
      .map((animation) => (animation.effect as KeyframeEffect).target),
  )
  expect(infiniteAnimations).toEqual([])
})

test('core table text reflows at a 200% equivalent viewport without clipping', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 900 })
  await openFreshTable(page)

  const metrics = await page.evaluate(() => {
    const selectors = [
      '.dealer-spoken-status',
      '.felt-betting-heading p',
      '.table-credit strong',
      '[data-bet-target="player"] .bet-zone-odds',
      '.table-deal-button',
      '.casino-betting-layer .chip',
      '.table-bet-summary',
    ]
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      fonts: selectors.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector)
        return {
          selector,
          visible: Boolean(element && element.getClientRects().length > 0),
          size: element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0,
        }
      }),
      controls: [
        document.querySelector<HTMLElement>('[data-bet-target="player"]'),
        document.querySelector<HTMLElement>('.table-deal-button'),
      ].map((element) => {
        const rect = element?.getBoundingClientRect()
        return rect
          ? { left: rect.left, right: rect.right, width: rect.width }
          : null
      }),
    }
  })

  expect(metrics.overflow).toBeLessThanOrEqual(1)
  for (const font of metrics.fonts) {
    expect(font.visible, `${font.selector} should remain visible`).toBe(true)
    expect(font.size, `${font.selector} should be at least 12px`).toBeGreaterThanOrEqual(12)
  }
  for (const control of metrics.controls) {
    expect(control).not.toBeNull()
    expect(control!.left).toBeGreaterThanOrEqual(0)
    expect(control!.right).toBeLessThanOrEqual(640)
    expect(control!.width).toBeGreaterThan(0)
  }
})

test('mobile hides secondary betting copy while keeping core controls visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openFreshTable(page)

  for (const selector of [
    '.bet-zone-label small',
    '.bet-zone-meta small',
    '.chip-rack-label',
    '.physical-chip-drag-source > span',
  ]) {
    const elements = page.locator(selector)
    const count = await elements.count()
    for (let index = 0; index < count; index += 1) {
      await expect(elements.nth(index)).toBeHidden()
    }
  }

  await expect(page.locator('[data-bet-target="player"]')).toBeVisible()
  await expect(page.locator('[data-remove-last-chip="player"]')).toBeAttached()
  await expect(page.getByRole('button', { name: /确认下注/ })).toBeVisible()
})
