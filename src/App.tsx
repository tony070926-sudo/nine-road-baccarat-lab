import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  CircleAlert,
  ExternalLink,
  History,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { BettingPanel } from './components/BettingPanel'
import {
  CrowdCheerOverlay,
  type ActiveCrowdCheer,
} from './components/CrowdCheerOverlay'
import { HistoryTable } from './components/HistoryTable'
import { PlayingCard, RevealPlayingCard } from './components/PlayingCard'
import { DealerRoadPanel, RoadBoard } from './components/RoadBoard'
import {
  EMPTY_BETS,
  RULESET_VERSION,
  cardsRemaining,
  createShoe,
  dealRound,
  handTotal,
  settleBets,
  totalBets,
  validateBets,
} from './game/baccarat'
import {
  buildCardRevealCheer,
  buildSettlementCheer,
  type CrowdCheer,
  revealedCardsForSide,
  sideIsCompleteFromPublicCards,
} from './game/crowdCheer'
import {
  clearPendingRound,
  clearGameState,
  downloadTextFile,
  historyToCsv,
  loadGameState,
  loadPendingRound,
  saveGameState,
  savePendingRound,
} from './game/storage'
import { isFlyRound } from './game/records'
import {
  isMatchingDealMotion,
  motionFallbackMs,
  newlyVisibleUndealtCardIds,
  type DealMotionToken,
} from './game/motion'
import {
  manualRevealSides,
  nextRevealCard,
  pendingRoundMatchesGame,
  revealIsComplete,
  revealSideForCard,
  revealedCards,
  visibleRevealCardIds,
} from './game/reveal'
import type { RevealSide } from './game/reveal'
import { cardLabel } from './game/cards'
import type {
  Bets,
  PendingRound,
  PersistedGameState,
  PlayMode,
  RoundRecord,
  Winner,
} from './types'
import './styles.css'

const STARTING_BALANCE = 10_000
type RevealActor = 'user' | 'dealer'
type DetailView = 'road' | 'history' | null

const SOURCES = [
  {
    title: '新加坡 GRA · Marina Bay Sands Baccarat Version 8',
    description: '金沙直接规则来源：赔率、补牌、和局退注与对子定义。',
    url: 'https://www.gra.gov.sg/docs/default-source/game-rules/mbs/baccarat-games/mbs-baccarat-game-rules---ver-8.pdf',
  },
  {
    title: '澳门博彩监察协调局 · 百家樂法定规章',
    description: '澳门法定牌值、补牌与 5% 庄佣规则。',
    url: 'https://www.dicj.gov.mo/web/cn/rules/Bacara.html',
  },
  {
    title: 'Wizard of Odds · 八副牌组合枚举',
    description: '庄、闲、和精确概率与标准赔率庄家优势基准。',
    url: 'https://wizardofodds.com/games/baccarat/basics/',
  },
  {
    title: 'Wizard of Odds · Baccarat Score Boards',
    description: '赌场路单、龙尾、和局与派生路算法参考。',
    url: 'https://wizardofodds.com/games/baccarat/history/',
  },
  {
    title: '环球博彩 · 百家樂挤牌习俗与桌边术语',
    description:
      '“公”、两边、三边、四边与吹牌等现场叫法参考；地区与牌桌之间可能存在差异。',
    url: 'https://wgm8.com/szh-blast-from-the-past-squeeze-play/',
  },
]

function makeInitialState(): PersistedGameState {
  return {
    version: 1,
    balance: STARTING_BALANCE,
    shoe: createShoe(),
    history: [],
    lastBets: { ...EMPTY_BETS },
    sessionStartedAt: new Date().toISOString(),
  }
}

function loadInitialSession(): {
  game: PersistedGameState
  pendingRound: PendingRound | null
  revealedCount: number
} {
  const game = loadGameState() ?? makeInitialState()
  const storedPending = loadPendingRound()

  if (!storedPending) {
    return { game, pendingRound: null, revealedCount: 0 }
  }
  if (!pendingRoundMatchesGame(game, storedPending)) {
    clearPendingRound()
    return { game, pendingRound: null, revealedCount: 0 }
  }

  const pendingRound: PendingRound = {
    id: storedPending.id,
    playMode: storedPending.playMode,
    bets: storedPending.bets,
    balanceBefore: storedPending.balanceBefore,
    sourceShoeId: storedPending.sourceShoeId,
    sourceCursor: storedPending.sourceCursor,
    shoeAfter: storedPending.shoeAfter,
    result: storedPending.result,
  }
  const { revealedCount } = storedPending
  return { game, pendingRound, revealedCount }
}

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: value % 1 === 0 ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(value)
}

function outcomeLabel(winner: Winner): string {
  if (winner === 'banker') return '庄家胜'
  if (winner === 'player') return '闲家胜'
  return '和局'
}

function revealSideLabel(side: RevealSide): string {
  return side === 'player' ? '闲家' : '庄家'
}

function revealScopeLabel(sides: RevealSide[]): string {
  if (sides.length === 1) return `只翻${revealSideLabel(sides[0])}`
  return '翻开双方'
}

function statPercent(count: number, total: number): string {
  return total ? `${((count / total) * 100).toFixed(1)}%` : '—'
}

function createRoundId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `round-${Date.now()}`
}

function roundRevealInstruction(round: PendingRound): string {
  const revealSides = manualRevealSides(round.bets, round.playMode)
  if (round.playMode === 'fly') {
    return '飞牌进行中，本局无下注，荷官将自动开牌并写入路单。'
  }
  if (revealSides.length === 1) {
    return `下注已锁定。本局由你翻开${revealSideLabel(
      revealSides[0],
    )}，另一方由荷官自动翻开。`
  }
  return '下注已锁定。本局下注涉及双方，请按亮起顺序翻牌。'
}

interface ModalProps {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}

function Modal({ title, onClose, children, wide = false }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal-card ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">BACCARAT LAB</p>
            <h2 id="modal-title">{title}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="modal-content">{children}</div>
      </section>
    </div>
  )
}

interface RoundHandProps {
  side: 'player' | 'banker'
  settledRound: RoundRecord | null
  pendingRound: PendingRound | null
  roundReady: boolean
  visibleCardIds: Set<string>
  dealtCardIds: Set<string>
  activeDealMotion: DealMotionToken | null
  completedCardIds: Set<string>
  nextCardId: string | null
  nextCardRequiresUser: boolean
  flippingCardId: string | null
  revealActor: RevealActor | null
  pendingTotal: number | null
  onFlip: (cardId: string) => void
  onFlipComplete: (cardId: string) => void
  onDealComplete: (motion: DealMotionToken) => void
}

