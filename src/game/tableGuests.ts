import type { Card, Winner } from '../types'
import { cardPoint, handTotal } from './baccarat'

export type TableGuestSeat =
  | 'far-left'
  | 'left'
  | 'right'
  | 'far-right'

export type TableGuestTendency =
  | 'player-leaning'
  | 'banker-leaning'
  | 'tie-curious'
  | 'pair-curious'
  | 'cautious'

export type TableGuestBetTarget =
  | 'player'
  | 'banker'
  | 'tie'
  | 'playerPair'
  | 'bankerPair'
  | 'observe'

export type TableGuestSide = 'player' | 'banker'

export type TableGuestReactionTone =
  | 'anticipation'
  | 'positive'
  | 'negative'
  | 'neutral'
  | 'surprised'

export interface TableGuestIntent {
  target: TableGuestBetTarget
  message: string
}

export interface TableGuest {
  id: string
  name: string
  seat: TableGuestSeat
  tendency: TableGuestTendency
  intent: TableGuestIntent
}

export interface CreateTableGuestsInput {
  shoeId: string
  handNumber: number
  /**
   * When omitted, the stable round seed selects either three or four guests.
   */
  count?: 3 | 4
}

/**
 * A reveal entry represents one card that is already face-up. This deliberately
 * excludes DealResult, future card counts, winner, and settlement information.
 */
export interface PublicTableCardReveal {
  side: TableGuestSide
  card: Card
}

export interface BuildTableGuestRevealReactionsInput {
  shoeId: string
  handNumber: number
  guests: readonly TableGuest[]
  /**
   * Face-up cards in their public reveal order.
   */
  publicReveals: readonly PublicTableCardReveal[]
}

export interface TableGuestRevealReaction {
  id: string
  eventId: string
  phase: 'revealing'
  guestId: string
  side: TableGuestSide
  tone: Exclude<TableGuestReactionTone, 'negative'>
  message: string
  messageKey: string
}

export type TableGuestSettlementOutcome = 'win' | 'loss' | 'push' | 'observe'

export interface BuildTableGuestSettlementReactionsInput {
  shoeId: string
  handNumber: number
  guests: readonly TableGuest[]
  winner: Winner
  playerPair: boolean
  bankerPair: boolean
}

export interface TableGuestSettlementReaction {
  id: string
  eventId: string
  phase: 'settled'
  guestId: string
  tone: Extract<TableGuestReactionTone, 'positive' | 'negative' | 'neutral'>
  outcome: TableGuestSettlementOutcome
  message: string
}

const NAMES = [
  '阿明',
  '雅雯',
  '陈叔',
  '小周',
  '玲姐',
  '阿杰',
  '吴生',
  '思妍',
  '老林',
  '欣怡',
  '凯文',
  '美琪',
] as const

const SEATS: readonly TableGuestSeat[] = [
  'far-left',
  'left',
  'right',
  'far-right',
]

const TENDENCIES: readonly TableGuestTendency[] = [
  'player-leaning',
  'banker-leaning',
  'tie-curious',
  'pair-curious',
  'cautious',
]

const TENDENCY_TARGETS: Record<
  TableGuestTendency,
  readonly TableGuestBetTarget[]
> = {
  'player-leaning': ['player', 'player', 'player', 'banker', 'observe'],
  'banker-leaning': ['banker', 'banker', 'banker', 'player', 'observe'],
  'tie-curious': ['tie', 'tie', 'player', 'banker', 'observe'],
  'pair-curious': [
    'playerPair',
    'bankerPair',
    'playerPair',
    'bankerPair',
    'observe',
  ],
  cautious: ['observe', 'observe', 'player', 'banker', 'observe'],
}

const INTENT_MESSAGES: Record<
  TableGuestBetTarget,
  readonly [string, string, string, string]
