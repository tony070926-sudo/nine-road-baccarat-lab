import { expect, test, type Page } from '@playwright/test'
import {
  EMPTY_BETS,
  createSeededRandomInt,
  createShoe,
  settleBets,
} from '../../src/game/baccarat'
import { prepareRoundState } from '../../src/game/tableEngine'
import type { PersistedTableEnvelopeV2 } from '../../src/game/tableState'
import type { PersistedGameState } from '../../src/types'
import {
  finishRoundWithKeyboard,
  readStoredGame,
  readStoredPending,
  stubLeaderboardWrites,
} from './support/gameFixture'

function dealerControlledThirdCardEnvelope(
  revealedCount = 0,
): PersistedTableEnvelopeV2 {
  const game: PersistedGameState = {
    version: 1,
    balance: 10_000,
    shoe: createShoe(createSeededRandomInt(7), 'S-DEALER-SPEECH-THIRD'),
    history: [],
    lastBets: { ...EMPTY_BETS },
    sessionStartedAt: '2026-08-01T00:00:00.000Z',
  }
  const prepared = prepareRoundState(
    { game, pending: null },
    {
      bets: { ...EMPTY_BETS, player: 100 },
      playMode: 'bet',
      revealControl: 'dealer-reveal',
      roundId: 'R-DEALER-SPEECH-THIRD',
    },
  )
  if (!prepared.pending) throw new Error('Seeded round was not prepared')
  if (
    prepared.pending.result.playerCards.length !== 2 ||
    prepared.pending.result.bankerCards.length !== 3
  ) {
    throw new Error('Seeded round must require a Banker third card')
  }

  return {
    schemaVersion: 2,
    revision: 1,
    commitId: 'C-DEALER-SPEECH-THIRD',
    updatedAt: '2026-08-01T00:00:00.000Z',
    lastWriterId: 'W-DEALER-SPEECH-THIRD',
    lastMutation: 'prepare-round',
    game: prepared.game,
    pending: { ...prepared.pending, revealedCount },
  }
}

async function installControlledDealerSpeech(
  page: Page,
  envelope: PersistedTableEnvelopeV2,
) {
  await page.addInitScript((seededEnvelope) => {
    const tableKey = 'nine-road-baccarat:table:v2'
    const markerKey = `dealer-speech:seed:${seededEnvelope.commitId}`
    const auditKey = `dealer-speech:settles:${seededEnvelope.commitId}`
    const originalSetItem = Storage.prototype.setItem
    if (sessionStorage.getItem(markerKey) !== '1') {
      originalSetItem.call(
        localStorage,
        tableKey,
        JSON.stringify(seededEnvelope),
      )
      originalSetItem.call(sessionStorage, auditKey, '[]')
      originalSetItem.call(sessionStorage, markerKey, '1')
    }
    Storage.prototype.setItem = function (key, value) {
      originalSetItem.call(this, key, value)
      if (this !== localStorage || key !== tableKey) return
      try {
        const envelope = JSON.parse(value) as PersistedTableEnvelopeV2
        if (envelope.lastMutation !== 'settle-round') return
        const audit = JSON.parse(
          sessionStorage.getItem(auditKey) ?? '[]',
        ) as unknown[]
        audit.push({
          revision: envelope.revision,
          pendingId: envelope.pending?.id ?? null,
          historyRoundIds: envelope.game.history.map((record) => record.id),
        })
        originalSetItem.call(sessionStorage, auditKey, JSON.stringify(audit))
      } catch {
        // Test audit must never alter the application's storage semantics.
      }
    }

    class ControlledUtterance {
      text: string
      lang = ''
      rate = 1
      pitch = 1
      volume = 1
      voice: SpeechSynthesisVoice | null = null
      onend: (() => void) | null = null
      onerror: (() => void) | null = null

      constructor(text: string) {
        this.text = text
      }
    }

    let active: ControlledUtterance | null = null
    let cancelCount = 0
    const calls: string[] = []
    const finishCurrent = () => {
      const utterance = active
      active = null
      utterance?.onend?.()
    }

    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: ControlledUtterance,
    })
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel: () => {
          cancelCount += 1
          active = null
        },
        getVoices: () => [],
        speak: (utterance: ControlledUtterance) => {
          calls.push(utterance.text)
          active = utterance
        },
      },
    })
    Object.defineProperty(window, '__dealerSpeechHarness', {
      configurable: true,
      value: {
        calls,
        get cancelCount() {
          return cancelCount
        },
        get activeText() {
          return active?.text ?? null
        },
        get settleWrites() {
          try {
            return JSON.parse(sessionStorage.getItem(auditKey) ?? '[]')
          } catch {
            return []
          }
        },
        releaseCurrent: finishCurrent,
      },
    })
    localStorage.setItem('nine-road-baccarat:table-audio', 'on')
  }, envelope)
}