function RoundHand({
  side,
  settledRound,
  pendingRound,
  roundReady,
  visibleCardIds,
  dealtCardIds,
  activeDealMotion,
  completedCardIds,
  nextCardId,
  nextCardRequiresUser,
  flippingCardId,
  revealActor,
  pendingTotal,
  onFlip,
  onFlipComplete,
  onDealComplete,
}: RoundHandProps) {
  const isPlayer = side === 'player'
  const sideLabel = isPlayer ? '闲' : '庄'
  const sideEnglish = isPlayer ? 'PLAYER' : 'BANKER'
  const pendingCards = pendingRound
    ? isPlayer
      ? pendingRound.result.playerCards
      : pendingRound.result.bankerCards
    : []
  const settledCards = settledRound
    ? isPlayer
      ? settledRound.playerCards
      : settledRound.bankerCards
    : []
  const visiblePendingCards = pendingCards.filter((card) =>
    visibleCardIds.has(card.id),
  )
  const revealedSideCount = pendingCards.filter((card) =>
    completedCardIds.has(card.id),
  ).length
  const settledTotal = settledRound
    ? isPlayer
      ? settledRound.playerTotal
      : settledRound.bankerTotal
    : null
  const pair = settledRound
    ? isPlayer
      ? settledRound.playerPair
      : settledRound.bankerPair
    : false

  return (
    <div className={`hand hand-${side} ${pendingRound ? 'is-revealing' : ''}`}>
      <div className="hand-label">
        <span>
          {sideLabel} <small>{sideEnglish}</small>
        </span>
        <strong>
          {pendingRound ? (pendingTotal ?? '—') : (settledTotal ?? '—')}
          <small> 点</small>
        </strong>
      </div>

      <div className="cards-row">
        {pendingRound ? (
          visiblePendingCards.map((card, index) => {
            const isFlipping = flippingCardId === card.id
            const dealMotion =
              activeDealMotion?.cardId === card.id
                ? activeDealMotion
                : null
            const isPlaced = dealtCardIds.has(card.id)
            return (
              <RevealPlayingCard
                card={card}
                index={index}
                dealIndex={
                  pendingRound.result.dealOrder.findIndex(
                    (dealtCard) => dealtCard.id === card.id,
                  )
                }
                side={side}
                faceUp={completedCardIds.has(card.id) || isFlipping}
                canFlip={
                  roundReady &&
                  isPlaced &&
                  nextCardId === card.id &&
                  nextCardRequiresUser &&
                  !flippingCardId
                }
                isFlipping={isFlipping}
                isAutomatic={isFlipping && revealActor === 'dealer'}
                isPlaced={isPlaced}
                dealMotion={dealMotion}
                willAutoFlip={
                  roundReady &&
                  isPlaced &&
                  nextCardId === card.id &&
                  !nextCardRequiresUser &&
                  !flippingCardId
                }
                onFlip={onFlip}
                onFlipComplete={onFlipComplete}
                onDealComplete={onDealComplete}
                key={card.id}
              />
            )
          })
        ) : settledRound ? (
          settledCards.map((card, index) => (
            <PlayingCard card={card} index={index} key={card.id} />
          ))
        ) : (
          <>
            <div className="card-back card-back-static">
              <span className="card-back-frame">
                <span className="card-back-medallion">九</span>
              </span>
            </div>
            <div className="card-back card-back-static">
              <span className="card-back-frame">
                <span className="card-back-medallion">九</span>
              </span>
            </div>
          </>
        )}
      </div>

      <div className="hand-tags">
        {pendingRound ? (
          <span className="reveal-side-note">
            已翻 {revealedSideCount} / {visiblePendingCards.length}
          </span>
        ) : (
          <>
            {settledRound?.natural && <span>自然牌</span>}
            {pair && <span>{sideLabel}对</span>}
            {settledCards.length === 3 && <span>补第三张</span>}
          </>
        )}
      </div>
    </div>
  )
}