> = {
  player: ['这手放闲', '我看闲家', '闲家一注', '这一手选闲'],
  banker: ['这手放庄', '我看庄家', '庄家一注', '这一手选庄'],
  tie: ['和局小注', '这一手看和', '小注放和', '和区留一注'],
  playerPair: ['带一点闲对', '闲对小注', '这手看闲对', '闲对留一注'],
  bankerPair: ['带一点庄对', '庄对小注', '这手看庄对', '庄对留一注'],
  observe: ['这手先看', '先看牌面', '暂时观桌', '这一手旁观'],
}

const SETTLEMENT_MESSAGES: Record<
  TableGuestSettlementOutcome,
  readonly [string, string, string, string]
> = {
  win: ['这一手中了', '正好押中', '这局收下', '结果合意'],
  loss: ['这手没中', '差了一点', '这一局落空', '牌面没对上'],
  push: ['和局退注', '这一手打和', '原注退回', '不输不赢'],
  observe: ['牌面记下了', '这一手看完了', '先看路单', '结果已明'],
}

interface RevealMessageCandidate {
  tone: TableGuestRevealReaction['tone']
  messageKey: string
  messages: readonly string[]
  notable: boolean
}

function hashString(value: string): number {
  let hash = 2_166_136_261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }

  return hash >>> 0
}

function roundKey(shoeId: string, handNumber: number): string {
  return `${shoeId}:${Math.max(0, Math.trunc(handNumber))}`
}

function createSeededRandom(seed: number): () => number {
  let state = seed || 0x6d2b79f5

  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const shuffled = [...items]

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[target]
    shuffled[target] = current
  }

  return shuffled
}

function stableIndex(key: string, length: number): number {
  return length > 0 ? hashString(key) % length : 0
}

function pickUniqueMessage(
  messages: readonly string[],
  key: string,
  usedMessages: Set<string>,
): string {
  const startIndex = stableIndex(key, messages.length)

  for (let offset = 0; offset < messages.length; offset += 1) {
    const message = messages[(startIndex + offset) % messages.length]
    if (!usedMessages.has(message)) {
      usedMessages.add(message)
      return message
    }
  }

  const fallback = messages[startIndex] ?? ''
  usedMessages.add(fallback)
  return fallback
}

function intentForGuest(
  tendency: TableGuestTendency,
  seedKey: string,
  usedMessages: Set<string>,
): TableGuestIntent {
  const targets = TENDENCY_TARGETS[tendency]
  const target = targets[stableIndex(`${seedKey}:target`, targets.length)]
  const message = pickUniqueMessage(
    INTENT_MESSAGES[target],
    `${seedKey}:intent`,
    usedMessages,
  )

  return { target, message }
}

/**
 * Produces a deterministic roster for one shoe/hand without global randomness.
 */
export function createTableGuests({
  shoeId,
  handNumber,
  count,
}: CreateTableGuestsInput): TableGuest[] {
  const key = roundKey(shoeId, handNumber)
  const seed = hashString(key)
  const random = createSeededRandom(seed)
  const guestCount = count ?? (seed % 2 === 0 ? 3 : 4)
  const names = shuffle(NAMES, random).slice(0, guestCount)
  const seats = shuffle(SEATS, random)
    .slice(0, guestCount)
    .sort((left, right) => SEATS.indexOf(left) - SEATS.indexOf(right))
  const tendencies = shuffle(TENDENCIES, random).slice(0, guestCount)
  const usedIntentMessages = new Set<string>()

  return seats.map((seat, index) => {
    const tendency = tendencies[index]
    const guestKey = `${key}:${seat}:${names[index]}:${tendency}`

    return {
      id: `table-guest-${seed.toString(36)}-${seat}`,
      name: names[index],
      seat,
      tendency,
      intent: intentForGuest(tendency, guestKey, usedIntentMessages),
    }
  })
}

/**
 * Keeps the people and seats stable for a whole shoe while allowing their
 * understated betting intent to change from hand to hand.
 */
