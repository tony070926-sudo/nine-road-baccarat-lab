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
