import type {
  Bets,
  Card,
  DealResult,
  PersistedGameState,
  PersistedPendingRound,
  RoundRecord,
  Settlement,
  ShoeState,
} from '../types'
import {
  CUT_CARDS_REMAINING,
  RULESET_VERSION,
  SHUFFLE_VERSION,
  bankerShouldDraw,
  burnValue,
  cardPoint,
  handTotal,
  settleBets,
  totalBets,
  validateBets,
} from './baccarat'

type UnknownRecord = Record<string, unknown>

const BET_KEYS = [
  'player',
  'banker',
  'tie',
  'playerPair',
  'bankerPair',
] as const satisfies readonly (keyof Bets)[]

const CARD_KEYS = ['id', 'suit', 'rank', 'deck'] as const
const SHOE_KEYS = [
  'id',
  'cards',
  'cursor',
  'cutAtRemaining',
  'burnCard',
  'burnedCards',
  'handNumber',
  'shuffleVersion',
  'needsShuffle',
] as const
const RESULT_KEYS = [
  'playerCards',
  'bankerCards',
  'dealOrder',
  'playerTotal',
  'bankerTotal',
  'winner',
  'natural',
  'playerPair',
  'bankerPair',
  'cardsUsed',
] as const
const SETTLEMENT_KEYS = [
  'totalStake',
  'totalReturned',
  'net',
  'breakdown',
] as const
const RECORD_KEYS = [
  ...RESULT_KEYS,
  'id',
  'shoeId',
  'handNumber',
  'timestamp',
  'bets',
  'settlement',
  'balanceBefore',
  'balanceAfter',
  'cardsRemaining',
  'rulesetVersion',
  'shuffleVersion',
] as const
const GAME_KEYS = [
  'version',
  'balance',
  'shoe',
  'history',
  'lastBets',
  'sessionStartedAt',
] as const
const PENDING_KEYS = [
  'version',
  'id',
  'playMode',
  'bets',
  'balanceBefore',
  'sourceShoeId',
  'sourceCursor',
  'shoeAfter',
  'result',
  'revealedCount',
] as const

const SUITS = new Set(['spades', 'hearts', 'diamonds', 'clubs'])
const RANKS = new Set([
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
])
const WINNERS = new Set(['player', 'banker', 'tie'])
const PHYSICAL_CARD_COUNT = 416
const MAX_HISTORY = 500

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional])
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSafeIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  )
}

function isMoney(value: unknown, allowNegative = false): value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > Number.MAX_SAFE_INTEGER ||
    !Number.isSafeInteger(value * 2)
  ) {
    return false
  }
  return allowNegative || value >= 0
}