export function createShoeTableGuests({
  shoeId,
  handNumber,
  count,
}: CreateTableGuestsInput): TableGuest[] {
  const roster = createTableGuests({
    shoeId,
    handNumber: 0,
    count,
  })
  const usedIntentMessages = new Set<string>()
  const handKey = roundKey(shoeId, handNumber)

  return roster.map((guest) => ({
    ...guest,
    intent: intentForGuest(
      guest.tendency,
      `${handKey}:${guest.seat}:${guest.name}:${guest.tendency}`,
      usedIntentMessages,
    ),
  }))
}

function sideLabel(side: TableGuestSide): string {
  return side === 'player' ? '闲家' : '庄家'
}

function revealMessageCandidate(
  side: TableGuestSide,
  publicSideCards: readonly Card[],
): RevealMessageCandidate {
  const label = sideLabel(side)
  const latestCard = publicSideCards.at(-1)
  const total = handTotal([...publicSideCards])
  const hasPublicPair =
    publicSideCards.length >= 2 &&
    publicSideCards[0].rank === publicSideCards[1].rank

  if (publicSideCards.length === 2 && hasPublicPair) {
    return {
      tone: 'surprised',
      messageKey: `${side}:pair`,
      messages: [`${label}对子亮了`, `${label}首两张成对`],
      notable: true,
    }
  }

  if (publicSideCards.length >= 2 && total >= 8) {
    return {
      tone: 'positive',
      messageKey: `${side}:high-${total}`,
      messages: [`${label}现在${total}点`, `${total}点牌面亮清`],
      notable: true,
    }
  }

  if (publicSideCards.length >= 3) {
    return {
      tone: total >= 6 ? 'positive' : 'neutral',
      messageKey: `${side}:third-${total}`,
      messages: [`${label}补牌后${total}点`, `第三张开出，${label}${total}点`],
      notable: true,
    }
  }

  if (latestCard && cardPoint(latestCard) === 0) {
    return {
      tone: 'neutral',
      messageKey: `${side}:zero`,
      messages: [`${label}开出零点牌`, '公仔与十都不加点'],
      notable: false,
    }
  }

  if (publicSideCards.length >= 2) {
    return {
      tone: 'anticipation',
      messageKey: `${side}:two-${total}`,
      messages: [`${label}两张${total}点`, `先看${label}${total}点牌面`],
      notable: total >= 6,
    }
  }

  return {
    tone: 'anticipation',
    messageKey: `${side}:opening`,
    messages: [`${label}第一张亮了`, '先看下一张'],
    notable: false,
  }
}

function guestMatchesSide(guest: TableGuest, side: TableGuestSide): boolean {
  return side === 'player'
    ? guest.intent.target === 'player' || guest.intent.target === 'playerPair'
    : guest.intent.target === 'banker' || guest.intent.target === 'bankerPair'
}

function selectReactingGuest(
  guests: readonly TableGuest[],
  side: TableGuestSide,
  key: string,
  previousGuestId: string | null,
): TableGuest | null {
  if (guests.length === 0) return null

  const matching = guests.filter((guest) => guestMatchesSide(guest, side))
  const ordered = matching.length > 0 ? [...matching, ...guests] : [...guests]
  const unique = ordered.filter(
    (guest, index) =>
      ordered.findIndex((candidate) => candidate.id === guest.id) === index,
  )
  const startIndex = stableIndex(key, unique.length)

  for (let offset = 0; offset < unique.length; offset += 1) {
    const guest = unique[(startIndex + offset) % unique.length]
    if (guest.id !== previousGuestId || unique.length === 1) return guest
  }

  return unique[startIndex] ?? null
}

/**
 * Builds a stable, quiet reaction plan from face-up cards only. It emits at
 * most two reactions per round, never on consecutive reveals, and never more
 * than one guest for a single reveal.
 */