function App() {
  const [initialSession] = useState(loadInitialSession)
  const [game, setGame] = useState<PersistedGameState>(initialSession.game)
  const [bets, setBets] = useState<Bets>(
    initialSession.pendingRound
      ? { ...initialSession.pendingRound.bets }
      : { ...EMPTY_BETS },
  )
  const [selectedChip, setSelectedChip] = useState(100)
  const [pendingRound, setPendingRound] = useState<PendingRound | null>(
    initialSession.pendingRound,
  )
  const [revealedCount, setRevealedCount] = useState(
    initialSession.revealedCount,
  )
  const [flippingCardId, setFlippingCardId] = useState<string | null>(null)
  const [revealActor, setRevealActor] = useState<RevealActor | null>(null)
  const [roundReady, setRoundReady] = useState(
    Boolean(initialSession.pendingRound),
  )
  const [dealtCardIds, setDealtCardIds] = useState<Set<string>>(
    () =>
      new Set(
        initialSession.pendingRound
          ? visibleRevealCardIds(
              initialSession.pendingRound.result,
              initialSession.revealedCount,
            )
          : [],
      ),
  )
  const [activeDealMotion, setActiveDealMotion] =
    useState<DealMotionToken | null>(null)
  const [detailView, setDetailView] = useState<DetailView>(null)
  const [revealAnnouncement, setRevealAnnouncement] = useState(
    initialSession.pendingRound
      ? initialSession.pendingRound.playMode === 'fly'
        ? '飞牌对局已恢复，荷官将继续自动开牌。'
        : '已锁定下注对局已恢复，将按下注侧继续翻牌。'
      : '请先选择下注对象与筹码，然后确认开牌。',
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [newShoeOpen, setNewShoeOpen] = useState(false)
  const [roadFullscreen, setRoadFullscreen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [activeCrowdCheer, setActiveCrowdCheer] =
    useState<ActiveCrowdCheer | null>(null)

  const gameRef = useRef(game)
  const pendingRoundRef = useRef<PendingRound | null>(
    initialSession.pendingRound,
  )
  const revealedCountRef = useRef(initialSession.revealedCount)
  const flippingCardRef = useRef<string | null>(null)
  const revealActorRef = useRef<RevealActor | null>(null)
  const roundReadyRef = useRef(Boolean(initialSession.pendingRound))
  const roundLockRef = useRef(Boolean(initialSession.pendingRound))
  const flipLockRef = useRef(false)
  const finalizeLockRef = useRef(false)
  const dealtCardIdsRef = useRef(
    new Set(
      initialSession.pendingRound
        ? visibleRevealCardIds(
            initialSession.pendingRound.result,
            initialSession.revealedCount,
          )
        : [],
    ),
  )
  const activeDealMotionRef = useRef<DealMotionToken | null>(null)
  const dealQueueRef = useRef<string[]>([])
  const dealMotionSequenceRef = useRef(0)
  const flipFallbackTimerRef = useRef<number | null>(null)
  const settleTimerRef = useRef<number | null>(null)
  const focusTimerRef = useRef<number | null>(null)
  const autoFlipTimerRef = useRef<number | null>(null)
  const dealPhaseTimerRef = useRef<number | null>(null)
  const dealGapTimerRef = useRef<number | null>(null)
  const crowdCheerTimerRef = useRef<number | null>(null)
  const outcomeCheerTimerRef = useRef<number | null>(null)
  const crowdCheerSequenceRef = useRef(0)
  const beginRevealCardRef = useRef<
    (cardId: string, actor: RevealActor) => void
  >(() => undefined)

  const isDealing = pendingRound !== null
  const dealingMode = pendingRound?.playMode ?? null

  useEffect(() => {
    saveGameState(game)
  }, [game])

  useEffect(() => {
    document.body.classList.toggle('road-fullscreen-active', roadFullscreen)
    return () => document.body.classList.remove('road-fullscreen-active')
  }, [roadFullscreen])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 4_500)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(
    () => () => {
      if (flipFallbackTimerRef.current !== null) {
        window.clearTimeout(flipFallbackTimerRef.current)
      }
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current)
      }
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current)
      }
      if (autoFlipTimerRef.current !== null) {
        window.clearTimeout(autoFlipTimerRef.current)
      }
      if (dealPhaseTimerRef.current !== null) {
        window.clearTimeout(dealPhaseTimerRef.current)
      }
      if (dealGapTimerRef.current !== null) {
        window.clearTimeout(dealGapTimerRef.current)
      }
      if (crowdCheerTimerRef.current !== null) {
        window.clearTimeout(crowdCheerTimerRef.current)
      }
      if (outcomeCheerTimerRef.current !== null) {
        window.clearTimeout(outcomeCheerTimerRef.current)
      }
    },
    [],
  )

  const latestRound = game.history[game.history.length - 1] ?? null
  const settledCurrentRound =
    latestRound && latestRound.shoeId === game.shoe.id ? latestRound : null
  const currentShoeRecords = useMemo(
    () => game.history.filter((record) => record.shoeId === game.shoe.id),
    [game.history, game.shoe.id],
  )

  const stats = useMemo(() => {
    const count = currentShoeRecords.length
    const byWinner = (winner: Winner) =>
      currentShoeRecords.filter((record) => record.winner === winner).length
    return {
      count,
      banker: byWinner('banker'),
      player: byWinner('player'),
      tie: byWinner('tie'),
      naturals: currentShoeRecords.filter((record) => record.natural).length,
      pairs: currentShoeRecords.filter((record) => record.playerPair || record.bankerPair).length,
    }
  }, [currentShoeRecords])

  const visiblePendingCardIds = useMemo(
    () =>
      new Set(
        pendingRound
          ? visibleRevealCardIds(pendingRound.result, revealedCount)
          : [],
      ),
    [pendingRound, revealedCount],
  )
  const completedPendingCardIds = useMemo(
    () =>
      new Set(
        pendingRound
          ? revealedCards(pendingRound.result, revealedCount).map((card) => card.id)
          : [],
      ),
    [pendingRound, revealedCount],
  )
  const pendingNextCard = pendingRound
    ? nextRevealCard(pendingRound.result, revealedCount)
    : null
  const pendingManualSides = useMemo(
    () =>
      pendingRound
        ? manualRevealSides(pendingRound.bets, pendingRound.playMode)
        : [],
    [pendingRound],
  )
  const pendingNextSide =
    pendingRound && pendingNextCard
      ? revealSideForCard(pendingRound.result, pendingNextCard.id)
      : null
  const pendingNextRequiresUser =
    pendingNextSide !== null && pendingManualSides.includes(pendingNextSide)
  const completedPendingCards = pendingRound
    ? revealedCards(pendingRound.result, revealedCount)
    : []
  const revealedPlayerCards = pendingRound
    ? completedPendingCards.filter((card) =>
        pendingRound.result.playerCards.some((playerCard) => playerCard.id === card.id),
      )
    : []
  const revealedBankerCards = pendingRound
    ? completedPendingCards.filter((card) =>
        pendingRound.result.bankerCards.some((bankerCard) => bankerCard.id === card.id),
      )
    : []
  const pendingPlayerTotal =
    revealedPlayerCards.length > 0 ? handTotal(revealedPlayerCards) : null
  const pendingBankerTotal =
    revealedBankerCards.length > 0 ? handTotal(revealedBankerCards) : null
  const revealDisplayTotal = pendingRound ? visiblePendingCardIds.size : 0

  const clearCrowdCheer = () => {
    if (crowdCheerTimerRef.current !== null) {
      window.clearTimeout(crowdCheerTimerRef.current)
      crowdCheerTimerRef.current = null
    }
    if (outcomeCheerTimerRef.current !== null) {
      window.clearTimeout(outcomeCheerTimerRef.current)
      outcomeCheerTimerRef.current = null
    }
    setActiveCrowdCheer(null)
  }

  const showCrowdCheer = (
    eventId: string,
    cheer: CrowdCheer,
    duration = 3_050,
  ) => {
    if (crowdCheerTimerRef.current !== null) {
      window.clearTimeout(crowdCheerTimerRef.current)
    }

    crowdCheerSequenceRef.current += 1
    const id = `${eventId}:${crowdCheerSequenceRef.current}`
    setActiveCrowdCheer({ id, ...cheer })
    crowdCheerTimerRef.current = window.setTimeout(() => {
      crowdCheerTimerRef.current = null
      setActiveCrowdCheer((current) => (current?.id === id ? null : current))
    }, duration)
  }

  useEffect(() => {
    if (
      !pendingRound ||
      !roundReady ||
      flippingCardId ||
      !pendingNextCard ||
      !pendingNextRequiresUser ||
      rulesOpen ||
      resetOpen ||
      newShoeOpen ||
      roadFullscreen
    ) {
      return
    }
    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current)
    }
    focusTimerRef.current = window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>('.reveal-card.can-flip')
        ?.focus({ preventScroll: true })
    }, 90)

    return () => {
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = null
      }
    }
  }, [
    flippingCardId,
    newShoeOpen,
    pendingNextCard,
    pendingNextRequiresUser,
    pendingRound,
    resetOpen,
    roadFullscreen,
    roundReady,
    rulesOpen,
  ])

  const handleAddBet = (target: keyof Bets) => {
    setFormError(null)
    if ((target === 'player' && bets.banker > 0) || (target === 'banker' && bets.player > 0)) {
      setFormError('标准牌桌不可同时下注庄与闲')
      return
    }

    const candidate = { ...bets, [target]: bets[target] + selectedChip }
    const targetMax = target === 'player' || target === 'banker' ? 10_000 : 1_000
    if (candidate[target] > targetMax) {
      setFormError(`${target === 'player' || target === 'banker' ? '庄/闲' : '和/对子'}单项已达上限`)
      return
    }
    if (totalBets(candidate) > game.balance) {
      setFormError('教学分余额不足')
      return
    }
    setBets(candidate)
  }

  const handleRepeat = () => {
    const error = validateBets(game.lastBets, game.balance)
    if (error) {
      setFormError(error)
      return
    }
    setBets({ ...game.lastBets })
    setFormError(null)
  }

  const clearDealTimers = () => {
    if (dealPhaseTimerRef.current !== null) {
      window.clearTimeout(dealPhaseTimerRef.current)
      dealPhaseTimerRef.current = null
    }
    if (dealGapTimerRef.current !== null) {
      window.clearTimeout(dealGapTimerRef.current)
      dealGapTimerRef.current = null
    }
  }

  function finishDealSequence(roundId: string) {
    if (
      pendingRoundRef.current?.id !== roundId ||
      activeDealMotionRef.current ||
      dealQueueRef.current.length > 0
    ) {
      return
    }

    roundReadyRef.current = true
    flipLockRef.current = false
    setRoundReady(true)
    setRevealAnnouncement(roundRevealInstruction(pendingRoundRef.current))
  }

  function startNextDealCard(roundId: string) {
    const current = pendingRoundRef.current
    if (!current || current.id !== roundId) return

    const cardId = dealQueueRef.current.shift()
    if (!cardId) {
      finishDealSequence(roundId)
      return
    }

    dealMotionSequenceRef.current += 1
    const motion: DealMotionToken = {
      roundId,
      cardId,
      sequence: dealMotionSequenceRef.current,
    }
    activeDealMotionRef.current = motion
    setActiveDealMotion(motion)

    const side = revealSideForCard(current.result, cardId)
    const sideCards =
      side === 'player'
        ? current.result.playerCards
        : current.result.bankerCards
    const sideIndex = sideCards.findIndex((card) => card.id === cardId)
    setRevealAnnouncement(
      `停止下注。荷官正在发给${
        side ? revealSideLabel(side) : ''
      }第 ${sideIndex + 1} 张牌…`,
    )

    dealPhaseTimerRef.current = window.setTimeout(
      () => completeDealMotion(motion),
      motionFallbackMs('dealer'),
    )
  }

  function completeDealMotion(signal: DealMotionToken) {
    if (!isMatchingDealMotion(activeDealMotionRef.current, signal)) return

    clearDealTimers()
    const current = pendingRoundRef.current
    if (!current || current.id !== signal.roundId) return

    const nextDealtIds = new Set(dealtCardIdsRef.current)
    nextDealtIds.add(signal.cardId)
    dealtCardIdsRef.current = nextDealtIds
    activeDealMotionRef.current = null
    setDealtCardIds(nextDealtIds)
    setActiveDealMotion(null)

    if (dealQueueRef.current.length === 0) {
      finishDealSequence(signal.roundId)
      return
    }

    dealGapTimerRef.current = window.setTimeout(() => {
      dealGapTimerRef.current = null
      startNextDealCard(signal.roundId)
    }, 70)
  }

  function startDealSequence(
    current: PendingRound,
    requestedCardIds: readonly string[],
    announcement: string,
  ) {
    const queuedCardIds = requestedCardIds.filter(
      (cardId) => !dealtCardIdsRef.current.has(cardId),
    )
    if (queuedCardIds.length === 0) {
      finishDealSequence(current.id)
      return
    }

    clearDealTimers()
    dealQueueRef.current = [...queuedCardIds]
    activeDealMotionRef.current = null
    roundReadyRef.current = false
    flipLockRef.current = true
    setActiveDealMotion(null)
    setRoundReady(false)
    setRevealAnnouncement(announcement)

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.requestAnimationFrame(() => {
        if (pendingRoundRef.current?.id !== current.id) return
        const nextDealtIds = new Set(dealtCardIdsRef.current)
        queuedCardIds.forEach((cardId) => nextDealtIds.add(cardId))
        dealtCardIdsRef.current = nextDealtIds
        dealQueueRef.current = []
        setDealtCardIds(nextDealtIds)
        finishDealSequence(current.id)
      })
      return
    }

    dealGapTimerRef.current = window.setTimeout(() => {
      dealGapTimerRef.current = null
      startNextDealCard(current.id)
    }, 30)
  }

  const releasePendingRound = (clearPersisted = true) => {
    if (flipFallbackTimerRef.current !== null) {
      window.clearTimeout(flipFallbackTimerRef.current)
      flipFallbackTimerRef.current = null
    }
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
    if (autoFlipTimerRef.current !== null) {
      window.clearTimeout(autoFlipTimerRef.current)
      autoFlipTimerRef.current = null
    }
    clearDealTimers()
    dealQueueRef.current = []
    activeDealMotionRef.current = null
    dealtCardIdsRef.current = new Set()
    pendingRoundRef.current = null
    revealedCountRef.current = 0
    flippingCardRef.current = null
    revealActorRef.current = null
    roundReadyRef.current = true
    roundLockRef.current = false
    flipLockRef.current = false
    finalizeLockRef.current = false
    if (clearPersisted) clearPendingRound()
    setPendingRound(null)
    setRevealedCount(0)
    setFlippingCardId(null)
    setRevealActor(null)
    setRoundReady(true)
    setDealtCardIds(new Set())
    setActiveDealMotion(null)
  }

  const finalizeRound = (roundId: string) => {
    const current = pendingRoundRef.current
    const currentGame = gameRef.current
    if (
      !current ||
      current.id !== roundId ||
      !finalizeLockRef.current ||
      currentGame.shoe.id !== current.sourceShoeId ||
      currentGame.shoe.cursor !== current.sourceCursor
    ) {
      if (current?.id === roundId) {
        setNotice('牌靴状态已变化，本局已安全取消且未扣除教学分。')
        releasePendingRound()
      }
      return
    }
    if (currentGame.history.some((item) => item.id === current.id)) {
      releasePendingRound()
      return
    }

    const settlement = settleBets(current.bets, current.result)
    const settlementCheer =
      current.playMode === 'bet'
        ? buildSettlementCheer({
            winner: current.result.winner,
            settlementNet: settlement.net,
            manualSides: manualRevealSides(current.bets, current.playMode),
          })
        : null
    const balanceAfter =
      current.balanceBefore - settlement.totalStake + settlement.totalReturned
    const record: RoundRecord = {
      ...current.result,
      id: current.id,
      shoeId: current.shoeAfter.id,
      handNumber: current.shoeAfter.handNumber,
      timestamp: new Date().toISOString(),
      playMode: current.playMode,
      bets: { ...current.bets },
      settlement,
      balanceBefore: current.balanceBefore,
      balanceAfter,
      cardsRemaining: cardsRemaining(current.shoeAfter),
      rulesetVersion: RULESET_VERSION,
      shuffleVersion: current.shoeAfter.shuffleVersion,
    }

    const nextGame: PersistedGameState = {
      ...currentGame,
      balance: balanceAfter,
      shoe: current.shoeAfter,
      history: [...currentGame.history, record].slice(-500),
      lastBets:
        settlement.totalStake > 0
          ? { ...current.bets }
          : currentGame.lastBets,
    }
    const saved = saveGameState(nextGame)
    gameRef.current = nextGame
    setGame(nextGame)
    setBets({ ...EMPTY_BETS })
    setRevealAnnouncement(
      `本局${outcomeLabel(current.result.winner)}，净输赢${
        settlement.net > 0 ? `正 ${formatNumber(settlement.net)}` : formatNumber(settlement.net)
      } 教学分。`,
    )
    releasePendingRound(saved)
    if (settlementCheer) {
      if (outcomeCheerTimerRef.current !== null) {
        window.clearTimeout(outcomeCheerTimerRef.current)
      }
      outcomeCheerTimerRef.current = window.setTimeout(() => {
        outcomeCheerTimerRef.current = null
        showCrowdCheer(
          `${current.id}:settlement`,
          settlementCheer,
          3_500,
        )
      }, 720)
    }
    window.requestAnimationFrame(() => {
      if (!document.querySelector('[role="dialog"]')) {
        document
          .querySelector<HTMLButtonElement>('.bet-zone:not(:disabled)')
          ?.focus({ preventScroll: true })
      }
    })
    if (!saved) {
      setNotice('本局已在当前页面结算，但浏览器阻止本机保存；刷新可能丢失本局。')
    } else if (current.shoeAfter.needsShuffle) {
      setNotice('切牌位置已到达：本局有效，下一局将自动开启新牌靴。')
    }
  }

  const startRound = (roundBets: Bets, playMode: PlayMode) => {
    if (roundLockRef.current || pendingRoundRef.current) return
    roundLockRef.current = true
    setFormError(null)
    clearCrowdCheer()

    try {
      const currentGame = gameRef.current
      const activeShoe = currentGame.shoe.needsShuffle
        ? createShoe()
        : currentGame.shoe
      const { shoe: shoeAfter, result } = dealRound(activeShoe)
      const pending: PendingRound = {
        id: createRoundId(),
        playMode,
        bets: { ...roundBets },
        balanceBefore: currentGame.balance,
        sourceShoeId: activeShoe.id,
        sourceCursor: activeShoe.cursor,
        shoeAfter,
        result,
      }

      if (currentGame.shoe.needsShuffle) {
        const activeGame = { ...currentGame, shoe: activeShoe }
        saveGameState(activeGame)
        gameRef.current = activeGame
        setGame(activeGame)
        setNotice(`已自动开启新牌靴 ${activeShoe.id.slice(-8)}。`)
      }

      const pendingSaved = savePendingRound({
        ...pending,
        version: 1,
        revealedCount: 0,
      })
      pendingRoundRef.current = pending
      revealedCountRef.current = 0
      flippingCardRef.current = null
      revealActorRef.current = null
      roundReadyRef.current = false
      flipLockRef.current = true
      finalizeLockRef.current = false
      dealtCardIdsRef.current = new Set()
      activeDealMotionRef.current = null
      dealQueueRef.current = []
      setPendingRound(pending)
      setRevealedCount(0)
      setFlippingCardId(null)
      setRevealActor(null)
      setRoundReady(false)
      setDealtCardIds(new Set())
      setActiveDealMotion(null)
      startDealSequence(
        pending,
        visibleRevealCardIds(pending.result, 0),
        '停止下注。荷官正在从牌靴依次发出四张底牌…',
      )
      if (!pendingSaved) {
        setNotice('浏览器阻止本机保存；本局仍可继续，但刷新后无法恢复。')
      }

      window.requestAnimationFrame(() => {
        document.querySelector('#game-table')?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
          block: 'start',
        })
      })
    } catch {
      roundLockRef.current = false
      setFormError('牌靴暂时无法完成本局，请开启新牌靴后重试')
    }
  }

  const completeRevealCard = (roundId: string, cardId: string) => {
    const current = pendingRoundRef.current
    const currentCount = revealedCountRef.current
    const expectedCard = current
      ? nextRevealCard(current.result, currentCount)
      : null

    if (
      !current ||
      current.id !== roundId ||
      flippingCardRef.current !== cardId ||
      expectedCard?.id !== cardId
    ) {
      return
    }

    if (flipFallbackTimerRef.current !== null) {
      window.clearTimeout(flipFallbackTimerRef.current)
      flipFallbackTimerRef.current = null
    }

    const completedActor = revealActorRef.current
    const nextCount = currentCount + 1
    revealedCountRef.current = nextCount
    flippingCardRef.current = null
    revealActorRef.current = null
    setRevealedCount(nextCount)
    setFlippingCardId(null)
    setRevealActor(null)

    const playerIndex = current.result.playerCards.findIndex(
      (card) => card.id === expectedCard.id,
    )
    const bankerIndex = current.result.bankerCards.findIndex(
      (card) => card.id === expectedCard.id,
    )
    const revealedSide: RevealSide = playerIndex >= 0 ? 'player' : 'banker'
    const sideLabel = revealSideLabel(revealedSide)
    const sideIndex = playerIndex >= 0 ? playerIndex : bankerIndex
    setRevealAnnouncement(
      `${completedActor === 'dealer' ? '荷官翻开' : '你翻开'}${sideLabel}第 ${
        sideIndex + 1
      } 张：${cardLabel(expectedCard)}。`,
    )

    const playerRevealedThisCard =
      completedActor === 'user' &&
      current.playMode === 'bet' &&
      manualRevealSides(current.bets, current.playMode).includes(revealedSide)
    if (playerRevealedThisCard) {
      const publicCards = revealedCards(current.result, nextCount)
      const publicSideCards = revealedCardsForSide(
        current.result,
        publicCards,
        revealedSide,
      )
      showCrowdCheer(
        `${current.id}:card:${expectedCard.id}`,
        buildCardRevealCheer({
          side: revealedSide,
          revealedCard: expectedCard,
          revealedCards: publicSideCards,
          isSideComplete: sideIsCompleteFromPublicCards(
            current.result,
            publicCards,
            revealedSide,
          ),
        }),
      )
    }

    if (revealIsComplete(current.result, nextCount)) {
      finalizeLockRef.current = true
      settleTimerRef.current = window.setTimeout(
        () => finalizeRound(roundId),
        260,
      )
      return
    }

    savePendingRound({
      ...current,
      version: 1,
      revealedCount: nextCount,
    })

    const newlyVisibleCards = newlyVisibleUndealtCardIds(
      visibleRevealCardIds(current.result, currentCount),
      visibleRevealCardIds(current.result, nextCount),
      [...dealtCardIdsRef.current],
    )
    if (newlyVisibleCards.length > 0) {
      startDealSequence(
        current,
        newlyVisibleCards,
        '荷官正在补发第三张牌，牌落桌后再继续开牌…',
      )
      return
    }

    flipLockRef.current = false
  }

  const beginRevealCard = (cardId: string, actor: RevealActor) => {
    const current = pendingRoundRef.current
    const expectedCard = current
      ? nextRevealCard(current.result, revealedCountRef.current)
      : null
    const expectedSide =
      current && expectedCard
        ? revealSideForCard(current.result, expectedCard.id)
        : null
    const requiresUser =
      current && expectedSide
        ? manualRevealSides(current.bets, current.playMode).includes(
            expectedSide,
          )
        : false

    if (
      !current ||
      !roundReadyRef.current ||
      flipLockRef.current ||
      finalizeLockRef.current ||
      expectedCard?.id !== cardId ||
      !dealtCardIdsRef.current.has(cardId) ||
      !expectedSide ||
      (actor === 'user') !== requiresUser
    ) {
      return
    }

    flipLockRef.current = true
    flippingCardRef.current = cardId
    revealActorRef.current = actor
    setFlippingCardId(cardId)
    setRevealActor(actor)
    if (actor === 'user' && current.playMode === 'bet') {
      const publicCards = revealedCards(
        current.result,
        revealedCountRef.current,
      )
      const publicSideCards = revealedCardsForSide(
        current.result,
        publicCards,
        expectedSide,
      )
      const latestPublicCard = publicSideCards.at(-1)
      const openingCheer: CrowdCheer = latestPublicCard
        ? buildCardRevealCheer({
            side: expectedSide,
            revealedCard: latestPublicCard,
            revealedCards: publicSideCards,
            isSideComplete: false,
          })
        : {
            side: expectedSide,
            tone: 'anticipation',
            messages: ['慢慢咪…', '开边！开边！', '亮清！'],
          }
      showCrowdCheer(
        `${current.id}:opening:${cardId}`,
        openingCheer,
        1_900,
      )
    }
    setRevealAnnouncement(
      actor === 'dealer'
        ? `荷官正在翻开${revealSideLabel(expectedSide)}牌…`
        : `正在翻开${revealSideLabel(expectedSide)}牌…`,
    )
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.requestAnimationFrame(() =>
        completeRevealCard(current.id, cardId),
      )
    } else {
      flipFallbackTimerRef.current = window.setTimeout(
        () => completeRevealCard(current.id, cardId),
        motionFallbackMs(actor),
      )
    }
  }

  useEffect(() => {
    beginRevealCardRef.current = beginRevealCard
  })

  const handleRevealCard = (cardId: string) => {
    beginRevealCard(cardId, 'user')
  }

  const handleRevealComplete = (cardId: string) => {
    const current = pendingRoundRef.current
    if (current) completeRevealCard(current.id, cardId)
  }

  useEffect(() => {
    if (
      !pendingRound ||
      !roundReady ||
      !pendingNextCard ||
      pendingNextRequiresUser ||
      flippingCardId ||
      rulesOpen ||
      resetOpen ||
      newShoeOpen ||
      roadFullscreen
    ) {
      return
    }

    if (autoFlipTimerRef.current !== null) {
      window.clearTimeout(autoFlipTimerRef.current)
    }
    const roundId = pendingRound.id
    const cardId = pendingNextCard.id
    autoFlipTimerRef.current = window.setTimeout(() => {
      const current = pendingRoundRef.current
      const expected = current
        ? nextRevealCard(current.result, revealedCountRef.current)
        : null
      if (current?.id === roundId && expected?.id === cardId) {
        beginRevealCardRef.current(cardId, 'dealer')
      }
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 20 : 420)

    return () => {
      if (autoFlipTimerRef.current !== null) {
        window.clearTimeout(autoFlipTimerRef.current)
        autoFlipTimerRef.current = null
      }
    }
  }, [
    flippingCardId,
    newShoeOpen,
    pendingNextCard,
    pendingNextRequiresUser,
    pendingRound,
    resetOpen,
    roadFullscreen,
    roundReady,
    rulesOpen,
  ])

  const handleDeal = () => {
    const error = validateBets(bets, game.balance)
    if (error) {
      setFormError(error)
      return
    }

    startRound({ ...bets }, 'bet')
  }

  const handleFly = () => {
    if (totalBets(bets) > 0) {
      setFormError('飞牌只用于无下注对局，请先清空本局筹码')
      return
    }

    startRound({ ...EMPTY_BETS }, 'fly')
  }

  const replaceShoe = () => {
    if (pendingRoundRef.current) return
    clearCrowdCheer()
    const shoe = createShoe()
    const nextGame = { ...gameRef.current, shoe }
    gameRef.current = nextGame
    setGame(nextGame)
    setBets({ ...EMPTY_BETS })
    setNewShoeOpen(false)
    setRevealAnnouncement('新牌靴已就绪，请选择下注对象与筹码。')
    setNotice(`已手动开启新牌靴 ${shoe.id.slice(-8)}；既有记录仍保留。`)
  }

  const resetSimulation = () => {
    if (pendingRoundRef.current) return
    clearCrowdCheer()
    clearGameState()
    const nextGame = makeInitialState()
    gameRef.current = nextGame
    setGame(nextGame)
    setBets({ ...EMPTY_BETS })
    setResetOpen(false)
    setRevealAnnouncement('请先选择下注对象与筹码，然后确认开牌。')
    setNotice('模拟数据与教学分已重置。')
  }

  const exportCsv = () => {
    downloadTextFile(
      `baccarat-history-${new Date().toISOString().slice(0, 10)}.csv`,
      `\uFEFF${historyToCsv(game.history)}`,
      'text/csv;charset=utf-8',
    )
  }

  const exportJson = () => {
    downloadTextFile(
      `baccarat-history-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          rulesetVersion: RULESET_VERSION,
          history: game.history,
        },
        null,
        2,
      ),
      'application/json;charset=utf-8',
    )
  }

  const openDetailView = (view: Exclude<DetailView, null>) => {
    setDetailView(view)
    window.requestAnimationFrame(() => {
      document.querySelector('#table-details')?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
        block: 'start',
      })
    })
  }

  return (
    <div className="app-shell is-minimal-table">
      <a className="skip-link" href="#game-table">
        跳到牌桌
      </a>

      <header className="topbar">
        <a className="brand" href="#game-table" aria-label="九点牌靴模拟牌桌">
          <span className="brand-mark" aria-hidden="true">
            九
          </span>
          <span>
            <strong>九点牌靴</strong>
            <small>BACCARAT LAB</small>
          </span>
        </a>

        <nav aria-label="主导航">
          <button onClick={() => openDetailView('road')}>路单大屏</button>
          <button onClick={() => openDetailView('history')}>牌局记录</button>
          <button onClick={() => setRulesOpen(true)}>规则与来源</button>
        </nav>

        <div className="topbar-status">
          <span className="simulation-badge">
            <i />
            纯模拟 · 无真钱
          </span>
          <button
            className="outline-button"
            onClick={() => setNewShoeOpen(true)}
            disabled={isDealing}
          >
            <RefreshCw size={15} />
            新牌靴
          </button>
        </div>
      </header>

      <main id="top" className="casino-main">
        <section className="game-section immersive-game-section" id="game-table">
          <div className="table-statusbar casino-table-hud">
            <div>
              <span>模拟桌</span>
              <strong>九点 08</strong>
            </div>
            <div>
              <span>牌靴</span>
              <strong>{game.shoe.id.slice(-6)}</strong>
            </div>
            <div>
              <span>局号</span>
              <strong>#{String(game.shoe.handNumber + 1).padStart(2, '0')}</strong>
            </div>
            <div>
              <span>余牌</span>
              <strong>{cardsRemaining(game.shoe)}</strong>
            </div>
            <div className="mini-road-screen" aria-label="最近牌局结果">
              <span>最近牌局</span>
              <div>
                {currentShoeRecords.length === 0 ? (
                  <small>等待第一局</small>
                ) : (
                  currentShoeRecords.slice(-12).map((record) => (
                    <i
                      key={record.id}
                      className={`mini-result mini-result-${record.winner}`}
                      title={outcomeLabel(record.winner)}
                    >
                      {record.winner === 'banker'
                        ? '庄'
                        : record.winner === 'player'
                          ? '闲'
                          : '和'}
                    </i>
                  ))
                )}
              </div>
            </div>
            <div className="table-status-live">
              <i />
              STANDARD COMMISSION
            </div>
          </div>

          <div className="game-layout casino-view">
            <section
              className={`table-stage casino-table-stage ${
                pendingRound ? 'is-revealing' : ''
              } ${pendingRound && !roundReady ? 'is-dealing-cards' : ''}`}
            >
              <div className="felt-pattern" />
              <img
                className="motion-asset-preload"
                src="/assets/card-reveal-hand-v2.webp"
                alt=""
                aria-hidden="true"
                fetchPriority="high"
              />
              <div className="casino-scene-vignette" aria-hidden="true" />
              <div
                className="dealer-shoe-motion-anchor"
                data-dealer-shoe-anchor
                aria-hidden="true"
              />
              <div className="table-simulation-corner">
                <span aria-hidden="true">九</span>
                <strong>纯模拟 · 无真钱</strong>
              </div>

              <div className="table-stage-heading dealer-call-panel">
                <div>
                  <p className="eyebrow">LIVE DEALER · 第一视角</p>
                  <h2>
                    {pendingRound
                      ? !roundReady
                        ? '荷官正在发牌'
                        : flippingCardId
                          ? revealActor === 'dealer'
                            ? '荷官正在开牌'
                            : '请翻开牌面'
                          : pendingNextRequiresUser
                            ? `请开${pendingNextSide ? revealSideLabel(pendingNextSide) : ''}牌`
                            : '荷官正在开牌'
                      : settledCurrentRound
                        ? outcomeLabel(settledCurrentRound.winner)
                        : '请下注'}
                  </h2>
                </div>
                {pendingRound ? (
                  <div className="round-net reveal-progress">
                    <span>
                      {!roundReady
                        ? '按顺序发牌'
                        : pendingRound.playMode === 'fly'
                          ? '飞牌 · 自动'
                          : revealScopeLabel(pendingManualSides)}
                    </span>
                    <strong>
                      {revealedCount} / {revealDisplayTotal}
                    </strong>
                  </div>
                ) : settledCurrentRound ? (
                  <div
                    className={`round-net ${
                      isFlyRound(settledCurrentRound)
                        ? 'fly'
                        : settledCurrentRound.settlement.net >= 0
                          ? 'positive'
                          : 'negative'
                    }`}
                  >
                    <span>
                      {isFlyRound(settledCurrentRound) ? '飞牌结果' : '本局净输赢'}
                    </span>
                    <strong>
                      {isFlyRound(settledCurrentRound)
                        ? '已写入路单'
                        : `${settledCurrentRound.settlement.net > 0 ? '+' : ''}${formatNumber(
                            settledCurrentRound.settlement.net,
                          )}`}
                    </strong>
                  </div>
                ) : (
                  <div className="round-net table-ready-badge">
                    <span>8 副真实牌靴</span>
                    <strong>BETTING OPEN</strong>
                  </div>
                )}
              </div>

              <div className="dealer-sightline">
                <DealerRoadPanel records={currentShoeRecords} />
                <span aria-hidden="true">
                  <i />
                  荷官
                  <strong>
                    {pendingRound
                      ? !roundReady
                        ? '发牌中'
                        : '牌局进行中'
                      : '等待下注'}
                  </strong>
                </span>
              </div>

              <div className="hands-layout first-person-hands">
                <RoundHand
                  side="player"
                  settledRound={settledCurrentRound}
                  pendingRound={pendingRound}
                  roundReady={roundReady}
                  visibleCardIds={visiblePendingCardIds}
                  dealtCardIds={dealtCardIds}
                  activeDealMotion={activeDealMotion}
                  completedCardIds={completedPendingCardIds}
                  nextCardId={pendingNextCard?.id ?? null}
                  nextCardRequiresUser={pendingNextRequiresUser}
                  flippingCardId={flippingCardId}
                  revealActor={revealActor}
                  pendingTotal={pendingPlayerTotal}
                  onFlip={handleRevealCard}
                  onFlipComplete={handleRevealComplete}
                  onDealComplete={completeDealMotion}
                />

                <div className="versus-mark" aria-hidden="true">
                  <span>VS</span>
                </div>

                <RoundHand
                  side="banker"
                  settledRound={settledCurrentRound}
                  pendingRound={pendingRound}
                  roundReady={roundReady}
                  visibleCardIds={visiblePendingCardIds}
                  dealtCardIds={dealtCardIds}
                  activeDealMotion={activeDealMotion}
                  completedCardIds={completedPendingCardIds}
                  nextCardId={pendingNextCard?.id ?? null}
                  nextCardRequiresUser={pendingNextRequiresUser}
                  flippingCardId={flippingCardId}
                  revealActor={revealActor}
                  pendingTotal={pendingBankerTotal}
                  onFlip={handleRevealCard}
                  onFlipComplete={handleRevealComplete}
                  onDealComplete={completeDealMotion}
                />

                <CrowdCheerOverlay cheer={activeCrowdCheer} />
              </div>

              <p
                className="reveal-status dealer-spoken-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {revealAnnouncement}
              </p>

              <BettingPanel
                bets={bets}
                balance={game.balance}
                selectedChip={selectedChip}
                isDealing={isDealing}
                dealingMode={dealingMode}
                error={formError}
                hasLastBets={totalBets(game.lastBets) > 0}
                onSelectChip={setSelectedChip}
                onAddBet={handleAddBet}
                onClear={() => {
                  setBets({ ...EMPTY_BETS })
                  setFormError(null)
                }}
                onRepeat={handleRepeat}
                onFly={handleFly}
                onDeal={handleDeal}
              />

              <div className="stage-rule-note casino-rail-note">
                <span>真实无放回牌靴</span>
                <i />
                <span>玩家只翻下注侧</span>
                <i />
                <span>纯模拟 · 无真钱</span>
              </div>
            </section>
          </div>
        </section>

        <section className="table-companion" id="table-details">
          <div className="compact-shoe-stats" aria-label="当前牌靴统计">
            <span>
              本靴 <strong>{stats.count}</strong> 局
            </span>
            <span className="stat-banker">
              庄 <strong>{stats.banker}</strong>
              <small>{statPercent(stats.banker, stats.count)}</small>
            </span>
            <span className="stat-player">
              闲 <strong>{stats.player}</strong>
              <small>{statPercent(stats.player, stats.count)}</small>
            </span>
            <span className="stat-tie">
              和 <strong>{stats.tie}</strong>
              <small>{statPercent(stats.tie, stats.count)}</small>
            </span>
          </div>
          <div className="table-detail-actions">
            <button
              className={detailView === 'road' ? 'is-active' : ''}
              onClick={() => setDetailView(detailView === 'road' ? null : 'road')}
              aria-pressed={detailView === 'road'}
            >
              查看路单大屏
            </button>
            <button
              className={detailView === 'history' ? 'is-active' : ''}
              onClick={() =>
                setDetailView(detailView === 'history' ? null : 'history')
              }
              aria-pressed={detailView === 'history'}
            >
              <History size={16} />
              完整牌局记录
            </button>
            <button onClick={() => setRulesOpen(true)}>
              <BookOpen size={16} />
              规则与真实性
            </button>
          </div>
        </section>

        {detailView === 'road' && (
          <RoadBoard
            records={currentShoeRecords}
            fullscreen={roadFullscreen}
            onToggleFullscreen={() => setRoadFullscreen((value) => !value)}
          />
        )}

        {detailView === 'history' && (
          <HistoryTable
            history={game.history}
            onExportCsv={exportCsv}
            onExportJson={exportJson}
          />
        )}

        <section className="simulator-disclosure">
          <ShieldCheck size={20} />
          <p>
            八副牌经 Web Crypto 洗牌，并按公开监管补牌规则逐张发出。教学分不可购买、兑换或提现；
            视觉场景为原创模拟环境，与任何实体娱乐场无关。
          </p>
          <button onClick={() => setRulesOpen(true)}>查看公开依据</button>
        </section>
      </main>

      <footer>
        <div className="footer-brand">
          <span className="brand-mark" aria-hidden="true">
            九
          </span>
          <div>
            <strong>九点牌靴 · Baccarat Lab</strong>
            <small>概率教育与软件演示</small>
          </div>
        </div>
        <p>
          本项目仅供概率教育与软件演示，不涉及真钱、存款、提现或可兑换奖励。与 Las Vegas
          Sands、Sands China、Marina Bay Sands、The Venetian
          及其关联方无关，未获其赞助或背书。历史路单不具备预测能力。
        </p>
        <div className="footer-actions">
          <button onClick={() => setRulesOpen(true)}>规则与来源</button>
          <button onClick={() => setResetOpen(true)} disabled={isDealing}>
            重置本机数据
          </button>
        </div>
      </footer>

      {notice && (
        <div className="toast" role="status">
          <ShieldCheck size={18} />
          {notice}
        </div>
      )}

      {rulesOpen && (
        <Modal title="标准佣金百家乐规则" onClose={() => setRulesOpen(false)} wide>
          <div className="rules-intro">
            <span className="simulation-badge">8 副牌 · 416 张 · 传统庄佣</span>
            <p>
              本模拟器以新加坡博彩监管局公布的 Marina Bay Sands Baccarat Version 8
              为主规则来源，并固定使用其中允许的八副牌配置。
            </p>
          </div>

          <div className="payout-table">
            <div className="payout-head">
              <span>注项</span>
              <span>净赢</span>
              <span>含本金总返还</span>
              <span>说明</span>
            </div>
            <div>
              <strong className="text-player">闲 Player</strong>
              <span>1 : 1</span>
              <span>2.00×</span>
              <span>和局退回原注</span>
            </div>
            <div>
              <strong className="text-banker">庄 Banker</strong>
              <span>0.95 : 1</span>
              <span>1.95×</span>
              <span>仅庄赢利扣 5% 佣金；和局退注</span>
            </div>
            <div>
              <strong className="text-tie">和 Tie</strong>
              <span>8 : 1</span>
              <span>9.00×</span>
              <span>双方最终点数相同</span>
            </div>
            <div>
              <strong>闲对 / 庄对</strong>
              <span>11 : 1</span>
              <span>12.00×</span>
              <span>各自首两张牌 rank 相同</span>
            </div>
          </div>

          <div className="rules-grid">
            <article>
              <h3>牌值与自然牌</h3>
              <p>A = 1；2–9 按牌面；10、J、Q、K = 0。总点数只取个位。</p>
              <p>任一方首两张为 8 或 9 即自然牌，双方都不再补牌。</p>
            </article>
            <article>
              <h3>闲家补牌</h3>
              <p>无自然牌时，闲家 0–5 点必须补一张；6–7 点停牌。</p>
              <p>若闲家停牌，庄家 0–5 点补牌、6–7 点停牌。</p>
            </article>
          </div>

          <div className="draw-table">
            <h3>闲家补第三张后，庄家补牌矩阵</h3>
            <div className="draw-table-grid">
              <span>庄两张点数</span>
              <span>遇闲第三张为以下点数时补牌</span>
              <strong>0 / 1 / 2</strong>
              <span>总是补牌</span>
              <strong>3</strong>
              <span>0–7、9（仅遇 8 停牌）</span>
              <strong>4</strong>
              <span>2–7</span>
              <strong>5</strong>
              <span>4–7</span>
              <strong>6</strong>
              <span>6–7</span>
              <strong>7</strong>
              <span>总是停牌</span>
            </div>
          </div>

          <div className="rules-sources">
            <h3>公开来源</h3>
            {SOURCES.map((source) => (
              <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>
                <span>
                  <strong>{source.title}</strong>
                  <small>{source.description}</small>
                </span>
                <ExternalLink size={16} />
              </a>
            ))}
          </div>
        </Modal>
      )}

      {resetOpen && (
        <Modal title="重置全部本机模拟数据？" onClose={() => setResetOpen(false)}>
          <div className="confirm-copy">
            <CircleAlert size={30} />
            <p>这会清除当前浏览器中的牌靴、最近 500 局记录和教学分余额，且无法撤销。</p>
            <div>
              <button className="secondary-button" onClick={() => setResetOpen(false)}>
                取消
              </button>
              <button className="danger-button" onClick={resetSimulation}>
                确认重置
              </button>
            </div>
          </div>
        </Modal>
      )}

      {newShoeOpen && (
        <Modal title="手动开启新牌靴？" onClose={() => setNewShoeOpen(false)}>
          <div className="confirm-copy">
            <RefreshCw size={30} />
            <p>
              当前牌靴剩余 {cardsRemaining(game.shoe)} 张。开启新牌靴会重置当前路单，但不会删除完整历史记录。
            </p>
            <div>
              <button className="secondary-button" onClick={() => setNewShoeOpen(false)}>
                继续本靴
              </button>
              <button className="confirm-button" onClick={replaceShoe}>
                开启新牌靴
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default App