function numbersMatch(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-9
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isCard(value: unknown): value is Card {
  if (!isRecord(value) || !hasOnlyKeys(value, CARD_KEYS)) return false
  if (
    !isNonEmptyString(value.id) ||
    !SUITS.has(value.suit as string) ||
    !RANKS.has(value.rank as string) ||
    !isSafeIntegerInRange(value.deck, 1, 8)
  ) {
    return false
  }

  return value.id === `${value.deck}-${value.suit as string}-${value.rank as string}`
}

function cardsMatch(left: Card, right: Card): boolean {
  return (
    left.id === right.id &&
    left.suit === right.suit &&
    left.rank === right.rank &&
    left.deck === right.deck
  )
}

function cardArraysMatch(left: readonly Card[], right: readonly Card[]): boolean {
  return (
    left.length === right.length &&
    left.every((card, index) => cardsMatch(card, right[index]))
  )
}

function isShoeState(value: unknown): value is ShoeState {
  if (!isRecord(value) || !hasOnlyKeys(value, SHOE_KEYS)) return false
  if (
    !isNonEmptyString(value.id) ||
    !Array.isArray(value.cards) ||
    value.cards.length !== PHYSICAL_CARD_COUNT ||
    !value.cards.every(isCard) ||
    !isCard(value.burnCard) ||
    !isSafeIntegerInRange(value.cursor, 0, PHYSICAL_CARD_COUNT) ||
    value.cutAtRemaining !== CUT_CARDS_REMAINING ||
    !isSafeIntegerInRange(value.burnedCards, 0, PHYSICAL_CARD_COUNT) ||
    !isSafeIntegerInRange(value.handNumber, 0, PHYSICAL_CARD_COUNT / 4) ||
    value.shuffleVersion !== SHUFFLE_VERSION ||
    typeof value.needsShuffle !== 'boolean'
  ) {
    return false
  }

  const cards = value.cards as Card[]
  if (new Set(cards.map((card) => card.id)).size !== PHYSICAL_CARD_COUNT) {
    return false
  }
  if (!cardsMatch(value.burnCard, cards[0])) return false

  const expectedBurnedCards = 1 + burnValue(value.burnCard)
  if (
    value.burnedCards !== expectedBurnedCards ||
    value.cursor < value.burnedCards
  ) {
    return false
  }

  const dealtCards = value.cursor - value.burnedCards
  if (
    dealtCards < value.handNumber * 4 ||
    dealtCards > value.handNumber * 6
  ) {
    return false
  }

  return (
    value.needsShuffle ===
    (PHYSICAL_CARD_COUNT - value.cursor <= value.cutAtRemaining)
  )
}

function isBets(
  value: unknown,
  options: { allowZero: boolean; balance?: number },
): value is Bets {
  if (!isRecord(value) || !hasOnlyKeys(value, BET_KEYS)) return false
  if (
    !BET_KEYS.every(
      (key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0,
    )
  ) {
    return false
  }

  const bets = value as unknown as Bets
  const stake = totalBets(bets)
  if (stake === 0) return options.allowZero

  return (
    validateBets(
      bets,
      options.balance === undefined
        ? Number.MAX_SAFE_INTEGER
        : options.balance,
    ) === null
  )
}

function betsMatch(left: Bets, right: Bets): boolean {
  return BET_KEYS.every((key) => left[key] === right[key])
}

function isDealResult(value: unknown): value is DealResult {
  if (!isRecord(value) || !hasOnlyKeys(value, RESULT_KEYS)) return false

  const playerCards = value.playerCards
  const bankerCards = value.bankerCards
  const dealOrder = value.dealOrder
  if (
    !Array.isArray(playerCards) ||
    !Array.isArray(bankerCards) ||
    !Array.isArray(dealOrder) ||
    playerCards.length < 2 ||
    playerCards.length > 3 ||
    bankerCards.length < 2 ||
    bankerCards.length > 3 ||
    dealOrder.length < 4 ||
    dealOrder.length > 6 ||
    !playerCards.every(isCard) ||
    !bankerCards.every(isCard) ||
    !dealOrder.every(isCard) ||
    value.cardsUsed !== dealOrder.length ||
    new Set(dealOrder.map((card) => card.id)).size !== dealOrder.length
  ) {
    return false
  }

  const expectedOrder = [
    playerCards[0],
    bankerCards[0],
    playerCards[1],
    bankerCards[1],
    ...playerCards.slice(2),
    ...bankerCards.slice(2),
  ]
  if (!cardArraysMatch(dealOrder, expectedOrder)) return false

  const initialPlayerTotal = handTotal(playerCards.slice(0, 2))
  const initialBankerTotal = handTotal(bankerCards.slice(0, 2))
  const expectedNatural =
    initialPlayerTotal >= 8 || initialBankerTotal >= 8
  const playerShouldDraw = !expectedNatural && initialPlayerTotal <= 5
  if ((playerCards.length === 3) !== playerShouldDraw) return false

  const playerThirdPoint = playerShouldDraw
    ? cardPoint(playerCards[2])
    : null
  const expectedBankerDraw =
    !expectedNatural &&
    bankerShouldDraw(initialBankerTotal, playerThirdPoint)

  if ((bankerCards.length === 3) !== expectedBankerDraw) {
    return false
  }

  const playerTotal = handTotal(playerCards)
  const bankerTotal = handTotal(bankerCards)
  const winner =
    playerTotal === bankerTotal
      ? 'tie'
      : playerTotal > bankerTotal
        ? 'player'
        : 'banker'

  return (
    value.playerTotal === playerTotal &&
    value.bankerTotal === bankerTotal &&
    WINNERS.has(value.winner as string) &&
    value.winner === winner &&
    value.natural === expectedNatural &&
    value.playerPair === (playerCards[0].rank === playerCards[1].rank) &&
    value.bankerPair === (bankerCards[0].rank === bankerCards[1].rank)
  )
}

function dealResultFromRecord(value: UnknownRecord): UnknownRecord {
  return Object.fromEntries(RESULT_KEYS.map((key) => [key, value[key]]))
}

function isSettlement(
  value: unknown,
  bets: Bets,
  result: DealResult,
): value is Settlement {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, SETTLEMENT_KEYS, ['commissionCharged']) ||
    !isMoney(value.totalStake) ||
    !isMoney(value.totalReturned) ||
    !isMoney(value.net, true) ||
    !isRecord(value.breakdown) ||
    !hasOnlyKeys(value.breakdown, [], BET_KEYS)
  ) {
    return false
  }

  for (const amount of Object.values(value.breakdown)) {
    if (!isMoney(amount)) return false
  }
  if (
    Object.hasOwn(value, 'commissionCharged') &&
    !isMoney(value.commissionCharged)
  ) {
    return false
  }

  const expected = settleBets(bets, result)
  if (
    !numbersMatch(value.totalStake, expected.totalStake) ||
    !numbersMatch(value.totalReturned, expected.totalReturned) ||
    !numbersMatch(value.net, expected.net)
  ) {
    return false
  }
  if (
    Object.hasOwn(value, 'commissionCharged') &&
    !numbersMatch(
      value.commissionCharged as number,
      expected.commissionCharged ?? 0,
    )
  ) {
    return false
  }

  const actualBreakdown = value.breakdown
  const expectedBreakdown = expected.breakdown
  const actualKeys = Object.keys(actualBreakdown)
  const expectedKeys = Object.keys(expectedBreakdown)
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every(
      (key) =>
        Object.hasOwn(actualBreakdown, key) &&
        numbersMatch(
          actualBreakdown[key] as number,
          expectedBreakdown[key as keyof Bets] ?? 0,
        ),
    )
  )
}