export function buildTableGuestRevealReactions({
  shoeId,
  handNumber,
  guests,
  publicReveals,
}: BuildTableGuestRevealReactionsInput): TableGuestRevealReaction[] {
  const key = roundKey(shoeId, handNumber)
  const publicCards: Record<TableGuestSide, Card[]> = {
    player: [],
    banker: [],
  }
  const seenCardIds = new Set<string>()
  const usedMessages = new Set<string>()
  const reactions: TableGuestRevealReaction[] = []
  let lastReactionIndex = -2
  let publicRevealIndex = -1
  let previousGuestId: string | null = null

  for (const reveal of publicReveals) {
    if (seenCardIds.has(reveal.card.id)) continue

    seenCardIds.add(reveal.card.id)
    publicRevealIndex += 1
    publicCards[reveal.side].push(reveal.card)

    if (
      guests.length === 0 ||
      reactions.length >= 2 ||
      publicRevealIndex < 2 ||
      publicRevealIndex - lastReactionIndex < 2
    ) {
      continue
    }

    const candidate = revealMessageCandidate(
      reveal.side,
      publicCards[reveal.side],
    )
    const shouldReact =
      reactions.length === 0 ||
      candidate.notable ||
      stableIndex(`${key}:${reveal.card.id}:react`, 4) === 0

    if (!shouldReact) continue

    const guest = selectReactingGuest(
      guests,
      reveal.side,
      `${key}:${reveal.card.id}:guest`,
      previousGuestId,
    )
    if (!guest) continue

    const message = pickUniqueMessage(
      candidate.messages,
      `${key}:${reveal.card.id}:message`,
      usedMessages,
    )
    const eventId = `${key}:reveal:${reveal.card.id}`
    reactions.push({
      id: `${eventId}:${guest.id}`,
      eventId,
      phase: 'revealing',
      guestId: guest.id,
      side: reveal.side,
      tone: candidate.tone,
      message,
      messageKey: candidate.messageKey,
    })
    lastReactionIndex = publicRevealIndex
    previousGuestId = guest.id
  }

  return reactions
}

function settlementOutcome(
  target: TableGuestBetTarget,
  winner: Winner,
  playerPair: boolean,
  bankerPair: boolean,
): TableGuestSettlementOutcome {
  if (target === 'observe') return 'observe'
  if (target === 'playerPair') return playerPair ? 'win' : 'loss'
  if (target === 'bankerPair') return bankerPair ? 'win' : 'loss'
  if (target === 'tie') return winner === 'tie' ? 'win' : 'loss'
  if (winner === 'tie') return 'push'
  return winner === target ? 'win' : 'loss'
}

function settlementTone(
  outcome: TableGuestSettlementOutcome,
): TableGuestSettlementReaction['tone'] {
  if (outcome === 'win') return 'positive'
  if (outcome === 'loss') return 'negative'
  return 'neutral'
}

/**
 * Settlement reactions are generated only from the now-public outcome. Each
 * guest reacts to their own stable intent; wording never encourages chasing.
 */
export function buildTableGuestSettlementReactions({
  shoeId,
  handNumber,
  guests,
  winner,
  playerPair,
  bankerPair,
}: BuildTableGuestSettlementReactionsInput): TableGuestSettlementReaction[] {
  const key = roundKey(shoeId, handNumber)
  const eventId = `${key}:settlement`
  const usedMessages = new Set<string>()

  return guests.map((guest) => {
    const outcome = settlementOutcome(
      guest.intent.target,
      winner,
      playerPair,
      bankerPair,
    )
    const message = pickUniqueMessage(
      SETTLEMENT_MESSAGES[outcome],
      `${eventId}:${guest.id}:${outcome}`,
      usedMessages,
    )

    return {
      id: `${eventId}:${guest.id}`,
      eventId,
      phase: 'settled',
      guestId: guest.id,
      tone: settlementTone(outcome),
      outcome,
      message,
    }
  })
}
