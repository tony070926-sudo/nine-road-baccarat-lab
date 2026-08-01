import { expect, type Page } from '@playwright/test'

const LEGACY_GAME_KEY = 'nine-road-baccarat:v1'
const LEGACY_PENDING_KEY = 'nine-road-baccarat:pending:v1'
const TABLE_V2_KEY = 'nine-road-baccarat:table:v2'

interface StoredRoundSnapshot {
  id: string
  revealedCount: number
}

interface StoredGameSnapshot {
  balance: number
  handNumber: number
  historyLength: number
}

export function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  return errors
}

export async function openFreshTable(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('[data-table-phase]')).toBeVisible()
  await expect(page.locator('[data-bet-target="player"]')).toBeEnabled()
}

export async function startPlayerRound(page: Page, amount = 100): Promise<void> {
  const chip = page.getByRole('radio', { name: String(amount) })
  if (await chip.count()) await chip.click()

  await page.locator('[data-bet-target="player"]').click()
  await page.getByRole('button', { name: /确认下注/ }).click()
  await expect(page.locator('[data-table-phase]')).not.toHaveAttribute(
    'data-table-phase',
    'betting',
  )
}

export async function readStoredPending(
  page: Page,
): Promise<StoredRoundSnapshot | null> {
  return page.evaluate(
    ({ legacyPendingKey, tableV2Key }) => {
      const v2Raw = localStorage.getItem(tableV2Key)
      if (v2Raw) {
        const envelope = JSON.parse(v2Raw) as {
          pending?: { id?: string; revealedCount?: number } | null
        }
        if (!envelope.pending?.id) return null
        return {
          id: envelope.pending.id,
          revealedCount: envelope.pending.revealedCount ?? 0,
        }
      }

      const legacyRaw = localStorage.getItem(legacyPendingKey)
      if (!legacyRaw) return null
      const pending = JSON.parse(legacyRaw) as {
        id: string
        revealedCount: number
      }
      return { id: pending.id, revealedCount: pending.revealedCount }
    },
    { legacyPendingKey: LEGACY_PENDING_KEY, tableV2Key: TABLE_V2_KEY },
  )
}

export async function readStoredGame(page: Page): Promise<StoredGameSnapshot> {
  return page.evaluate(
    ({ legacyGameKey, tableV2Key }) => {
      const v2Raw = localStorage.getItem(tableV2Key)
      const game = v2Raw
        ? (JSON.parse(v2Raw) as { game: Record<string, unknown> }).game
        : (JSON.parse(localStorage.getItem(legacyGameKey) ?? '{}') as Record<
            string,
            unknown
          >)
      const shoe = game.shoe as { handNumber?: number } | undefined
      const history = game.history as unknown[] | undefined
      return {
        balance: Number(game.balance ?? 0),
        handNumber: Number(shoe?.handNumber ?? 0),
        historyLength: history?.length ?? 0,
      }
    },
    { legacyGameKey: LEGACY_GAME_KEY, tableV2Key: TABLE_V2_KEY },
  )
}

export async function finishRoundWithKeyboard(page: Page): Promise<void> {
  const stage = page.locator('[data-table-phase]')
  const deadline = Date.now() + 35_000

  while (Date.now() < deadline) {
    const game = await readStoredGame(page)
    const pending = await readStoredPending(page)
    if (!pending && game.historyLength > 0) {
      await expect(stage).toHaveAttribute('data-table-phase', 'betting')
      return
    }

    const card = page.locator('.reveal-card.can-flip:not(:disabled)').first()
    if (await card.isVisible().catch(() => false)) {
      await card.focus()
      await card.press('Enter')
    } else {
      await page.waitForTimeout(80)
    }
  }

  throw new Error('The baccarat round did not return to betting in time.')
}