function isRoundRecord(value: unknown): value is RoundRecord {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, RECORD_KEYS, ['playMode']) ||
    !isDealResult(dealResultFromRecord(value)) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.shoeId) ||
    !isSafeIntegerInRange(value.handNumber, 1, PHYSICAL_CARD_COUNT / 4) ||
    !isIsoTimestamp(value.timestamp) ||
    !isMoney(value.balanceBefore) ||
    !isMoney(value.balanceAfter) ||
    !isSafeIntegerInRange(value.cardsRemaining, 0, PHYSICAL_CARD_COUNT) ||
    value.rulesetVersion !== RULESET_VERSION ||
    value.shuffleVersion !== SHUFFLE_VERSION
  ) {
    return false
  }

  if (
    Object.hasOwn(value, 'playMode') &&
    value.playMode !== 'bet' &&
    value.playMode !== 'fly'
  ) {
    return false
  }

  if (!isBets(value.bets, { allowZero: true })) return false
  const bets = value.bets
  const stake = totalBets(bets)
  const playMode = value.playMode ?? (stake === 0 ? 'fly' : 'bet')
  if (
    (playMode === 'fly' && stake !== 0) ||
    (playMode === 'bet' &&
      (stake === 0 ||
        !isBets(bets, {
          allowZero: false,
          balance: value.balanceBefore,
        })))
  ) {
    return false
  }

  const result = dealResultFromRecord(value) as unknown as DealResult
  if (!isSettlement(value.settlement, bets, result)) return false

  return numbersMatch(
    value.balanceAfter,
    value.balanceBefore + value.settlement.net,
  )
}

function currentShoeHistoryMatches(
  shoe: ShoeState,
  history: readonly RoundRecord[],
): boolean {
  const currentRecords = history.filter((record) => record.shoeId === shoe.id)
  if (shoe.handNumber === 0) return currentRecords.length === 0
  if (
    currentRecords.length !== shoe.handNumber ||
    currentRecords[0]?.handNumber !== 1
  ) {
    return false
  }

  for (const record of currentRecords) {
    if (record.shuffleVersion !== shoe.shuffleVersion) return false
    const endCursor = PHYSICAL_CARD_COUNT - record.cardsRemaining
    const startCursor = endCursor - record.cardsUsed
    if (
      startCursor < shoe.burnedCards ||
      endCursor > shoe.cursor ||
      !cardArraysMatch(
        shoe.cards.slice(startCursor, endCursor),
        record.dealOrder,
      )
    ) {
      return false
    }
  }

  const latest = currentRecords[currentRecords.length - 1]
  return (
    latest.handNumber === shoe.handNumber &&
    latest.cardsRemaining === PHYSICAL_CARD_COUNT - shoe.cursor
  )
}

