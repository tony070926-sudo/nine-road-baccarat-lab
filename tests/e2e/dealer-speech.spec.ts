import { expect, test, type Page } from '@playwright/test'
import {
  EMPTY_BETS,
  createSeededRandomInt,
  createShoe,
  settleBets,
} from '../../src/game/baccarat'
import {
  completeSettlementPresentationState,
  prepareRoundState,
  settleRoundState,
} from '../../src/game/tableEngine'
import type { PersistedTableEnvelopeV2 } from '../../src/game/tableState'
import type { PersistedGameState } from '../../src/types'
import {
  finishRoundWithKeyboard,
  readStoredGame,
  readStoredPending,
  stubLeaderboardWrites,
} from './support/gameFixture'

type AuditedTableMutation = 'settle-round' | 'complete-presentation'

interface StoredPresentationPending {
  type: 'settlement'
  roundId: string
}

interface StorageMutationAudit {
  mutation: AuditedTableMutation
  revision: number
  pendingId: string | null
  presentationPending: StoredPresentationPending | null
  historyRoundIds: string[]
  balance: number
  handNumber: number
}

interface LocalTableWriteAudit {
  mutation: string
  lastWriterId: string | null
}

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
    presentationPending: null,
    game: prepared.game,
    pending: { ...prepared.pending, revealedCount },
  } as PersistedTableEnvelopeV2
}

function fullyRevealedSettlementEnvelope(): PersistedTableEnvelopeV2 {
  const envelope = dealerControlledThirdCardEnvelope()
  if (!envelope.pending)
    throw new Error('Settlement recovery fixture has no pending round')

  return {
    ...envelope,
    commitId: 'C-DEALER-SPEECH-SETTLEMENT',
    lastWriterId: 'W-DEALER-SPEECH-SETTLEMENT',
    presentationPending: null,
    pending: {
      ...envelope.pending,
      revealedCount: envelope.pending.result.dealOrder.length,
    },
  } as PersistedTableEnvelopeV2
}

function completedSettlementEnvelope(): PersistedTableEnvelopeV2 {
  const envelope = fullyRevealedSettlementEnvelope()
  if (!envelope.pending)
    throw new Error('Completed settlement fixture has no pending round')
  const roundId = envelope.pending.id
  const settled = settleRoundState(envelope, {
    roundId,
    settledAt: '2026-08-02T00:00:00.000Z',
  })
  const completed = completeSettlementPresentationState(settled.state, {
    roundId,
  })

  return {
    ...envelope,
    ...completed,
    revision: envelope.revision + 2,
    commitId: 'C-DEALER-SPEECH-COMPLETED',
    updatedAt: '2026-08-02T00:00:00.000Z',
    lastWriterId: 'W-DEALER-SPEECH-COMPLETED',
    lastMutation: 'complete-presentation',
  }
}

