import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  History,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { BettingPanel } from './components/BettingPanel'
import { HistoryTable } from './components/HistoryTable'
import { PlayingCard, RevealPlayingCard } from './components/PlayingCard'
import { RoadBoard } from './components/RoadBoard'
import {
  EMPTY_BETS,
  HOUSE_EDGES,
  RULESET_VERSION,
  THEORETICAL_PROBABILITIES,
  cardsRemaining,
  createShoe,
  dealRound,
  handTotal,
  settleBets,
  totalBets,
  validateBets,
} from './game/baccarat'
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
  visibleCardIds: Set<string>
  completedCardIds: Set<string>
  nextCardId: string | null
  nextCardRequiresUser: boolean
  flippingCardId: string | null
  revealActor: RevealActor | null
  pendingTotal: number | null
  onFlip: (cardId: string) => void
  onFlipComplete: (cardId: string) => void
}

function RoundHand({
  side,
  settledRound,
  pendingRound,
  visibleCardIds,
  completedCardIds,
  nextCardId,
  nextCardRequiresUser,
  flippingCardId,
  revealActor,
  pendingTotal,
  onFlip,
  onFlipComplete,
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
            return (
              <RevealPlayingCard
                card={card}
                index={index}
                side={side}
                faceUp={completedCardIds.has(card.id) || isFlipping}
                canFlip={
                  nextCardId === card.id &&
                  nextCardRequiresUser &&
                  !flippingCardId
                }
                isFlipping={isFlipping}
                isAutomatic={isFlipping && revealActor === 'dealer'}
                willAutoFlip={
                  nextCardId === card.id &&
                  !nextCardRequiresUser &&
                  !flippingCardId
                }
                onFlip={onFlip}
                onFlipComplete={onFlipComplete}
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

  const gameRef = useRef(game)
  const pendingRoundRef = useRef<PendingRound | null>(
    initialSession.pendingRound,
  )
  const revealedCountRef = useRef(initialSession.revealedCount)
  const flippingCardRef = useRef<string | null>(null)
  const revealActorRef = useRef<RevealActor | null>(null)
  const roundLockRef = useRef(Boolean(initialSession.pendingRound))
  const flipLockRef = useRef(false)
  const finalizeLockRef = useRef(false)
  const flipFallbackTimerRef = useRef<number | null>(null)
  const settleTimerRef = useRef<number | null>(null)
  const focusTimerRef = useRef<number | null>(null)
  const autoFlipTimerRef = useRef<number | null>(null)
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

  useEffect(() => {
    if (
      !pendingRound ||
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
    pendingRoundRef.current = null
    revealedCountRef.current = 0
    flippingCardRef.current = null
    revealActorRef.current = null
    roundLockRef.current = false
    flipLockRef.current = false
    finalizeLockRef.current = false
    if (clearPersisted) clearPendingRound()
    setPendingRound(null)
    setRevealedCount(0)
    setFlippingCardId(null)
    setRevealActor(null)
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
      flipLockRef.current = false
      finalizeLockRef.current = false
      setPendingRound(pending)
      setRevealedCount(0)
      setFlippingCardId(null)
      setRevealActor(null)
      const revealSides = manualRevealSides(roundBets, playMode)
      setRevealAnnouncement(
        playMode === 'fly'
          ? '飞牌进行中，本局无下注，荷官将自动开牌并写入路单。'
          : revealSides.length === 1
            ? `下注已锁定。本局由你翻开${revealSideLabel(
                revealSides[0],
              )}，另一方由荷官自动翻开。`
            : '下注已锁定。本局下注涉及双方，请按亮起顺序翻牌。',
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
    const sideLabel = playerIndex >= 0 ? '闲家' : '庄家'
    const sideIndex = playerIndex >= 0 ? playerIndex : bankerIndex
    setRevealAnnouncement(
      `${completedActor === 'dealer' ? '荷官翻开' : '你翻开'}${sideLabel}第 ${
        sideIndex + 1
      } 张：${cardLabel(expectedCard)}。`,
    )

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
      flipLockRef.current ||
      finalizeLockRef.current ||
      expectedCard?.id !== cardId ||
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
    setRevealAnnouncement(
      actor === 'dealer'
        ? `荷官正在翻开${revealSideLabel(expectedSide)}牌…`
        : `正在翻开${revealSideLabel(expectedSide)}牌…`,
    )
    flipFallbackTimerRef.current = window.setTimeout(
      () => completeRevealCard(current.id, cardId),
      1_100,
    )
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
    }, 420)

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

  return (
    <div className="app-shell">
      <a className="skip-link" href="#game-table">
        跳到牌桌
      </a>

      <header className="topbar">
        <a className="brand" href="#top" aria-label="九点牌靴首页">
          <span className="brand-mark" aria-hidden="true">
            九
          </span>
          <span>
            <strong>九点牌靴</strong>
            <small>BACCARAT LAB</small>
          </span>
        </a>

        <nav aria-label="主导航">
          <a href="#road-board">路单</a>
          <a href="#history">记录</a>
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

      <main id="top">
        <section className="hero">
          <div className="hero-glow hero-glow-one" />
          <div className="hero-glow hero-glow-two" />
          <div className="hero-copy">
            <p className="eyebrow">EIGHT-DECK PUNTO BANCO · 8 副牌</p>
            <h1>
              真实牌靴概率，
              <br />
              一局一证的<span>百家乐实验室</span>
            </h1>
            <p className="hero-lead">
              以公开监管规则为基准，用 Web Crypto 洗牌、无放回发牌和完整补牌矩阵生成每局；
              不强行拟合比例，不把路单包装成预测。
            </p>
            <div className="hero-actions">
              <a className="primary-link" href="#game-table">
                进入模拟牌桌
                <ChevronRight size={18} />
              </a>
              <button className="text-button" onClick={() => setRulesOpen(true)}>
                <BookOpen size={17} />
                查看规则依据
              </button>
            </div>
          </div>

          <div className="probability-panel" aria-label="八副牌理论概率">
            <div className="probability-header">
              <span>
                <Sparkles size={16} />
                八副牌理论基准
              </span>
              <small>组合枚举值</small>
            </div>
            <div className="probability-row probability-banker">
              <span>
                <i>B</i>庄家
              </span>
              <strong>{(THEORETICAL_PROBABILITIES.banker * 100).toFixed(4)}%</strong>
              <small>庄注优势 {(HOUSE_EDGES.banker * 100).toFixed(4)}%</small>
            </div>
            <div className="probability-row probability-player">
              <span>
                <i>P</i>闲家
              </span>
              <strong>{(THEORETICAL_PROBABILITIES.player * 100).toFixed(4)}%</strong>
              <small>闲注优势 {(HOUSE_EDGES.player * 100).toFixed(4)}%</small>
            </div>
            <div className="probability-row probability-tie">
              <span>
                <i>T</i>和局
              </span>
              <strong>{(THEORETICAL_PROBABILITIES.tie * 100).toFixed(4)}%</strong>
              <small>和注优势 {(HOUSE_EDGES.tie * 100).toFixed(4)}%</small>
            </div>
            <p>
              <CircleAlert size={14} />
              单副牌靴会自然偏离理论比例，偏离不等于失真。
            </p>
          </div>
        </section>

        <section className="trust-strip" aria-label="模拟器保证">
          <span>
            <ShieldCheck size={18} />
            Web Crypto 无模偏差洗牌
          </span>
          <span>
            <Scale size={18} />
            监管规则补牌与结算
          </span>
          <span>
            <History size={18} />
            最多 500 局本机记录
          </span>
          <span>
            <Clock3 size={18} />
            当前会话始于{' '}
            {new Intl.DateTimeFormat('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(game.sessionStartedAt))}
          </span>
        </section>

        <section className="game-section" id="game-table">
          <div className="table-statusbar">
            <div>
              <span>桌号</span>
              <strong>LAB 08</strong>
            </div>
            <div>
              <span>牌靴</span>
              <strong>{game.shoe.id.slice(-8)}</strong>
            </div>
            <div>
              <span>局号</span>
              <strong>{String(game.shoe.handNumber + 1).padStart(2, '0')}</strong>
            </div>
            <div>
              <span>余牌</span>
              <strong>{cardsRemaining(game.shoe)}</strong>
            </div>
            <div>
              <span>切牌</span>
              <strong>{game.shoe.cutAtRemaining} 张</strong>
            </div>
            <div className="table-status-live">
              <i />
              STANDARD COMMISSION
            </div>
          </div>

          <div className="game-layout">
            <section
              className={`table-stage ${pendingRound ? 'is-revealing' : ''}`}
            >
              <div className="felt-pattern" />
              <div className="table-stage-heading">
                <div>
                  <p className="eyebrow">CURRENT HAND · 当前局</p>
                  <h2>
                    {pendingRound
                      ? flippingCardId
                        ? revealActor === 'dealer'
                          ? '荷官正在翻牌'
                          : '正在翻牌'
                        : pendingNextRequiresUser
                          ? '点击下注一方牌背'
                          : '等待荷官翻牌'
                      : settledCurrentRound
                        ? outcomeLabel(settledCurrentRound.winner)
                        : '等待开牌'}
                  </h2>
                </div>
                {pendingRound ? (
                  <div className="round-net reveal-progress">
                    <span>
                      {pendingRound.playMode === 'fly'
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
                      {isFlyRound(settledCurrentRound) ? '本局模式' : '本局净输赢'}
                    </span>
                    <strong>
                      {isFlyRound(settledCurrentRound)
                        ? '飞牌 · 无下注'
                        : `${settledCurrentRound.settlement.net > 0 ? '+' : ''}${formatNumber(
                            settledCurrentRound.settlement.net,
                          )}`}
                    </strong>
                  </div>
                ) : null}
              </div>

              <div className="hands-layout">
                <RoundHand
                  side="player"
                  settledRound={settledCurrentRound}
                  pendingRound={pendingRound}
                  visibleCardIds={visiblePendingCardIds}
                  completedCardIds={completedPendingCardIds}
                  nextCardId={pendingNextCard?.id ?? null}
                  nextCardRequiresUser={pendingNextRequiresUser}
                  flippingCardId={flippingCardId}
                  revealActor={revealActor}
                  pendingTotal={pendingPlayerTotal}
                  onFlip={handleRevealCard}
                  onFlipComplete={handleRevealComplete}
                />

                <div className="versus-mark" aria-hidden="true">
                  <span>VS</span>
                </div>

                <RoundHand
                  side="banker"
                  settledRound={settledCurrentRound}
                  pendingRound={pendingRound}
                  visibleCardIds={visiblePendingCardIds}
                  completedCardIds={completedPendingCardIds}
                  nextCardId={pendingNextCard?.id ?? null}
                  nextCardRequiresUser={pendingNextRequiresUser}
                  flippingCardId={flippingCardId}
                  revealActor={revealActor}
                  pendingTotal={pendingBankerTotal}
                  onFlip={handleRevealCard}
                  onFlipComplete={handleRevealComplete}
                />
              </div>

              <p
                className="reveal-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {revealAnnouncement}
              </p>

              <div className="stage-rule-note">
                <span>点数只取个位</span>
                <i />
                <span>8 / 9 为自然牌</span>
                <i />
                <span>补牌由规则自动决定</span>
              </div>
            </section>

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
          </div>
        </section>

        <section className="live-stats" aria-label="当前牌靴统计">
          <div>
            <span>本靴局数</span>
            <strong>{stats.count}</strong>
            <small>余 {cardsRemaining(game.shoe)} 张</small>
          </div>
          <div className="stat-banker">
            <span>庄家</span>
            <strong>{stats.banker}</strong>
            <small>{statPercent(stats.banker, stats.count)}</small>
          </div>
          <div className="stat-player">
            <span>闲家</span>
            <strong>{stats.player}</strong>
            <small>{statPercent(stats.player, stats.count)}</small>
          </div>
          <div className="stat-tie">
            <span>和局</span>
            <strong>{stats.tie}</strong>
            <small>{statPercent(stats.tie, stats.count)}</small>
          </div>
          <div>
            <span>自然牌</span>
            <strong>{stats.naturals}</strong>
            <small>{statPercent(stats.naturals, stats.count)}</small>
          </div>
          <div>
            <span>含对子局</span>
            <strong>{stats.pairs}</strong>
            <small>{statPercent(stats.pairs, stats.count)}</small>
          </div>
        </section>

        <RoadBoard
          records={currentShoeRecords}
          fullscreen={roadFullscreen}
          onToggleFullscreen={() => setRoadFullscreen((value) => !value)}
        />

        <HistoryTable history={game.history} onExportCsv={exportCsv} onExportJson={exportJson} />

        <section className="method-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">METHODOLOGY · 可复核设计</p>
              <h2>为什么这不是“按比例开奖”</h2>
            </div>
          </div>
          <div className="method-grid">
            <article>
              <span>01</span>
              <h3>真实 416 张牌靴</h3>
              <p>八副完整扑克牌经 Web Crypto 驱动的 Fisher–Yates 洗牌，每张牌只能被发出一次。</p>
            </article>
            <article>
              <span>02</span>
              <h3>固定发牌与补牌表</h3>
              <p>依次发闲、庄、闲、庄，再根据自然牌与标准补牌矩阵决定是否补第三张。</p>
            </article>
            <article>
              <span>03</span>
              <h3>短期偏差原样保留</h3>
              <p>45.8597% 等是超大样本理论值；单靴连庄、连闲或和局偏多都可能自然发生。</p>
            </article>
            <article>
              <span>04</span>
              <h3>逐局可导出审计</h3>
              <p>每局保存牌面、发牌结果、点数、注项、结算、余额及规则版本，可导出 CSV/JSON。</p>
            </article>
          </div>
        </section>

        <section className="source-section">
          <div className="source-copy">
            <p className="eyebrow">PUBLIC SOURCES · 公开依据</p>
            <h2>规则来自监管文本，不来自营销话术</h2>
            <p>
              本版本固定为八副牌标准佣金桌。公开 MBS 规则本身允许 4–10
              副牌，澳门规则允许其他副数；因此页面不会声称所有金沙现场桌都使用完全相同配置或限额。
            </p>
            <button className="outline-button" onClick={() => setRulesOpen(true)}>
              查看完整赔率与补牌表
            </button>
          </div>
          <div className="source-list">
            {SOURCES.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                <span>
                  <strong>{source.title}</strong>
                  <small>{source.description}</small>
                </span>
                <ExternalLink size={17} />
              </a>
            ))}
          </div>
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