function historyIsConsistent(history: readonly RoundRecord[]): boolean {
  const roundIds = new Set<string>()
  const completedShoeIds = new Set<string>()
  const usedCardsByShoe = new Map<string, Set<string>>()

  for (let index = 0; index < history.length; index += 1) {
    const record = history[index]
    const previous = history[index - 1]
    if (roundIds.has(record.id)) return false
    roundIds.add(record.id)

    const usedCards = usedCardsByShoe.get(record.shoeId) ?? new Set<string>()
    for (const card of record.dealOrder) {
      if (usedCards.has(card.id)) return false
      usedCards.add(card.id)
    }
    usedCardsByShoe.set(record.shoeId, usedCards)

    if (previous) {
      if (!numbersMatch(record.balanceBefore, previous.balanceAfter)) {
        return false
      }
      if (record.shoeId === previous.shoeId) {
        if (
          record.handNumber !== previous.handNumber + 1 ||
          record.cardsRemaining !==
            previous.cardsRemaining - record.cardsUsed
        ) {
          return false
        }
      } else {
        completedShoeIds.add(previous.shoeId)
        if (
          completedShoeIds.has(record.shoeId) ||
          record.handNumber !== 1
        ) {
          return false
        }
      }
    }
  }

  return true
}

export function isPersistedGameState(
  value: unknown,
): value is PersistedGameState {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, GAME_KEYS) ||
    value.version !== 1 ||
    !isMoney(value.balance) ||
    !isShoeState(value.shoe) ||
    !Array.isArray(value.history) ||
    value.history.length > MAX_HISTORY ||
    !value.history.every(isRoundRecord) ||
    !isBets(value.lastBets, { allowZero: true }) ||
    !isIsoTimestamp(value.sessionStartedAt)
  ) {
    return false
  }

  const history = value.history as RoundRecord[]
  const shoe = value.shoe as ShoeState
  const lastBets = value.lastBets as Bets
  if (!historyIsConsistent(history)) return false
  if (!currentShoeHistoryMatches(shoe, history)) return false

  const latest = history.at(-1)
  if (latest && !numbersMatch(value.balance, latest.balanceAfter)) {
    return false
  }

  let latestWageredRound: RoundRecord | undefined
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].settlement.totalStake > 0) {
      latestWageredRound = history[index]
      break
    }
  }
  return latestWageredRound
    ? betsMatch(lastBets, latestWageredRound.bets)
    : history.length === MAX_HISTORY ||
        BET_KEYS.every((key) => lastBets[key] === 0)
}

/**
 * Proves that a pending journal is internally valid. Consumers must also call
 * pendingRoundMatchesGame to prove that it was derived from the current shoe.
 */
export function isPersistedPendingRound(
  value: unknown,
): value is PersistedPendingRound {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, PENDING_KEYS) ||
    value.version !== 1 ||
    !isNonEmptyString(value.id) ||
    (value.playMode !== 'bet' && value.playMode !== 'fly') ||
    !isMoney(value.balanceBefore) ||
    !isNonEmptyString(value.sourceShoeId) ||
    !isSafeIntegerInRange(value.sourceCursor, 0, PHYSICAL_CARD_COUNT) ||
    !isShoeState(value.shoeAfter) ||
    !isDealResult(value.result) ||
    !isSafeIntegerInRange(
      value.revealedCount,
      0,
      value.result.dealOrder.length,
    )
  ) {
    return false
  }

  if (
    !isBets(value.bets, {
      allowZero: value.playMode === 'fly',
      balance: value.balanceBefore,
    })
  ) {
    return false
  }
  const bets = value.bets
  if (
    (value.playMode === 'fly' && totalBets(bets) !== 0) ||
    (value.playMode === 'bet' && totalBets(bets) === 0)
  ) {
    return false
  }

  const shoeAfter = value.shoeAfter
  const sourceHandNumber = shoeAfter.handNumber - 1
  const cardsDealtBeforeRound = value.sourceCursor - shoeAfter.burnedCards
  if (
    value.sourceShoeId !== shoeAfter.id ||
    sourceHandNumber < 0 ||
    value.sourceCursor < shoeAfter.burnedCards ||
    PHYSICAL_CARD_COUNT - value.sourceCursor <= shoeAfter.cutAtRemaining ||
    PHYSICAL_CARD_COUNT - value.sourceCursor < 6 ||
    cardsDealtBeforeRound < sourceHandNumber * 4 ||
    cardsDealtBeforeRound > sourceHandNumber * 6 ||
    shoeAfter.cursor !== value.sourceCursor + value.result.cardsUsed
  ) {
    return false
  }

  return cardArraysMatch(
    shoeAfter.cards.slice(value.sourceCursor, shoeAfter.cursor),
    value.result.dealOrder,
  )
}