async function installControlledDealerSpeech(
  page: Page,
  envelope: PersistedTableEnvelopeV2,
  options: { seedTable?: boolean; tabId?: string } = {},
) {
  await page.addInitScript(({ seededEnvelope, seedTable, tabId }) => {
    const tableKey = 'nine-road-baccarat:table:v2'
    const markerKey = `dealer-speech:seed:${seededEnvelope.commitId}`
    const auditKey = `dealer-speech:mutations:${seededEnvelope.commitId}:${tabId}`
    const localWritesKey = `dealer-speech:local-writes:${seededEnvelope.commitId}:${tabId}`
    const originalSetItem = Storage.prototype.setItem
    if (seedTable && sessionStorage.getItem(markerKey) !== '1') {
      originalSetItem.call(
        localStorage,
        tableKey,
        JSON.stringify(seededEnvelope),
      )
      originalSetItem.call(sessionStorage, auditKey, '[]')
      originalSetItem.call(sessionStorage, markerKey, '1')
    }
    if (sessionStorage.getItem(auditKey) === null)
      originalSetItem.call(sessionStorage, auditKey, '[]')
    if (sessionStorage.getItem(localWritesKey) === null)
      originalSetItem.call(sessionStorage, localWritesKey, '[]')
    Storage.prototype.setItem = function (key, value) {
      originalSetItem.call(this, key, value)
      if (this !== localStorage || key !== tableKey) return
      try {
        const envelope = JSON.parse(value) as PersistedTableEnvelopeV2 & {
          presentationPending?: StoredPresentationPending | null
        }
        const mutation = String(envelope.lastMutation)
        const localWrites = JSON.parse(
          sessionStorage.getItem(localWritesKey) ?? '[]',
        ) as LocalTableWriteAudit[]
        localWrites.push({
          mutation,
          lastWriterId:
            typeof envelope.lastWriterId === 'string'
              ? envelope.lastWriterId
              : null,
        })
        originalSetItem.call(
          sessionStorage,
          localWritesKey,
          JSON.stringify(localWrites),
        )
        if (mutation !== 'settle-round' && mutation !== 'complete-presentation')
          return
        const audit = JSON.parse(
          sessionStorage.getItem(auditKey) ?? '[]',
        ) as StorageMutationAudit[]
        audit.push({
          mutation,
          revision: envelope.revision,
          pendingId: envelope.pending?.id ?? null,
          presentationPending: envelope.presentationPending ?? null,
          historyRoundIds: envelope.game.history.map((record) => record.id),
          balance: envelope.game.balance,
          handNumber: envelope.game.shoe.handNumber,
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
    const storageRevisions: number[] = []
    window.addEventListener('storage', (event) => {
      if (event.key !== tableKey || !event.newValue) return
      try {
        const revision = (JSON.parse(event.newValue) as { revision?: unknown })
          .revision
        if (typeof revision === 'number') storageRevisions.push(revision)
      } catch {
        // Malformed external writes remain the application's responsibility.
      }
    })
    const unsafeTableStates: Array<{
      phase: string | null
      enabledTargets: string[]
    }> = []
    let lastUnsafeTableState = ''
    const recordUnsafeTableState = (
      phase: string | null,
      enabledTargets: string[],
    ) => {
      if (phase !== 'betting' && enabledTargets.length === 0) return
      const signature = JSON.stringify({ phase, enabledTargets })
      if (signature === lastUnsafeTableState) return
      lastUnsafeTableState = signature
      unsafeTableStates.push({ phase, enabledTargets })
    }
    const captureUnsafeTableState = () => {
      const stage = document.querySelector<HTMLElement>('[data-table-phase]')
      if (!stage) return
      const phase = stage.getAttribute('data-table-phase')
      const enabledTargets = Array.from(
        stage.querySelectorAll<HTMLButtonElement>('button[data-bet-target]'),
      )
        .filter((target) => !target.disabled)
        .map((target) => target.dataset.betTarget ?? '')
      recordUnsafeTableState(phase, enabledTargets)
    }
    const originalSetAttribute = Element.prototype.setAttribute
    Element.prototype.setAttribute = function (name, value) {
      originalSetAttribute.call(this, name, value)
      if (name === 'data-table-phase' && value === 'betting') {
        recordUnsafeTableState('betting', [])
      } else if (
        name === 'data-bet-target' &&
        this instanceof HTMLButtonElement &&
        this.isConnected &&
        !this.disabled
      ) {
        recordUnsafeTableState(
          document
            .querySelector<HTMLElement>('[data-table-phase]')
            ?.getAttribute('data-table-phase') ?? null,
          [value],
        )
      }
    }
    const disabledDescriptor = Object.getOwnPropertyDescriptor(
      HTMLButtonElement.prototype,
      'disabled',
    )
    if (disabledDescriptor?.get && disabledDescriptor.set) {
      Object.defineProperty(HTMLButtonElement.prototype, 'disabled', {
        ...disabledDescriptor,
        set(this: HTMLButtonElement, value: boolean) {
          disabledDescriptor.set!.call(this, value)
          if (!value && this.isConnected && this.dataset.betTarget) {
            recordUnsafeTableState(
              document
                .querySelector<HTMLElement>('[data-table-phase]')
                ?.getAttribute('data-table-phase') ?? null,
              [this.dataset.betTarget],
            )
          }
        },
      })
    }
    const tableObserver = new MutationObserver(captureUnsafeTableState)
    const observeTable = () => {
      if (!document.documentElement) return
      tableObserver.observe(document.documentElement, {
        attributeFilter: ['data-table-phase', 'disabled'],
        attributeOldValue: true,
        attributes: true,
        childList: true,
        subtree: true,
      })
      captureUnsafeTableState()
    }
    if (document.documentElement) {
      observeTable()
    } else {
      document.addEventListener('DOMContentLoaded', observeTable, {
        once: true,
      })
    }
    const readMutationWrites = (): StorageMutationAudit[] => {
      try {
        return JSON.parse(
          sessionStorage.getItem(auditKey) ?? '[]',
        ) as StorageMutationAudit[]
      } catch {
        return []
      }
    }
    const readLocalTableWrites = (): LocalTableWriteAudit[] => {
      try {
        return JSON.parse(
          sessionStorage.getItem(localWritesKey) ?? '[]',
        ) as LocalTableWriteAudit[]
      } catch {
        return []
      }
    }
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
        get mutationWrites() {
          return readMutationWrites()
        },
        get localTableWrites() {
          return readLocalTableWrites()
        },
        storageRevisions,
        get settleWrites() {
          return readMutationWrites()
            .filter(({ mutation }) => mutation === 'settle-round')
            .map(({ revision, pendingId, historyRoundIds }) => ({
              revision,
              pendingId,
              historyRoundIds,
            }))
        },
        get unsafeTableStates() {
          captureUnsafeTableState()
          return unsafeTableStates
        },
        releaseCurrent: finishCurrent,
      },
    })
    localStorage.setItem('nine-road-baccarat:table-audio', 'on')
  }, {
    seededEnvelope: envelope,
    seedTable: options.seedTable ?? true,
    tabId: options.tabId ?? 'primary',
  })
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
          mutationWrites: StorageMutationAudit[]
          localTableWrites: LocalTableWriteAudit[]
          storageRevisions: number[]
          unsafeTableStates: Array<{
            phase: string | null
            enabledTargets: string[]
          }>
        }
      }
    ).__dealerSpeechHarness
    return {
      calls: [...harness.calls],
      cancelCount: harness.cancelCount,
      activeText: harness.activeText,
      settleWrites: harness.settleWrites,
      mutationWrites: harness.mutationWrites,
      localTableWrites: harness.localTableWrites,
      storageRevisions: [...harness.storageRevisions],
      unsafeTableStates: harness.unsafeTableStates,
    }
  })
}