async function readDealerSpeech(page: Page) {
  return page.evaluate(() => {
    const harness = (
      window as typeof window & {
        __dealerSpeechHarness: {
          calls: string[]
          cancelCount: number
          activeText: string | null
          settleWrites: Array<{
            revision: number
            pendingId: string | null
            historyRoundIds: string[]
          }>
        }
      }
    ).__dealerSpeechHarness
    return {
      calls: [...harness.calls],
      cancelCount: harness.cancelCount,
      activeText: harness.activeText,
      settleWrites: harness.settleWrites,
    }
  })
}

async function releaseCurrentDealerCall(page: Page) {
  await page.evaluate(() => {
    ;(
      window as typeof window & {
        __dealerSpeechHarness: { releaseCurrent: () => void }
      }
    ).__dealerSpeechHarness.releaseCurrent()
  })
}

test('replays the opening call and physical third-card deal after boundary recovery @cross-browser', async ({
  page,
  browserName,
}) => {
  await stubLeaderboardWrites(page)
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) =>
    runtimeErrors.push(`pageerror: ${error.message}`),
  )
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const value = message.text()
    if (
      browserName === 'firefox' &&
      value.includes('downloadable font: download failed') &&
      value.includes('source: http://127.0.0.1:4173/assets/')
    )
      return
    runtimeErrors.push(`console: ${value}`)
  })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const envelope = dealerControlledThirdCardEnvelope(4)
  if (!envelope.pending)
    throw new Error('Recovery fixture has no pending round')
  const thirdCard = envelope.pending.result.bankerCards[2]
  if (!thirdCard) throw new Error('Recovery fixture has no Banker third card')
  await installControlledDealerSpeech(page, envelope)
  await page.goto('/')

  const stage = page.locator('[data-table-phase]')
  const recoveredThirdCard = page.locator(
    `[data-reveal-card-id="${thirdCard.id}"]`,
  )
  await expect(stage).toBeVisible()
  await expect(page.getByRole('status')).toContainText('荷官重新宣读开局点数')
  await expect(stage).toHaveAttribute('data-dealt-card-count', '4')
  await expect(recoveredThirdCard).toHaveClass(/is-waiting-deal/)
  expect((await readStoredPending(page))?.revealedCount).toBe(4)
  await page.waitForTimeout(700)
  expect((await readStoredPending(page))?.revealedCount).toBe(4)
  const openingSpeech = await readDealerSpeech(page)
  expect(openingSpeech.calls).toHaveLength(1)
  expect(openingSpeech.calls[0]).toMatch(/^闲家 \d 点，庄家 \d 点/u)

  await page.reload()
  await expect(page.getByRole('status')).toContainText('荷官重新宣读开局点数')
  await expect(stage).toHaveAttribute('data-dealt-card-count', '4')
  await expect(recoveredThirdCard).toHaveClass(/is-waiting-deal/)
  await expect
    .poll(async () => (await readDealerSpeech(page)).calls.length)
    .toBe(1)
  expect((await readStoredPending(page))?.revealedCount).toBe(4)
  expect((await readDealerSpeech(page)).calls[0]).toMatch(
    /^闲家 \d 点，庄家 \d 点/u,
  )

  await page.getByRole('button', { name: '打开体验设置' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await releaseCurrentDealerCall(page)
  await expect
    .poll(async () => (await readDealerSpeech(page)).calls.length)
    .toBe(2)
  const thirdCardSpeech = await readDealerSpeech(page)
  expect(thirdCardSpeech.calls[1]).toBe('补牌')
  expect(thirdCardSpeech.activeText).toBe('补牌')
  await expect(recoveredThirdCard).toHaveClass(/is-being-dealt/)
  await expect(stage).toHaveAttribute('data-dealt-card-count', '5')
  await expect(recoveredThirdCard).toHaveClass(/is-placed/)
  expect((await readStoredPending(page))?.revealedCount).toBe(4)

  await releaseCurrentDealerCall(page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect
    .poll(async () => (await readStoredGame(page)).historyLength)
    .toBe(1)
  expect(await readStoredPending(page)).toBeNull()
  await expect
    .poll(async () => (await readDealerSpeech(page)).calls.length)
    .toBe(3)
  const resultSpeech = await readDealerSpeech(page)
  expect(resultSpeech.calls[2]).toMatch(
    /^闲家 \d 点，庄家 \d 点，(?:庄家胜|闲家胜|和局)$/u,
  )
  expect(resultSpeech.activeText).toBe(resultSpeech.calls[2])

  await releaseCurrentDealerCall(page)
  await finishRoundWithKeyboard(page, 1, 15_000)
  const expectedSettlement = settleBets(
    envelope.pending.bets,
    envelope.pending.result,
  )
  const expectedBalance =
    envelope.pending.balanceBefore + expectedSettlement.net
  const completedGame = await readStoredGame(page)
  const completedSpeech = await readDealerSpeech(page)
  expect(completedSpeech.cancelCount).toBe(0)
  expect(completedSpeech.settleWrites).toEqual([
    {
      revision: envelope.revision + 2,
      pendingId: null,
      historyRoundIds: [envelope.pending.id],
    },
  ])
  expect(completedGame).toEqual({
    balance: expectedBalance,
    handNumber: envelope.pending.shoeAfter.handNumber,
    historyLength: 1,
  })
  await page.waitForTimeout(500)
  expect(await readStoredGame(page)).toEqual(completedGame)
  expect(await readStoredPending(page)).toBeNull()
  expect((await readDealerSpeech(page)).settleWrites).toEqual(
    completedSpeech.settleWrites,
  )
  expect(runtimeErrors).toEqual([])
})

test('waits for the full initial point call before dealing a third card @cross-browser', async ({
  page,
  browserName,
}) => {
  await stubLeaderboardWrites(page)
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) =>
    runtimeErrors.push(`pageerror: ${error.message}`),
  )
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const value = message.text()
    if (
      browserName === 'firefox' &&
      value.includes('downloadable font: download failed') &&
      value.includes('source: http://127.0.0.1:4173/assets/')
    )
      return
    runtimeErrors.push(`console: ${value}`)
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installControlledDealerSpeech(page, dealerControlledThirdCardEnvelope())
  await page.goto('/')
  await expect(page.locator('[data-table-phase]')).toBeVisible()

  await expect
    .poll(async () => (await readStoredPending(page))?.revealedCount)
    .toBe(4)
  await expect(page.getByRole('status')).toContainText('荷官宣读开局点数')
  await page.waitForTimeout(180)
  expect((await readStoredPending(page))?.revealedCount).toBe(4)
  expect((await readStoredGame(page)).historyLength).toBe(0)
  const heldSpeech = await readDealerSpeech(page)
  expect(heldSpeech.calls).toHaveLength(1)
  expect(heldSpeech.calls[0]).toMatch(/^闲家 \d 点，庄家 \d 点/u)
  expect(heldSpeech.cancelCount).toBe(0)

  await releaseCurrentDealerCall(page)
  await expect
    .poll(async () => (await readDealerSpeech(page)).calls.length)
    .toBe(2)
  const thirdCardSpeech = await readDealerSpeech(page)
  expect(thirdCardSpeech.calls[1]).toBe('补牌')
  expect(thirdCardSpeech.activeText).toBe('补牌')
  expect(thirdCardSpeech.cancelCount).toBe(0)

  await expect
    .poll(async () => (await readStoredGame(page)).historyLength)
    .toBe(1)
  expect(await readStoredPending(page)).toBeNull()
  expect((await readDealerSpeech(page)).calls).toHaveLength(2)
  await expect(page.locator('[data-table-phase]')).not.toHaveAttribute(
    'data-table-phase',
    'betting',
  )

  await releaseCurrentDealerCall(page)
  await expect
    .poll(async () => (await readDealerSpeech(page)).calls.length)
    .toBe(3)
  const resultSpeech = await readDealerSpeech(page)
  expect(resultSpeech.calls[2]).toMatch(
    /^闲家 \d 点，庄家 \d 点，(?:庄家胜|闲家胜|和局)$/u,
  )
  expect(resultSpeech.activeText).toBe(resultSpeech.calls[2])
  await page.waitForTimeout(350)
  await expect(page.locator('[data-table-phase]')).toHaveAttribute(
    'data-table-phase',
    'settling',
  )
  const heldResultSpeech = await readDealerSpeech(page)
  expect(heldResultSpeech.calls).toHaveLength(3)
  expect(heldResultSpeech.activeText).toBe(resultSpeech.calls[2])
  for (const target of ['player', 'banker', 'tie']) {
    await expect(page.locator(`[data-bet-target="${target}"]`)).toBeDisabled()
  }
  await expect(page.locator('[data-dealer-procedure-track]')).toHaveAttribute(
    'data-current-step-id',
    'announce-final-result',
  )
  await expect(page.locator('.mini-result')).toHaveCount(0)
  await expect(page.locator('.road-result-cell')).toHaveCount(0)
  await expect(page.locator('.dealer-table-action-sequence')).toHaveCount(0)
  await expect(page.locator('[data-card-sweep-round-id]')).toHaveCount(0)

  await releaseCurrentDealerCall(page)
  await finishRoundWithKeyboard(page, 1, 15_000)
  await page.waitForTimeout(350)

  const completedSpeech = await readDealerSpeech(page)
  expect(completedSpeech.calls).toHaveLength(3)
  expect(completedSpeech.calls[0]).toMatch(/^闲家 \d 点，庄家 \d 点/u)
  expect(completedSpeech.calls).toContain('补牌')
  expect(completedSpeech.calls.at(-1)).toMatch(
    /^闲家 \d 点，庄家 \d 点，(?:庄家胜|闲家胜|和局)$/u,
  )
  expect(completedSpeech.cancelCount).toBe(0)
  expect((await readStoredGame(page)).historyLength).toBe(1)
  expect(await readStoredPending(page)).toBeNull()
  await expect(page.locator('.mini-result')).toHaveCount(1)
  await expect(page.locator('.road-result-cell')).toHaveCount(1)
  expect(runtimeErrors).toEqual([])
})
