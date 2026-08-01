import { expect, test, type Page } from '@playwright/test'
import {
  EMPTY_BETS,
  createSeededRandomInt,
  createShoe,
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

function dealerControlledThirdCardEnvelope(): PersistedTableEnvelopeV2 {
  const game: PersistedGameState = {
    version: 1,
    balance: 10_000,
    shoe: createShoe(
      createSeededRandomInt(7),
      'S-DEALER-SPEECH-THIRD',
    ),
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
    ...prepared,
  }
}

async function installControlledDealerSpeech(
  page: Page,
  envelope: PersistedTableEnvelopeV2,
) {
  await page.addInitScript((seededEnvelope) => {
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
        releaseCurrent: finishCurrent,
      },
    })
    localStorage.setItem(
      'nine-road-baccarat:table:v2',
      JSON.stringify(seededEnvelope),
    )
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
        }
      }
    ).__dealerSpeechHarness
    return {
      calls: [...harness.calls],
      cancelCount: harness.cancelCount,
      activeText: harness.activeText,
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

test('waits for the full initial point call before dealing a third card @cross-browser', async ({
  page,
  browserName,
}) => {
  await stubLeaderboardWrites(page)
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const value = message.text()
    if (
      browserName === 'firefox' &&
      value.includes('downloadable font: download failed') &&
      value.includes('source: http://127.0.0.1:4173/assets/')
    ) return
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
  await expect.poll(async () => (await readDealerSpeech(page)).calls.length).toBe(2)
  const thirdCardSpeech = await readDealerSpeech(page)
  expect(thirdCardSpeech.calls[1]).toBe('补牌')
  expect(thirdCardSpeech.activeText).toBe('补牌')
  expect(thirdCardSpeech.cancelCount).toBe(0)

  await expect.poll(async () => (await readStoredGame(page)).historyLength).toBe(1)
  expect(await readStoredPending(page)).toBeNull()
  expect((await readDealerSpeech(page)).calls).toHaveLength(2)
  await expect(page.locator('[data-table-phase]')).not.toHaveAttribute(
    'data-table-phase',
    'betting',
  )

  await releaseCurrentDealerCall(page)
  await expect.poll(async () => (await readDealerSpeech(page)).calls.length).toBe(3)
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