async function readStoredPresentationPending(
  page: Page,
): Promise<StoredPresentationPending | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('nine-road-baccarat:table:v2')
    if (!raw) return null
    const envelope = JSON.parse(raw) as {
      presentationPending?: StoredPresentationPending | null
    }
    return envelope.presentationPending ?? null
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

function captureRuntimeErrors(page: Page, browserName: string): string[] {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => {
    if (
      browserName === 'webkit' &&
      /^\/127\.0\.0\.1:4173\/assets\/audio\/[a-z0-9-]+\.ogg due to access control checks\.$/u.test(
        error.message,
      )
    )
      return
    runtimeErrors.push(`pageerror: ${error.message}`)
  })
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
  return runtimeErrors
}

test('does not mistake clean betting hydration or audio toggles for a new opening', async ({
  page,
}) => {
  await stubLeaderboardWrites(page)
  await installControlledDealerSpeech(page, completedSettlementEnvelope())
  await page.goto('/')

  const stage = page.locator('[data-table-phase]')
  await expect(stage).toHaveAttribute('data-table-phase', 'betting')
  expect((await readDealerSpeech(page)).calls).toEqual([])

  await page.getByRole('button', { name: '关闭牌桌空间音效' }).click()
  await page.getByRole('button', { name: '开启牌桌空间音效' }).click()
  await page.waitForTimeout(250)
  expect((await readDealerSpeech(page)).calls).toEqual([])

  await page.reload()
  await expect(stage).toHaveAttribute('data-table-phase', 'betting')
  expect((await readDealerSpeech(page)).calls).toEqual([])
})

test('consumes a muted local opening without replaying it when audio is enabled', async ({
  page,
}) => {
  await stubLeaderboardWrites(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installControlledDealerSpeech(page, fullyRevealedSettlementEnvelope())
  await page.goto('/')

  const stage = page.locator('[data-table-phase]')
  await expect(stage).toHaveAttribute('data-table-phase', 'settling')
  await expect
    .poll(async () => (await readDealerSpeech(page)).activeText)
    .toMatch(/^(?:闲家|庄家)/u)

  await page.getByRole('button', { name: '关闭牌桌空间音效' }).click()
  await expect(stage).toHaveAttribute('data-table-phase', 'betting', {
    timeout: 15_000,
  })
  await expect.poll(() => readStoredPresentationPending(page)).toBeNull()
  expect((await readDealerSpeech(page)).calls).not.toContain('请下注')

  await page.getByRole('button', { name: '开启牌桌空间音效' }).click()
  await page.waitForTimeout(300)
  expect((await readDealerSpeech(page)).calls).not.toContain('请下注')
})

test('replays the opening call and physical third-card deal after boundary recovery @cross-browser', async ({
  page,
  browserName,
}) => {
  await stubLeaderboardWrites(page)
  const runtimeErrors = captureRuntimeErrors(page, browserName)
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
  await expect
    .poll(async () => (await readDealerSpeech(page)).calls.length)
    .toBe(4)
  const expectedSettlement = settleBets(
    envelope.pending.bets,
    envelope.pending.result,
  )
  const expectedBalance =
    envelope.pending.balanceBefore + expectedSettlement.net
  const completedGame = await readStoredGame(page)
  const completedSpeech = await readDealerSpeech(page)
  expect(completedSpeech.calls[3]).toBe('请下注')
  expect(completedSpeech.activeText).toBe('请下注')
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
  await expect(page.locator('[data-bet-target="player"]')).toBeEnabled()
  await page.locator('[data-bet-target="player"]').click()
  await page.waitForTimeout(500)
  expect(await readStoredGame(page)).toEqual(completedGame)
  expect(await readStoredPending(page)).toBeNull()
  expect((await readDealerSpeech(page)).settleWrites).toEqual(
    completedSpeech.settleWrites,
  )
  expect(
    (await readDealerSpeech(page)).calls.filter((call) => call === '请下注'),
  ).toHaveLength(1)
  expect(runtimeErrors).toEqual([])
})

test('resumes durable settlement presentation after reload without settling twice @cross-browser', async ({
  page,
  browserName,
}) => {
  await stubLeaderboardWrites(page)
  const runtimeErrors = captureRuntimeErrors(page, browserName)
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  const envelope = fullyRevealedSettlementEnvelope()
  if (!envelope.pending)
    throw new Error('Settlement recovery fixture has no pending round')
  const roundId = envelope.pending.id
  const expectedSettlement = settleBets(
    envelope.pending.bets,
    envelope.pending.result,
  )
  const expectedBalance =
    envelope.pending.balanceBefore + expectedSettlement.net
  const expectedMarker: StoredPresentationPending = {
    type: 'settlement',
    roundId,
  }

  await installControlledDealerSpeech(page, envelope)
  await page.goto('/')

  const stage = page.locator('[data-table-phase]')
  await expect(stage).toBeVisible()
  await expect
    .poll(
      async () =>
        (await readDealerSpeech(page)).mutationWrites.filter(
          ({ mutation }) => mutation === 'settle-round',
        ).length,
    )
    .toBe(1)
  await expect(stage).toHaveAttribute('data-table-phase', 'settling')
  expect(await readStoredPresentationPending(page)).toEqual(expectedMarker)
  expect(await readStoredPending(page)).toBeNull()

  const settledGame = await readStoredGame(page)
  expect(settledGame).toEqual({
    balance: expectedBalance,
    handNumber: envelope.pending.shoeAfter.handNumber,
    historyLength: 1,
  })
  const firstHeldCall = await readDealerSpeech(page)
  expect(firstHeldCall.calls).toHaveLength(1)
  expect(firstHeldCall.activeText).toBe(firstHeldCall.calls[0])
  expect(firstHeldCall.activeText).toMatch(
    /^闲家 \d 点，庄家 \d 点，(?:庄家胜|闲家胜|和局)$/u,
  )
  expect(firstHeldCall.unsafeTableStates).toEqual([])
  expect(
    firstHeldCall.mutationWrites.filter(
      ({ mutation }) => mutation === 'complete-presentation',
    ),
  ).toHaveLength(0)

  await page.reload()

  await expect(stage).toBeVisible()
  await expect
    .poll(async () => (await readDealerSpeech(page)).calls.length)
    .toBe(1)
  await expect(stage).toHaveAttribute('data-table-phase', 'settling')
  await expect(stage.locator('[data-table-card-id]')).toHaveCount(
    envelope.pending.result.cardsUsed,
    { timeout: 1_000 },
  )
  for (const target of ['player', 'banker', 'tie']) {
    await expect(page.locator(`[data-bet-target="${target}"]`)).toBeDisabled()
  }
  const reloadedHeldCall = await readDealerSpeech(page)
  expect(reloadedHeldCall.activeText).toBe(reloadedHeldCall.calls[0])
  expect(reloadedHeldCall.activeText).toMatch(
    /^闲家 \d 点，庄家 \d 点，(?:庄家胜|闲家胜|和局)$/u,
  )
  expect(reloadedHeldCall.unsafeTableStates).toEqual([])
  expect(await readStoredPresentationPending(page)).toEqual(expectedMarker)
  expect(await readStoredPending(page)).toBeNull()
  expect(await readStoredGame(page)).toEqual(settledGame)
  expect(
    reloadedHeldCall.mutationWrites.filter(
      ({ mutation }) => mutation === 'settle-round',
    ),
  ).toHaveLength(1)
  expect(
    reloadedHeldCall.mutationWrites.filter(
      ({ mutation }) => mutation === 'complete-presentation',
    ),
  ).toHaveLength(0)

  await releaseCurrentDealerCall(page)
  const tableCards = stage.locator('[data-table-card-id]')
  const procedureTrack = page.locator('[data-dealer-procedure-track]')
  await expect(page.locator('[data-dealer-settlement-state]')).toBeVisible()
  await expect(tableCards).toHaveCount(envelope.pending.result.cardsUsed)
  await expect(procedureTrack).toHaveAttribute(
    'data-current-step-id',
    /^(collect-losing-wagers|return-pushed-wagers|pay-winning-wagers)$/u,
  )
  await expect(procedureTrack).toHaveAttribute(
    'data-current-step-id',
    'record-road',
  )
  await expect(tableCards).toHaveCount(envelope.pending.result.cardsUsed)
  await expect(page.locator('.road-result-cell')).toHaveCount(1)
  const sweep = page.locator('.dealer-card-sweep-action')
  await expect(sweep).toHaveAttribute('data-card-sweep-round-id', roundId)
  await expect(stage).toHaveAttribute('data-table-phase', 'clearing')
  await expect(tableCards).toHaveCount(envelope.pending.result.cardsUsed)
  await expect(tableCards.first()).toHaveAttribute(
    'data-card-sweep-round-id',
    roundId,
  )
  await expect
    .poll(() => readStoredPresentationPending(page), { timeout: 15_000 })
    .toBeNull()
  await expect(stage).toHaveAttribute('data-table-phase', 'betting', {
    timeout: 15_000,
  })
  await expect
    .poll(async () => (await readDealerSpeech(page)).calls.length)
    .toBe(2)
  for (const target of ['player', 'banker', 'tie']) {
    await expect(page.locator(`[data-bet-target="${target}"]`)).toBeEnabled()
  }
  await expect(page.locator('.mini-result')).toHaveCount(1)
  await expect(page.locator('.road-result-cell')).toHaveCount(1)
  await expect(page.locator('[data-card-sweep-round-id]')).toHaveCount(0)

  const completedGame = await readStoredGame(page)
  const completedSpeech = await readDealerSpeech(page)
  expect(completedSpeech.calls[0]).toMatch(
    /^闲家 \d 点，庄家 \d 点，(?:庄家胜|闲家胜|和局)$/u,
  )
  expect(completedSpeech.calls[1]).toBe('请下注')
  expect(completedSpeech.activeText).toBe('请下注')
  expect(completedGame).toEqual(settledGame)
  expect(await readStoredPending(page)).toBeNull()
  expect(completedSpeech.mutationWrites).toEqual([
    {
      mutation: 'settle-round',
      revision: envelope.revision + 1,
      pendingId: null,
      presentationPending: expectedMarker,
      historyRoundIds: [roundId],
      balance: expectedBalance,
      handNumber: envelope.pending.shoeAfter.handNumber,
    },
    {
      mutation: 'complete-presentation',
      revision: envelope.revision + 2,
      pendingId: null,
      presentationPending: null,
      historyRoundIds: [roundId],
      balance: expectedBalance,
      handNumber: envelope.pending.shoeAfter.handNumber,
    },
  ])
  expect(completedSpeech.settleWrites).toHaveLength(1)
  expect(completedSpeech.cancelCount).toBe(0)
  await page.waitForTimeout(300)
  expect(await readStoredGame(page)).toEqual(completedGame)
  expect(await readStoredPresentationPending(page)).toBeNull()
  expect((await readDealerSpeech(page)).mutationWrites).toEqual(
    completedSpeech.mutationWrites,
  )
  expect((await readDealerSpeech(page)).calls).toEqual(completedSpeech.calls)
  expect(runtimeErrors).toEqual([])
})

test('keeps a passive tab read-only while the owner completes settlement', async ({
  page: owner,
  browserName,
}) => {
  await stubLeaderboardWrites(owner)
  const ownerErrors = captureRuntimeErrors(owner, browserName)
  await owner.emulateMedia({ reducedMotion: 'reduce' })
  const envelope = fullyRevealedSettlementEnvelope()
  if (!envelope.pending) throw new Error('Multi-tab fixture has no pending round')
  const roundId = envelope.pending.id
  const expectedMarker = { type: 'settlement' as const, roundId }
  await installControlledDealerSpeech(owner, envelope, {
    seedTable: true,
    tabId: 'owner',
  })
  await owner.goto('/')

  const ownerStage = owner.locator('[data-table-phase]')
  await expect(ownerStage).toHaveAttribute('data-table-phase', 'settling')
  await expect
    .poll(
      async () =>
        (await readDealerSpeech(owner)).mutationWrites.filter(
          ({ mutation }) => mutation === 'settle-round',
        ).length,
    )
    .toBe(1)
  expect(await readStoredPresentationPending(owner)).toEqual(expectedMarker)
  expect((await readDealerSpeech(owner)).activeText).toMatch(
    /^闲家 \d 点，庄家 \d 点，(?:庄家胜|闲家胜|和局)$/u,
  )
  expect(
    await owner.evaluate(async () => {
      const locks = await navigator.locks.query()
      return locks.held?.some(
        (lock) => lock.name === 'nine-road-baccarat:active-table:v1',
      )
    }),
  ).toBe(true)

  const observer = await owner.context().newPage()
  await stubLeaderboardWrites(observer)
  const observerErrors = captureRuntimeErrors(observer, browserName)
  await observer.emulateMedia({ reducedMotion: 'reduce' })
  await installControlledDealerSpeech(observer, envelope, {
    seedTable: false,
    tabId: 'observer',
  })
  await observer.goto('/')

  const observerStage = observer.locator('[data-table-phase]')
  await expect(observerStage).toHaveAttribute('data-table-phase', 'settling')
  await expect(observer.locator('[data-bet-target]')).toHaveCount(5)
  for (const target of await observer.locator('[data-bet-target]').all()) {
    await expect(target).toBeDisabled()
  }
  await observer.waitForTimeout(1_250)
  await expect(observerStage).toHaveAttribute('data-table-phase', 'settling')
  const passiveWhileLocked = await readDealerSpeech(observer)
  expect(passiveWhileLocked.calls).toEqual([])
  expect(passiveWhileLocked.localTableWrites).toEqual([])
  expect(passiveWhileLocked.unsafeTableStates).toEqual([])
  expect(await readStoredPresentationPending(observer)).toEqual(expectedMarker)
  expect((await readDealerSpeech(owner)).localTableWrites.map(({ mutation }) => mutation)).toEqual([
    'settle-round',
  ])

  await releaseCurrentDealerCall(owner)
  await expect
    .poll(() => readStoredPresentationPending(owner), { timeout: 15_000 })
    .toBeNull()
  await expect(ownerStage).toHaveAttribute('data-table-phase', 'betting')
  await expect(observerStage).toHaveAttribute('data-table-phase', 'betting')

  const ownerCompleted = await readDealerSpeech(owner)
  const observerCompleted = await readDealerSpeech(observer)
  expect(ownerCompleted.calls).toHaveLength(2)
  expect(ownerCompleted.calls[1]).toBe('请下注')
  expect(ownerCompleted.localTableWrites.map(({ mutation }) => mutation)).toEqual([
    'settle-round',
    'complete-presentation',
  ])
  expect(
    new Set(
      ownerCompleted.localTableWrites.map(({ lastWriterId }) => lastWriterId),
    ).size,
  ).toBe(1)
  expect(observerCompleted.calls).toEqual([])
  expect(observerCompleted.localTableWrites).toEqual([])
  expect(await readStoredPending(observer)).toBeNull()
  expect((await readStoredGame(observer)).historyLength).toBe(1)
  expect(ownerErrors).toEqual([])
  expect(observerErrors).toEqual([])
  await observer.close()
})

test('keeps betting locked when the presentation marker disappears without an explicit completion', async ({
  page,
  browserName,
}) => {
  await stubLeaderboardWrites(page)
  const runtimeErrors = captureRuntimeErrors(page, browserName)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const envelope = fullyRevealedSettlementEnvelope()
  await installControlledDealerSpeech(page, envelope)
  await page.goto('/')

  const stage = page.locator('[data-table-phase]')
  await expect(stage).toHaveAttribute('data-table-phase', 'settling')
  await expect
    .poll(() => readStoredPresentationPending(page))
    .not.toBeNull()
  await expect
    .poll(async () => (await readDealerSpeech(page)).activeText)
    .toMatch(/^(?:闲家|庄家)/u)

  await page.evaluate(() => {
    const tableKey = 'nine-road-baccarat:table:v2'
    const raw = localStorage.getItem(tableKey)
    if (!raw) throw new Error('Expected durable table envelope')
    const current = JSON.parse(raw) as PersistedTableEnvelopeV2
    localStorage.setItem(
      tableKey,
      JSON.stringify({
        ...current,
        revision: current.revision + 1,
        commitId: 'C-ILLEGAL-MARKER-REMOVAL',
        updatedAt: new Date().toISOString(),
        lastWriterId: 'W-ILLEGAL-MARKER-REMOVAL',
        lastMutation: 'replace-shoe',
        presentationPending: null,
      } satisfies PersistedTableEnvelopeV2),
    )
  })
  expect(await readStoredPresentationPending(page)).toBeNull()

  await releaseCurrentDealerCall(page)
  await expect(
    page.getByText('收牌已完成，但结算流程标记未能安全清除。', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(stage).toHaveAttribute('data-table-phase', 'settling')
  for (const target of await page.locator('[data-bet-target]').all()) {
    await expect(target).toBeDisabled()
  }
  const frozen = await readDealerSpeech(page)
  expect(frozen.calls).not.toContain('请下注')
  expect(
    frozen.mutationWrites.filter(
      ({ mutation }) => mutation === 'complete-presentation',
    ),
  ).toEqual([])
  expect(frozen.unsafeTableStates).toEqual([])
  expect(runtimeErrors).toEqual([])

  const externalWriter = await page.context().newPage()
  await externalWriter.route('**/*', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }),
  )
  await externalWriter.goto('/')
  const writeCleanSnapshot = (
    lastMutation: 'reset' | 'complete-presentation',
  ) =>
    externalWriter.evaluate((mutation) => {
      const tableKey = 'nine-road-baccarat:table:v2'
      const raw = localStorage.getItem(tableKey)
      if (!raw) throw new Error('Expected external durable table envelope')
      const current = JSON.parse(raw) as PersistedTableEnvelopeV2
      const next = {
        ...current,
        revision: current.revision + 1,
        commitId: `C-EXTERNAL-${mutation}-${current.revision + 1}`,
        updatedAt: new Date().toISOString(),
        lastWriterId: 'W-EXTERNAL-INTEGRITY-TEST',
        lastMutation: mutation,
        pending: null,
        presentationPending: null,
      } satisfies PersistedTableEnvelopeV2
      localStorage.setItem(tableKey, JSON.stringify(next))
      return next.revision
    }, lastMutation)

  const rejectedRevision = await writeCleanSnapshot('reset')
  await expect
    .poll(async () => (await readDealerSpeech(page)).storageRevisions)
    .toContain(rejectedRevision)
  await expect(stage).toHaveAttribute('data-table-phase', 'settling')
  for (const target of await page.locator('[data-bet-target]').all()) {
    await expect(target).toBeDisabled()
  }

  const completedRevision = await writeCleanSnapshot('complete-presentation')
  await expect
    .poll(async () => (await readDealerSpeech(page)).storageRevisions)
    .toContain(completedRevision)
  await expect(stage).toHaveAttribute('data-table-phase', 'betting')
  for (const target of await page.locator('[data-bet-target]').all()) {
    await expect(target).toBeEnabled()
  }
  expect((await readDealerSpeech(page)).calls).not.toContain('请下注')
  await externalWriter.close()
  expect(runtimeErrors).toEqual([])
})

test('waits for the full initial point call before dealing a third card @cross-browser', async ({
  page,
  browserName,
}) => {
  await stubLeaderboardWrites(page)
  const runtimeErrors = captureRuntimeErrors(page, browserName)
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
  expect(completedSpeech.calls).toHaveLength(4)
  expect(completedSpeech.calls[0]).toMatch(/^闲家 \d 点，庄家 \d 点/u)
  expect(completedSpeech.calls).toContain('补牌')
  expect(completedSpeech.calls[2]).toMatch(
    /^闲家 \d 点，庄家 \d 点，(?:庄家胜|闲家胜|和局)$/u,
  )
  expect(completedSpeech.calls[3]).toBe('请下注')
  expect(completedSpeech.activeText).toBe('请下注')
  expect(completedSpeech.cancelCount).toBe(0)
  expect((await readStoredGame(page)).historyLength).toBe(1)
  expect(await readStoredPending(page)).toBeNull()
  await expect(page.locator('.mini-result')).toHaveCount(1)
  await expect(page.locator('.road-result-cell')).toHaveCount(1)
  await page.locator('[data-bet-target="player"]').click()
  await page.waitForTimeout(200)
  expect(
    (await readDealerSpeech(page)).calls.filter((call) => call === '请下注'),
  ).toHaveLength(1)
  expect(runtimeErrors).toEqual([])
})
