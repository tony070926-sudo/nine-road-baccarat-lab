import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CircleAlert,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Volume2,
  VolumeX,
} from 'lucide-react'
import {
  MOTION_ASSET_URLS,
  NEW_SHOE_MOTION_MS,
  OUTCOME_MOTION_MS,
  STARTING_BALANCE,
} from './app/tableConfig'
import {
  loadInitialSession,
  pendingRoundFromPersisted,
} from './app/tableSession'
import { TableDealerHeader } from './app/TableDealerHeader'
import { TableDealerProcedure } from './app/TableDealerProcedure'
import type {
  DetailView,
  NewShoeMotion,
  OutcomeMotion,
  RevealActor,
  RoundPrelude,
} from './app/tableTypes'
import {
  createRoundId,
  derivePendingRoundView,
  formatNumber,
  outcomeLabel,
  revealSideLabel,
  roundRevealInstruction,
  statPercent,
  summarizeShoeRecords,
  tableLeaseUnavailableMessage,
} from './app/tableUi'
import { useMotionProfilePreference } from './app/useMotionProfilePreference'
import { useInitialPointCall } from './app/useInitialPointCall'
import {
  settlementPresentationCopy,
  useSettlementPresentation,
} from './app/useSettlementPresentation'
import {
  casinoAudio,
  loadAudioPreference,
  type CasinoAudioMixChannel,
} from './audio/casinoAudio'
import { BettingPanel } from './components/BettingPanel'
import {
  CrowdCheerOverlay,
  type ActiveCrowdCheer,
} from './components/CrowdCheerOverlay'
import { DealerArmBridge } from './components/DealerArmBridge'
import { DealerCardSweepAction } from './components/DealerCardSweepAction'
import { DealerNewShoeAction } from './components/DealerNewShoeAction'
import { DealerTableAction } from './components/DealerTableAction'
import { ExperienceSettingsModal } from './components/ExperienceSettingsModal'
import { HistoryTable } from './components/HistoryTable'
import { LeaderboardPanel } from './components/LeaderboardPanel'
import { leaderboardHighFromRecordedGame } from './leaderboard/historySeed'
import type { RevealInputMethod } from './components/PlayingCard'
import { ProbabilityLab } from './components/ProbabilityLab'
import { RoadBoard } from './components/RoadBoard'
import { RoundHand } from './components/RoundHand'
import { RoundRuleTrace } from './components/RoundRuleTrace'
import { RulesModal } from './components/RulesModal'
import { TableGuests } from './components/TableGuests'
import { TableDetailActions } from './components/TableDetailActions'
import { TableMaintenanceModals } from './components/TableMaintenanceModals'
import {
  TableMotionAtmosphere,
  type TableMotionPhase,
} from './components/TableMotionAtmosphere'
import {
  EMPTY_BETS,
  RULESET_VERSION,
  TABLE_LIMITS,
  cardsRemaining,
  createShoe,
  handTotal,
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
  downloadTextFile,
  historyToCsv,
} from './game/historyExport'
import {
  advanceRevealState,
  prepareRoundState,
  replaceShoeState,
  resetTableState,
  settleRoundState,
} from './game/tableEngine'
import { TableCoordinator } from './game/tableCoordinator'
import {
  tableVersionOf,
  type PersistedTableEnvelopeV2,
  type TableCoreState,
  type TableVersion,
} from './game/tableState'
import {
  dealContactDelayMs,
  isMatchingDealMotion,
  motionFallbackMs,
  newlyVisibleUndealtCardIds,
  type DealMotionToken,
} from './game/motion'
import {
  dealMotionDuration,
  type MotionProfile,
} from './game/motionProfile'
import {
  CHIP_STACK_IMPACT_MS,
  appendWagerChip,
  clearWagerChipLedger,
  removeLastWagerChip,
  rebuildWagerChipLedger,
  type WagerChipLedger,
} from './game/chipPhysics'
import {
  createConnectivityMonitor,
  type ConnectivityStatus,
} from './game/connectivity'
import {
  dealerSettlementSteps,
  type DealerSettlementMotion,
} from './game/settlementMotion'
import {
  tableLeaseIsSupported,
  tryAcquireTableLease,
} from './game/tableLease'
import {
  manualRevealSides,
  nextRevealCard,
  openingDealCardIds,
  revealOrder,
  revealIsComplete,
  revealSideForCard,
  revealedCards,
  visibleRevealCardIds,
} from './game/reveal'
import {
  pendingRoundMatchesGame,
  pendingRoundsMatch,
} from './game/roundIntegrity'
import {
  buildTableGuestRevealReactions,
  buildTableGuestSettlementReactions,
  createShoeTableGuests,
  type PublicTableCardReveal,
} from './game/tableGuests'
import type { RevealSide } from './game/reveal'
import { cardLabel } from './game/cards'
import type {
  Bets,
  PendingRound,
  PersistedGameState,
  PlayMode,
  ShoeState,
} from './types'
import './styles.css'

function App() {
  const [initialSession] = useState(loadInitialSession)
  const [tableCoordinator] = useState(() => new TableCoordinator())
  const [storageReady, setStorageReady] = useState(false)
  const [game, setGame] = useState<PersistedGameState>(initialSession.game)
  const [bets, setBets] = useState<Bets>(
    initialSession.pendingRound
      ? { ...initialSession.pendingRound.bets }
      : { ...EMPTY_BETS },
  )
  const [wagerChipLedger, setWagerChipLedger] =
    useState<WagerChipLedger>(() =>
      rebuildWagerChipLedger(
        initialSession.pendingRound?.bets ?? EMPTY_BETS,
      ),
    )
  const [settlementWagerChipLedger, setSettlementWagerChipLedger] =
    useState<WagerChipLedger | null>(null)
  const [selectedChip, setSelectedChip] = useState(100)
  const [audioEnabled, setAudioEnabled] = useState(loadAudioPreference)
  const [audioMix, setAudioMix] = useState(() => casinoAudio.getMix())
  const {
    motionProfile,
    effectiveMotionProfile,
    scaledMotionDuration,
    updateMotionProfile,
  } = useMotionProfilePreference()
  const [pendingRound, setPendingRound] = useState<PendingRound | null>(
    initialSession.pendingRound,
  )
  const [revealedCount, setRevealedCount] = useState(
    initialSession.revealedCount,
  )
  const [flippingCardId, setFlippingCardId] = useState<string | null>(null)
  const [revealActor, setRevealActor] = useState<RevealActor | null>(null)
  const [roundReady, setRoundReady] = useState(false)
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
      ? '检测到已锁定牌局，正在取得此牌桌的独占控制权…'
      : '请先选择下注对象与筹码，然后确认开牌。',
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [newShoeOpen, setNewShoeOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [roadFullscreen, setRoadFullscreen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const recordedLeaderboardHigh = useMemo(
    () => leaderboardHighFromRecordedGame(game.balance, game.history),
    [game.balance, game.history],
  )
  const [activeCrowdCheer, setActiveCrowdCheer] =
    useState<ActiveCrowdCheer | null>(null)
  const [settlementMotion, setSettlementMotion] =
    useState<DealerSettlementMotion | null>(null)
  const [roundPrelude, setRoundPrelude] = useState<RoundPrelude | null>(null)
  const [newShoeMotion, setNewShoeMotion] =
    useState<NewShoeMotion | null>(null)
  const [outcomeMotion, setOutcomeMotion] =
    useState<OutcomeMotion | null>(null)
  const [roundRequesting, setRoundRequesting] = useState(false)
  const [connectivityStatus, setConnectivityStatus] = useState<ConnectivityStatus>('checking')
  const latestRound = game.history[game.history.length - 1] ?? null
  const settledCurrentRound = latestRound?.shoeId === game.shoe.id ? latestRound : null
  const {
    presentation: settlementPresentation,
    cardSweepMotion,
    clearedRoundId,
    startSettlementPresentation,
    handleDealerSettlementStep,
    handleDealerSettlementComplete,
  } = useSettlementPresentation(latestRound?.id ?? null)
  const {
    announcedRoundId: initialPointsAnnouncedRoundId,
    begin: beginInitialPointCall,
    markComplete: markInitialPointCallComplete,
    cancel: cancelInitialPointCall,
  } = useInitialPointCall(
    initialSession.pendingRound && initialSession.revealedCount >= 4
      ? initialSession.pendingRound.id
      : null,
  )
  const settlementActions = useMemo(
    () =>
      settlementMotion
        ? dealerSettlementSteps(settlementMotion).map((step) => step.kind)
        : [],
    [settlementMotion],
  )

  const gameRef = useRef(game)
  const tableVersionRef = useRef<TableVersion | null>(
    initialSession.tableVersion,
  )
  const wagerChipLedgerRef = useRef(wagerChipLedger)
  const pendingRoundRef = useRef<PendingRound | null>(
    initialSession.pendingRound,
  )
  const revealedCountRef = useRef(initialSession.revealedCount)
  const flippingCardRef = useRef<string | null>(null)
  const revealActorRef = useRef<RevealActor | null>(null)
  const roundReadyRef = useRef(false)
  const roundLockRef = useRef(Boolean(initialSession.pendingRound))
  const flipLockRef = useRef(Boolean(initialSession.pendingRound))
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
  const outcomeMotionTimerRef = useRef<number | null>(null)
  const roundPreludeTimerRef = useRef<number | null>(null)
  const roundPreludeRef = useRef<RoundPrelude | null>(null)
  const newShoeMotionTimerRef = useRef<number | null>(null)
  const newShoeMotionRef = useRef<NewShoeMotion | null>(null)
  const settlementLockRef = useRef(false)
  const tableLeaseReleaseRef = useRef<(() => void) | null>(null)
  const tableLeaseRequestRef = useRef<Promise<boolean> | null>(null)
  const crowdCheerSequenceRef = useRef(0)
  const audioEventSequenceRef = useRef(0)
  const tableStageRef = useRef<HTMLElement>(null)
  const beginRevealCardRef = useRef<
    (
      cardId: string,
      actor: RevealActor,
      inputMethod?: RevealInputMethod,
    ) => void
  >(() => undefined)
  const finalizeRoundRef = useRef<(roundId: string) => void>(
    () => undefined,
  )

  const isDealing =
    !storageReady ||
    roundRequesting ||
    roundPrelude !== null ||
    newShoeMotion !== null ||
    pendingRound !== null ||
    settlementPresentation !== null
  const dealingMode =
    newShoeMotion?.roundIntent?.playMode ??
    roundPrelude?.playMode ??
    pendingRound?.playMode ??
    null
  const displayedBets =
    settlementMotion?.bets ??
    newShoeMotion?.roundIntent?.bets ??
    roundPrelude?.bets ??
    bets
  const displayedWagerChipLedger =
    settlementWagerChipLedger ?? wagerChipLedger
  const isLockingBets = roundPrelude !== null

  const replaceWagerChipLedger = (ledger: WagerChipLedger) => {
    wagerChipLedgerRef.current = ledger
    setWagerChipLedger(ledger)
  }

  const clearVisualWagers = () => {
    replaceWagerChipLedger(clearWagerChipLedger())
  }

  const acquireTableLease = () => {
    if (tableLeaseReleaseRef.current) return Promise.resolve(true)
    if (tableLeaseRequestRef.current) return tableLeaseRequestRef.current

    const request = tryAcquireTableLease().then((release) => {
      if (!release) return false
      if (tableLeaseReleaseRef.current) {
        release()
      } else {
        tableLeaseReleaseRef.current = release
      }
      return true
    })
    tableLeaseRequestRef.current = request
    void request.finally(() => {
      if (tableLeaseRequestRef.current === request) {
        tableLeaseRequestRef.current = null
      }
    })
    return request
  }

  const releaseTableLease = () => {
    const release = tableLeaseReleaseRef.current
    tableLeaseReleaseRef.current = null
    release?.()
  }

  useEffect(() => {
    let stopped = false
    let retryTimer: number | null = null

    const applyCanonicalSnapshot = (
      snapshot: PersistedTableEnvelopeV2,
      ownsLease: boolean,
    ) => {
      tableVersionRef.current = tableVersionOf(snapshot)
      gameRef.current = snapshot.game
      setGame(snapshot.game)

      if (!snapshot.pending) {
        pendingRoundRef.current = null
        revealedCountRef.current = 0
        dealtCardIdsRef.current = new Set()
        roundReadyRef.current = true
        roundLockRef.current = false
        flipLockRef.current = false
        finalizeLockRef.current = false
        setPendingRound(null)
        setRevealedCount(0)
        setDealtCardIds(new Set())
        setRoundReady(true)
        setBets({ ...EMPTY_BETS })
        const clearedLedger = clearWagerChipLedger()
        wagerChipLedgerRef.current = clearedLedger
        setWagerChipLedger(clearedLedger)
        return
      }

      const restoredRound = pendingRoundFromPersisted(snapshot.pending)
      const restoredCount = snapshot.pending.revealedCount
      if (restoredCount >= 4) {
        markInitialPointCallComplete(restoredRound.id)
      }
      const restoredDealtIds = new Set(
        visibleRevealCardIds(restoredRound.result, restoredCount),
      )
      const isFullyRevealed = revealIsComplete(
        restoredRound.result,
        restoredCount,
      )

      pendingRoundRef.current = restoredRound
      revealedCountRef.current = restoredCount
      dealtCardIdsRef.current = restoredDealtIds
      roundLockRef.current = true
      roundReadyRef.current = ownsLease && !isFullyRevealed
      flipLockRef.current = !ownsLease || isFullyRevealed
      setPendingRound(restoredRound)
      setRevealedCount(restoredCount)
      setDealtCardIds(restoredDealtIds)
      setBets({ ...restoredRound.bets })
      const restoredLedger = rebuildWagerChipLedger(restoredRound.bets)
      wagerChipLedgerRef.current = restoredLedger
      setWagerChipLedger(restoredLedger)
      setRoundReady(ownsLease && !isFullyRevealed)
      setRevealAnnouncement(
        ownsLease
          ? isFullyRevealed
            ? '完整牌面与锁定下注已恢复，正在完成结算。'
            : restoredRound.playMode === 'fly'
              ? '飞牌对局已恢复，荷官将继续自动开牌。'
              : '已锁定下注对局已恢复，将按下注侧继续翻牌。'
          : '另一标签页正在控制这局牌；当前页面只读取单一权威快照并等待同步。',
      )

      if (ownsLease && isFullyRevealed) {
        finalizeLockRef.current = true
        settleTimerRef.current = window.setTimeout(
          () => finalizeRoundRef.current(restoredRound.id),
          80,
        )
      }
    }

    const restoreOrBootstrap = async () => {
      retryTimer = null
      const release = await tryAcquireTableLease()
      if (stopped) {
        release?.()
        return
      }

      if (!release) {
        const canonical = tableCoordinator.read()
        if (canonical.status === 'ok') {
          applyCanonicalSnapshot(canonical.snapshot, false)
          setStorageReady(true)
        } else if (
          canonical.status === 'corrupt' ||
          canonical.status === 'unavailable'
        ) {
          setStorageReady(false)
          setFormError(
            canonical.status === 'corrupt'
              ? '牌桌单一存储快照已损坏；为保护牌靴与余额，所有操作已停止。'
              : '浏览器无法读取牌桌存储；为避免重复抽牌，所有操作已停止。',
          )
        }
        if (tableLeaseIsSupported()) {
          retryTimer = window.setTimeout(restoreOrBootstrap, 900)
        } else {
          setFormError('此浏览器缺少 Web Locks，无法安全恢复或开始牌局。')
        }
        return
      }

      tableLeaseReleaseRef.current = release
      const bootstrap = tableCoordinator.bootstrap(() => initialSession.game)
      if (bootstrap.status !== 'ready') {
        setStorageReady(false)
        setFormError(
          bootstrap.status === 'corrupt'
            ? '牌桌存储记录已损坏；未迁移、未覆盖，所有写入已停止。'
            : '浏览器未能建立可校验的牌桌快照；所有写入已停止。',
        )
        releaseTableLease()
        return
      }

      applyCanonicalSnapshot(bootstrap.snapshot, true)
      setStorageReady(true)
      if (bootstrap.warning) {
        setNotice('旧版未完成牌局无法安全恢复，已保留余额、牌靴与历史记录。')
      }
      if (!bootstrap.snapshot.pending) {
        setRevealAnnouncement('请先选择下注对象与筹码，然后确认开牌。')
        releaseTableLease()
      }
    }

    tableCoordinator.start()
    const unsubscribe = tableCoordinator.subscribe((snapshot) => {
      if (stopped) return
      // BroadcastChannel and storage events are only revision hints. The
      // coordinator has already re-read and validated the canonical v2 key.
      if (tableLeaseReleaseRef.current) {
        releaseTableLease()
      }
      applyCanonicalSnapshot(snapshot, false)
      setStorageReady(true)
      if (
        snapshot.pending &&
        tableLeaseIsSupported() &&
        retryTimer === null
      ) {
        retryTimer = window.setTimeout(restoreOrBootstrap, 900)
      }
    })
    void restoreOrBootstrap()

    return () => {
      stopped = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      unsubscribe()
      tableCoordinator.dispose()
      releaseTableLease()
    }
  }, [initialSession.game, markInitialPointCallComplete, tableCoordinator])

  useEffect(() => {
    casinoAudio.setEnabled(audioEnabled)
  }, [audioEnabled])

  useEffect(() => {
    const monitor = createConnectivityMonitor({
      onChange: ({ status }) => {
        setConnectivityStatus(status)
        if (status === 'online') casinoAudio.retryFailedSamples()
      },
    })
    monitor.start()
    return () => monitor.stop()
  }, [])

  useEffect(() => {
    const handleVisibilityChange = () => {
      void casinoAudio.setPageVisible(!document.hidden)
    }
    void casinoAudio.setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

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
      if (outcomeMotionTimerRef.current !== null) {
        window.clearTimeout(outcomeMotionTimerRef.current)
      }
      if (roundPreludeTimerRef.current !== null) {
        window.clearTimeout(roundPreludeTimerRef.current)
      }
      if (newShoeMotionTimerRef.current !== null) {
        window.clearTimeout(newShoeMotionTimerRef.current)
      }
      const release = tableLeaseReleaseRef.current
      tableLeaseReleaseRef.current = null
      release?.()
    },
    [],
  )

  const tableMotionPhase: TableMotionPhase = cardSweepMotion
    ? 'clearing'
    : settlementPresentation
      ? 'settling'
    : newShoeMotion
      ? 'new-shoe'
    : roundPrelude
      ? 'no-more-bets'
      : roundRequesting
        ? 'no-more-bets'
      : pendingRound
          ? roundReady
            ? 'revealing'
            : 'dealing'
          : 'betting'
  const settledCardState =
    cardSweepMotion?.roundId === settledCurrentRound?.id
      ? 'sweeping'
      : clearedRoundId === settledCurrentRound?.id
        ? 'cleared'
        : 'shown'
  const { heading: settlementProcedureHeading, status: settlementProcedureStatus } =
    settlementPresentationCopy(settlementPresentation?.state ?? null, cardSweepMotion !== null)
  const tableMotionOutcome = outcomeMotion?.winner ?? null
  const ruleTraceResult = pendingRound?.result ?? settledCurrentRound
  const ruleTraceRevealedCount = pendingRound
    ? revealedCount
    : ruleTraceResult
      ? revealOrder(ruleTraceResult).length
      : 0
  const currentShoeRecords = useMemo(
    () => game.history.filter((record) => record.shoeId === game.shoe.id),
    [game.history, game.shoe.id],
  )

  const stats = useMemo(
    () => summarizeShoeRecords(currentShoeRecords),
    [currentShoeRecords],
  )
  const pendingView = useMemo(
    () => derivePendingRoundView(pendingRound, revealedCount),
    [pendingRound, revealedCount],
  )
  const {
    visibleCardIds: visiblePendingCardIds,
    completedCardIds: completedPendingCardIds,
    nextCard: pendingNextCard,
    manualSides: pendingManualSides,
    nextSide: pendingNextSide,
    nextRequiresUser: pendingNextRequiresUser,
    playerTotal: pendingPlayerTotal,
    bankerTotal: pendingBankerTotal,
    displayTotal: revealDisplayTotal,
  } = pendingView
  const guestShoeId = pendingRound
    ? pendingRound.sourceShoeId
    : settlementPresentation && settledCurrentRound
      ? settledCurrentRound.shoeId
      : game.shoe.id
  const guestHandNumber = pendingRound
    ? pendingRound.shoeAfter.handNumber
    : settlementPresentation && settledCurrentRound
      ? settledCurrentRound.handNumber
      : game.shoe.handNumber + 1
  const tableGuests = useMemo(
    () =>
      createShoeTableGuests({
        shoeId: guestShoeId,
        handNumber: guestHandNumber,
      }),
    [guestHandNumber, guestShoeId],
  )
  const publicGuestReveals = useMemo<PublicTableCardReveal[]>(
    () =>
      pendingRound
        ? revealedCards(pendingRound.result, revealedCount).map((card) => ({
            side: revealSideForCard(pendingRound.result, card.id) ?? 'player',
            card,
          }))
        : [],
    [pendingRound, revealedCount],
  )
  const guestRevealReactions = useMemo(
    () =>
      buildTableGuestRevealReactions({
        shoeId: guestShoeId,
        handNumber: guestHandNumber,
        guests: tableGuests,
        publicReveals: publicGuestReveals,
      }),
    [guestHandNumber, guestShoeId, publicGuestReveals, tableGuests],
  )
  const guestSettlementReactions = useMemo(
    () =>
      settlementPresentation && settledCurrentRound
        ? buildTableGuestSettlementReactions({
            shoeId: settledCurrentRound.shoeId,
            handNumber: settledCurrentRound.handNumber,
            guests: tableGuests,
            winner: settledCurrentRound.winner,
            playerPair: settledCurrentRound.playerPair,
            bankerPair: settledCurrentRound.bankerPair,
          })
        : [],
    [settledCurrentRound, settlementPresentation, tableGuests],
  )

  const nextAudioEventId = (label: string) => {
    audioEventSequenceRef.current += 1
    return `${label}:${audioEventSequenceRef.current}`
  }

  const handleAudioToggle = () => {
    const nextEnabled = !audioEnabled
    setAudioEnabled(nextEnabled)
    casinoAudio.setEnabled(nextEnabled)
    if (nextEnabled) {
      void casinoAudio.unlock().then((ready) => {
        if (!ready) {
          setNotice('浏览器暂时无法启用牌桌音效；牌局仍可正常进行。')
        }
      })
    }
  }

  const handleAudioMixChange = (
    channel: CasinoAudioMixChannel,
    level: number,
  ) => {
    setAudioMix(casinoAudio.setMixChannel(channel, level))
  }

  const handleMotionProfileChange = (profile: MotionProfile) => {
    if (!updateMotionProfile(profile)) {
      setNotice('当前浏览器无法保存节奏偏好；本页仍会立即采用新设置。')
    }
  }

  const openSettingsModal = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.focus({ preventScroll: true })
    setSettingsOpen(true)
  }

  const openRulesModal = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.focus({ preventScroll: true })
    setRulesOpen(true)
  }

  const openNewShoeModal = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.focus({ preventScroll: true })
    setNewShoeOpen(true)
  }

  const openResetModal = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.focus({ preventScroll: true })
    setResetOpen(true)
  }

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
    casinoAudio.playCrowd(`${id}:sound`, cheer.tone, cheer.side)
    crowdCheerTimerRef.current = window.setTimeout(() => {
      crowdCheerTimerRef.current = null
      setActiveCrowdCheer((current) => (current?.id === id ? null : current))
    }, scaledMotionDuration(duration, 20))
  }

  useEffect(() => {
    if (
      !pendingRound ||
      !roundReady ||
      flippingCardId ||
      !pendingNextCard ||
      !pendingNextRequiresUser ||
      rulesOpen ||
      settingsOpen ||
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
    settingsOpen,
  ])

  const handleAddBet = (
    target: keyof Bets,
    amount = selectedChip,
    source: 'tap' | 'drag' = 'tap',
  ) => {
    setFormError(null)
    if ((target === 'player' && bets.banker > 0) || (target === 'banker' && bets.player > 0)) {
      setFormError('本模拟桌设置为不可同时下注庄与闲')
      return false
    }

    const candidate = { ...bets, [target]: bets[target] + amount }
    const targetLimit = TABLE_LIMITS[target]
    if (candidate[target] > targetLimit.max) {
      setFormError(
        `${target === 'player' || target === 'banker' ? '庄/闲' : '和/对子'}单项上限为 ${targetLimit.max.toLocaleString('zh-CN')} 分`,
      )
      return false
    }
    if (totalBets(candidate) > game.balance) {
      setFormError('教学分余额不足')
      return false
    }
    setBets(candidate)
    replaceWagerChipLedger(
      appendWagerChip(wagerChipLedgerRef.current, target, amount),
    )
    casinoAudio.playChip(
      nextAudioEventId(`bet:${target}`),
      target === 'player'
        ? 'player'
        : target === 'banker'
          ? 'banker'
          : 'center',
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : CHIP_STACK_IMPACT_MS + (source === 'drag' ? 25 : 0),
    )
    return true
  }

  const handleRemoveLastBet = (target: keyof Bets) => {
    if (isDealing) return false

    const { nextLedger, removedValue } = removeLastWagerChip(
      wagerChipLedgerRef.current,
      target,
    )
    if (removedValue === null || removedValue > bets[target]) return false

    replaceWagerChipLedger(nextLedger)
    setBets((current) => ({
      ...current,
      [target]: Math.max(0, current[target] - removedValue),
    }))
    setFormError(null)
    return true
  }

  const handleRepeat = () => {
    const error = validateBets(game.lastBets, game.balance)
    if (error) {
      setFormError(error)
      return
    }
    setBets({ ...game.lastBets })
    replaceWagerChipLedger(rebuildWagerChipLedger(game.lastBets))
    setFormError(null)
    casinoAudio.playChip(
      nextAudioEventId('repeat-bets'),
      'center',
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : CHIP_STACK_IMPACT_MS,
    )
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
    const current = pendingRoundRef.current
    if (
      current?.id !== roundId ||
      activeDealMotionRef.current ||
      dealQueueRef.current.length > 0
    ) {
      return
    }

    roundReadyRef.current = true
    flipLockRef.current = false
    setRoundReady(true)
    setRevealAnnouncement(roundRevealInstruction(current))

    const nextCard = nextRevealCard(current.result, revealedCountRef.current)
    const nextSide = nextCard
      ? revealSideForCard(current.result, nextCard.id)
      : null
    if (current.playMode === 'fly') {
      casinoAudio.playDealerCall(
        `${current.id}:dealer-call:auto:${revealedCountRef.current}`,
        '飞牌，自动开牌',
      )
    } else if (
      nextSide &&
      manualRevealSides(current.bets, current.playMode).includes(nextSide)
    ) {
      casinoAudio.playDealerCall(
        `${current.id}:dealer-call:open:${revealedCountRef.current}`,
        `${revealSideLabel(nextSide)}请开牌`,
      )
    }
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
    if (side) {
      const reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches
      casinoAudio.playDealStart(
        `${roundId}:deal:${motion.sequence}:start`,
        side,
      )
      casinoAudio.playCardLand(
        `${roundId}:deal:${motion.sequence}:land`,
        side,
        dealMotionDuration(
          dealContactDelayMs(window.innerWidth, reducedMotion),
          effectiveMotionProfile,
        ),
      )
    }

    dealPhaseTimerRef.current = window.setTimeout(
      () => completeDealMotion(motion),
      scaledMotionDuration(motionFallbackMs('dealer'), 30),
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
    }, scaledMotionDuration(70, 20))
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

    // A third card follows a reveal scene, so allow the clean dealer plate to
    // cross-fade before exposing the shoe-lip crop. Opening cards already begin
    // on the clean plate and only need the short queue handoff.
    const plateWarmupMs = dealtCardIdsRef.current.size > 0 ? 180 : 30
    dealGapTimerRef.current = window.setTimeout(() => {
      dealGapTimerRef.current = null
      startNextDealCard(current.id)
    }, plateWarmupMs)
  }

  const releasePendingRound = (releaseLease = true) => {
    cancelInitialPointCall()
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
    if (releaseLease) releaseTableLease()
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
    if (
      !current ||
      current.id !== roundId ||
      !finalizeLockRef.current
    ) {
      return
    }

    const canonical = tableCoordinator.read()
    if (canonical.status !== 'ok') {
      setRevealAnnouncement(
        '无法读取可校验的权威牌桌快照；本局未结算，页面已停止推进。',
      )
      setNotice('持久化读取失败：没有扣除教学分。')
      releasePendingRound()
      return
    }

    tableVersionRef.current = tableVersionOf(canonical.snapshot)
    const canonicalPending = canonical.snapshot.pending
    if (
      !canonicalPending ||
      canonicalPending.id !== current.id ||
      !pendingRoundMatchesGame(canonical.snapshot.game, canonicalPending) ||
      !pendingRoundsMatch(current, canonicalPending)
    ) {
      gameRef.current = canonical.snapshot.game
      setGame(canonical.snapshot.game)
      const alreadySettled = canonical.snapshot.game.history.some(
        (item) => item.id === current.id,
      )
      setNotice(
        alreadySettled
          ? '本局已由另一标签页完成，当前牌桌已同步。'
          : '权威牌桌快照与当前牌局不一致，本局已停止且未扣除教学分。',
      )
      releasePendingRound()
      return
    }

    let transition
    try {
      transition = settleRoundState(
        {
          game: canonical.snapshot.game,
          pending: canonicalPending,
        },
        { roundId: current.id, settledAt: new Date().toISOString() },
      )
    } catch {
      setRevealAnnouncement('权威牌局未满足结算条件，当前页面已停止推进。')
      setNotice('本局未结算，也没有扣除教学分。')
      releasePendingRound()
      return
    }

    const committed = tableCoordinator.commit(
      tableVersionOf(canonical.snapshot),
      transition.state,
      'settle-round',
    )
    if (committed.status !== 'committed') {
      if (committed.status === 'conflict' && committed.current) {
        tableVersionRef.current = tableVersionOf(committed.current)
        gameRef.current = committed.current.game
        setGame(committed.current.game)
      }
      setRevealAnnouncement(
        committed.status === 'conflict'
          ? '牌桌版本已变化；当前页面未重复结算，并已停止推进。'
          : '结算未能耐久写入；当前页面没有推进余额或路单。',
      )
      setNotice(
        committed.status === 'conflict'
          ? '结算 CAS 冲突：已保留权威版本。'
          : '持久化写入失败：本局未结算，刷新可恢复安全进度。',
      )
      releasePendingRound()
      return
    }

    const record = transition.record
    const settlement = record.settlement
    const settlementCheer =
      current.playMode === 'bet'
        ? buildSettlementCheer({
            winner: current.result.winner,
            settlementNet: settlement.net,
            manualSides: manualRevealSides(current.bets, current.playMode),
          })
        : null
    const nextGame = committed.snapshot.game
    const shouldAnimateSettlement =
      current.playMode === 'bet' && settlement.totalStake > 0
    if (shouldAnimateSettlement) {
      setSettlementWagerChipLedger(wagerChipLedgerRef.current)
    } else {
      setSettlementWagerChipLedger(null)
    }
    tableVersionRef.current = tableVersionOf(committed.snapshot)
    gameRef.current = nextGame
    setGame(nextGame)
    setBets({ ...EMPTY_BETS })
    setSelectedChip(100)
    setFormError(null)
    setDetailView(null)
    clearVisualWagers()
    setOutcomeMotion({
      id: current.id,
      winner: current.result.winner,
    })
    if (outcomeMotionTimerRef.current !== null) {
      window.clearTimeout(outcomeMotionTimerRef.current)
    }
    outcomeMotionTimerRef.current = window.setTimeout(
      () => {
        outcomeMotionTimerRef.current = null
        setOutcomeMotion(null)
      },
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 30
        : scaledMotionDuration(OUTCOME_MOTION_MS, 30),
    )
    settlementLockRef.current = true
    if (shouldAnimateSettlement) {
      setSettlementMotion({
        id: current.id,
        net: settlement.net,
        bets: { ...current.bets },
        returns: { ...settlement.breakdown },
        wagerChipLedger: wagerChipLedgerRef.current,
      })
    }
    casinoAudio.playSettlement(
      `${current.id}:settlement`,
      current.result.winner,
      settlement.net,
      current.playMode === 'fly',
    )
    casinoAudio.playDealerCall(
      `${current.id}:dealer-call:result`,
      outcomeLabel(current.result.winner),
    )
    setRevealAnnouncement(
      `本局${outcomeLabel(current.result.winner)}，净输赢${
        settlement.net > 0 ? `正 ${formatNumber(settlement.net)}` : formatNumber(settlement.net)
      } 教学分。`,
    )
    // The durable settle commit precedes every balance, road and animation
    // update. Keep the Web Lock through the final discard-tray sweep.
    releasePendingRound(false)
    const presentationStarted = startSettlementPresentation({
      roundId: current.id,
      cardIds: current.result.dealOrder.map((card) => card.id),
      profile: effectiveMotionProfile,
      awaitDealerSettlement: shouldAnimateSettlement,
      onComplete: () => {
        settlementLockRef.current = false
        setSettlementMotion(null)
        setSettlementWagerChipLedger(null)
        releaseTableLease()
        window.requestAnimationFrame(() => {
          if (!document.querySelector('[role="dialog"]')) {
            document
              .querySelector<HTMLButtonElement>('.bet-zone:not(:disabled)')
              ?.focus({ preventScroll: true })
          }
        })
      },
    })
    if (!presentationStarted) {
      settlementLockRef.current = false
      setSettlementMotion(null)
      setSettlementWagerChipLedger(null)
      releaseTableLease()
      setNotice('牌桌呈现仍在清理中；本局耐久结算已安全完成。')
    }
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
      }, scaledMotionDuration(720, 20))
    }
    if (current.shoeAfter.needsShuffle) {
      setNotice('切牌位置已到达：本局有效，下一局将自动开启新牌靴。')
    }
  }
  useEffect(() => {
    finalizeRoundRef.current = finalizeRound
  })

  const commitRound = (intent: RoundPrelude) => {
    if (
      roundPreludeRef.current?.id !== intent.id ||
      pendingRoundRef.current ||
      settlementLockRef.current
    ) {
      return
    }

    roundPreludeTimerRef.current = null
    roundPreludeRef.current = null
    setRoundPrelude(null)
    try {
      const canonical = tableCoordinator.read()
      const savedPending =
        canonical.status === 'ok' ? canonical.snapshot.pending : null
      if (
        canonical.status !== 'ok' ||
        !savedPending ||
        savedPending.id !== intent.id ||
        savedPending.revealedCount !== 0 ||
        !pendingRoundMatchesGame(canonical.snapshot.game, savedPending) ||
        !pendingRoundsMatch(intent.pending, savedPending)
      ) {
        if (canonical.status === 'ok') {
          tableVersionRef.current = tableVersionOf(canonical.snapshot)
          gameRef.current = canonical.snapshot.game
          setGame(canonical.snapshot.game)
        }
        roundLockRef.current = false
        releaseTableLease()
        setFormError('已锁定牌局的权威快照发生变化，请重新确认下注。')
        setNotice('牌桌已停止在最新耐久版本；没有重复扣除教学分。')
        return
      }

      tableVersionRef.current = tableVersionOf(canonical.snapshot)
      gameRef.current = canonical.snapshot.game
      setGame(canonical.snapshot.game)
      const pending = pendingRoundFromPersisted(savedPending)
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
        openingDealCardIds(pending.result),
        '停止下注。已锁定牌局已安全保存，荷官正在从牌靴依次发出四张底牌…',
      )

      window.requestAnimationFrame(() => {
        document.querySelector('#game-table')?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
          block: 'start',
        })
      })
    } catch {
      roundPreludeRef.current = null
      setRoundPrelude(null)
      roundLockRef.current = false
      releaseTableLease()
      setFormError('牌靴暂时无法完成本局，请开启新牌靴后重试')
    }
  }

  const beginRoundPrelude = (intent: RoundPrelude) => {
    if (
      roundPreludeRef.current?.id !== intent.id ||
      pendingRoundRef.current ||
      settlementLockRef.current ||
      newShoeMotionRef.current
    ) {
      return
    }

    setRoundPrelude(intent)
    setRevealAnnouncement(
      intent.playMode === 'fly'
        ? '飞牌请求已锁定。荷官示意停止下注后开始本局。'
        : '本局筹码已锁定。荷官正在示意停止下注。',
    )
    casinoAudio.playRoundOpen(`${intent.id}:round-open`)
    casinoAudio.playDealerCall(
      `${intent.id}:dealer-call:no-more-bets`,
      '停止下注',
    )

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    roundPreludeTimerRef.current = window.setTimeout(
      () => commitRound(intent),
      reducedMotion
        ? 20
        : scaledMotionDuration(intent.playMode === 'fly' ? 540 : 720, 20),
    )

    window.requestAnimationFrame(() => {
      document.querySelector('#game-table')?.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'start',
      })
    })
  }

  const completeNewShoeMotion = (motion: NewShoeMotion) => {
    if (newShoeMotionRef.current?.id !== motion.id) return

    newShoeMotionTimerRef.current = null
    newShoeMotionRef.current = null
    const canonical = tableCoordinator.read()
    setNewShoeMotion(null)

    if (canonical.status !== 'ok') {
      roundPreludeRef.current = null
      roundLockRef.current = false
      releaseTableLease()
      setFormError('无法读取新牌靴的权威快照，牌桌已停止推进。')
      setRevealAnnouncement('新牌靴动画已结束，但页面未推进任何未校验状态。')
      return
    }

    tableVersionRef.current = tableVersionOf(canonical.snapshot)
    gameRef.current = canonical.snapshot.game
    setGame(canonical.snapshot.game)

    if (motion.mode === 'automatic' && motion.roundIntent) {
      const canonicalPending = canonical.snapshot.pending
      const automaticSnapshotIsIntact =
        canonical.snapshot.game.shoe.id === motion.shoe.id &&
        canonical.snapshot.game.shoe.cursor === motion.shoe.cursor &&
        canonicalPending !== null &&
        canonicalPending.id === motion.roundIntent.id &&
        canonicalPending.revealedCount === 0 &&
        pendingRoundMatchesGame(canonical.snapshot.game, canonicalPending) &&
        pendingRoundsMatch(motion.roundIntent.pending, canonicalPending)

      if (!automaticSnapshotIsIntact) {
        roundPreludeRef.current = null
        roundLockRef.current = false
        releaseTableLease()
        setFormError('自动换靴后的权威牌局快照不完整，本局没有开始。')
        setRevealAnnouncement(
          '新牌靴快照校验失败；页面没有推进余额或牌面。',
        )
        setNotice('自动换靴后的牌局已安全停止。')
        return
      }

      setNotice(
        `已自动装入新牌靴 ${motion.shoe.id.slice(-8)}，现在停止下注。`,
      )
      beginRoundPrelude(motion.roundIntent)
      return
    }

    if (
      canonical.snapshot.pending !== null ||
      canonical.snapshot.game.shoe.id !== motion.shoe.id ||
      canonical.snapshot.game.shoe.cursor !== motion.shoe.cursor
    ) {
      roundPreludeRef.current = null
      roundLockRef.current = false
      releaseTableLease()
      setFormError('另一标签页已更新牌桌，新牌靴展示已安全停止。')
      setNotice('牌桌已同步到最新权威版本。')
      return
    }

    roundLockRef.current = false
    releaseTableLease()
    setBets({ ...EMPTY_BETS })
    clearVisualWagers()
    setRevealAnnouncement('新牌靴已完成装牌与烧牌，请选择下注对象与筹码。')
    setNotice(`已手动开启新牌靴 ${motion.shoe.id.slice(-8)}；既有记录仍保留。`)
  }

  const beginNewShoeMotion = (
    mode: NewShoeMotion['mode'],
    roundIntent: RoundPrelude | null,
    preparedShoe?: ShoeState,
  ) => {
    if (newShoeMotionRef.current) return

    const motion: NewShoeMotion = {
      id: `new-shoe-${createRoundId()}`,
      mode,
      shoe: preparedShoe ?? createShoe(),
      roundIntent,
    }
    newShoeMotionRef.current = motion
    setNewShoeMotion(motion)
    setRevealAnnouncement(
      mode === 'automatic'
        ? '切牌位已到达。荷官正在装入新牌、压实牌靴并烧牌。'
        : '荷官正在装入新牌、压实牌靴，并按指示牌点数完成烧牌。',
    )
    casinoAudio.playNewShoe(`${motion.id}:sound`)
    casinoAudio.playDealerCall(`${motion.id}:dealer-call`, '更换牌靴')

    newShoeMotionTimerRef.current = window.setTimeout(
      () => completeNewShoeMotion(motion),
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 20
        : scaledMotionDuration(NEW_SHOE_MOTION_MS, 20),
    )
  }

  const requestRound = async (roundBets: Bets, playMode: PlayMode) => {
    if (
      roundLockRef.current ||
      settlementLockRef.current ||
      pendingRoundRef.current ||
      roundPreludeRef.current ||
      newShoeMotionRef.current
    ) {
      return
    }

    roundLockRef.current = true
    setRoundRequesting(true)
    setFormError(null)
    setRevealAnnouncement(
      playMode === 'fly'
        ? '停止下注。正在取得飞牌牌局的独占控制权…'
        : '停止下注。正在取得牌桌独占控制权并锁定本局筹码…',
    )
    if (audioEnabled) void casinoAudio.unlock()
    try {
      const leaseAcquired = await acquireTableLease()
    if (!leaseAcquired) {
      roundLockRef.current = false
      setFormError(tableLeaseUnavailableMessage('开始本局'))
      return
    }
    if (
      settlementLockRef.current ||
      pendingRoundRef.current ||
      roundPreludeRef.current ||
      newShoeMotionRef.current
    ) {
      roundLockRef.current = false
      releaseTableLease()
      return
    }

    const canonical = tableCoordinator.read()
    if (canonical.status !== 'ok') {
      roundLockRef.current = false
      releaseTableLease()
      setFormError('无法读取可校验的权威牌桌快照，本局没有开始。')
      return
    }

    const canonicalVersion = tableVersionOf(canonical.snapshot)
    const knownVersion = tableVersionRef.current
    if (
      canonical.snapshot.pending ||
      (knownVersion !== null &&
        (knownVersion.revision !== canonicalVersion.revision ||
          knownVersion.commitId !== canonicalVersion.commitId))
    ) {
      tableVersionRef.current = canonicalVersion
      gameRef.current = canonical.snapshot.game
      setGame(canonical.snapshot.game)
      roundLockRef.current = false
      releaseTableLease()
      setFormError(
        canonical.snapshot.pending
          ? '另一标签页正在进行牌局，请完成后再试。'
          : '牌桌已推进到新版本，请在最新牌面上重新确认下注。',
      )
      return
    }

    const canonicalBetError =
      playMode === 'bet'
        ? validateBets(roundBets, canonical.snapshot.game.balance)
        : null
    if (canonicalBetError) {
      tableVersionRef.current = canonicalVersion
      gameRef.current = canonical.snapshot.game
      setGame(canonical.snapshot.game)
      roundLockRef.current = false
      releaseTableLease()
      setFormError(canonicalBetError)
      return
    }

    let automaticShoe: ShoeState | null = null
    let preparedState: TableCoreState = {
      game: canonical.snapshot.game,
      pending: canonical.snapshot.pending,
    }
    try {
      if (preparedState.game.shoe.needsShuffle) {
        automaticShoe = createShoe()
        preparedState = replaceShoeState(preparedState, {
          shoe: automaticShoe,
        })
      }
      preparedState = prepareRoundState(preparedState, {
        bets: roundBets,
        playMode,
        roundId: createRoundId(),
      })
    } catch {
      roundLockRef.current = false
      releaseTableLease()
      setFormError('牌靴无法完成本局，请更换牌靴后重试。')
      return
    }

    const committed = tableCoordinator.commit(
      canonicalVersion,
      preparedState,
      'prepare-round',
    )
    if (committed.status !== 'committed' || !committed.snapshot.pending) {
      if (committed.status === 'conflict' && committed.current) {
        tableVersionRef.current = tableVersionOf(committed.current)
        gameRef.current = committed.current.game
        setGame(committed.current.game)
      }
      roundLockRef.current = false
      releaseTableLease()
      setFormError(
        committed.status === 'conflict'
          ? '另一标签页已推进牌桌，请在最新版本上重新确认下注。'
          : '浏览器无法耐久锁定本局；为避免重抽或重复结算，本局没有开始。',
      )
      return
    }

    tableVersionRef.current = tableVersionOf(committed.snapshot)
    gameRef.current = committed.snapshot.game
    setGame(committed.snapshot.game)
    const pending = pendingRoundFromPersisted(committed.snapshot.pending)
    const intent: RoundPrelude = {
      id: pending.id,
      bets: { ...roundBets },
      playMode,
      pending,
    }
    roundPreludeRef.current = intent
    clearCrowdCheer()
      if (automaticShoe) {
        beginNewShoeMotion('automatic', intent, automaticShoe)
      } else {
        beginRoundPrelude(intent)
      }
    } finally {
      setRoundRequesting(false)
      if (
        !roundLockRef.current &&
        !pendingRoundRef.current &&
        !roundPreludeRef.current &&
        !newShoeMotionRef.current
      ) {
        setRevealAnnouncement('牌局未开始；请查看下注区提示后重试。')
      }
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
    const canonical = tableCoordinator.read()
    if (
      canonical.status !== 'ok' ||
      !canonical.snapshot.pending ||
      canonical.snapshot.pending.id !== current.id ||
      canonical.snapshot.pending.revealedCount !== currentCount ||
      !pendingRoundsMatch(current, canonical.snapshot.pending)
    ) {
      flippingCardRef.current = null
      revealActorRef.current = null
      setFlippingCardId(null)
      setRevealActor(null)
      if (canonical.status !== 'ok') {
        flipLockRef.current = false
        roundReadyRef.current = true
        setRoundReady(true)
        setRevealAnnouncement(
          '无法读取权威快照，牌面没有推进；存储恢复后可重试本张。',
        )
        setNotice('持久化读取失败：已保留上一个安全进度。')
        return
      }

      tableVersionRef.current = tableVersionOf(canonical.snapshot)
      gameRef.current = canonical.snapshot.game
      setGame(canonical.snapshot.game)
      setRevealAnnouncement(
        '当前牌面与权威快照不一致；为避免重复翻牌或结算，页面已停止该局。',
      )
      setNotice('牌局版本发生冲突，未扣除教学分。刷新后可读取最新安全进度。')
      releasePendingRound()
      return
    }

    let advancedState
    try {
      advancedState = advanceRevealState(
        {
          game: canonical.snapshot.game,
          pending: canonical.snapshot.pending,
        },
        { roundId, nextRevealedCount: nextCount },
      )
    } catch {
      flippingCardRef.current = null
      revealActorRef.current = null
      setFlippingCardId(null)
      setRevealActor(null)
      setRevealAnnouncement('翻牌顺序校验失败，牌面没有推进。')
      setNotice('已保留最后一个耐久进度。')
      return
    }

    const committed = tableCoordinator.commit(
      tableVersionOf(canonical.snapshot),
      advancedState,
      'reveal-card',
    )
    if (committed.status !== 'committed' || !committed.snapshot.pending) {
      flippingCardRef.current = null
      revealActorRef.current = null
      setFlippingCardId(null)
      setRevealActor(null)
      if (committed.status === 'conflict') {
        if (committed.current) {
          tableVersionRef.current = tableVersionOf(committed.current)
          gameRef.current = committed.current.game
          setGame(committed.current.game)
        }
        setRevealAnnouncement('翻牌 CAS 冲突，当前页面已停止推进。')
        setNotice('没有重复翻牌或结算；请刷新读取权威进度。')
        releasePendingRound()
      } else {
        flipLockRef.current = false
        roundReadyRef.current = true
        setRoundReady(true)
        setRevealAnnouncement(
          '本张翻牌未能耐久写入，牌面没有推进；请重试本张。',
        )
        setNotice('持久化写入失败：已保留上一个安全进度。')
      }
      return
    }

    tableVersionRef.current = tableVersionOf(committed.snapshot)
    gameRef.current = committed.snapshot.game
    pendingRoundRef.current = pendingRoundFromPersisted(
      committed.snapshot.pending,
    )
    setGame(committed.snapshot.game)
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
    casinoAudio.playRevealComplete(
      `${current.id}:reveal:${expectedCard.id}:complete`,
      revealedSide,
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

    const continueDealerProcedure = () => {
      if (
        pendingRoundRef.current?.id !== current.id ||
        revealedCountRef.current !== nextCount
      ) {
        return
      }
      if (revealIsComplete(current.result, nextCount)) {
        finalizeLockRef.current = true
        settleTimerRef.current = window.setTimeout(
          () => finalizeRoundRef.current(roundId),
          scaledMotionDuration(260, 20),
        )
        return
      }

      const newlyVisibleCards = newlyVisibleUndealtCardIds(
        visibleRevealCardIds(current.result, currentCount),
        visibleRevealCardIds(current.result, nextCount),
        [...dealtCardIdsRef.current],
      )
      if (newlyVisibleCards.length > 0) {
        casinoAudio.playRoundOpen(`${current.id}:third-card-cue`)
        casinoAudio.playDealerCall(
          `${current.id}:dealer-call:third-card:${nextCount}`,
          '补牌',
        )
        startDealSequence(
          current,
          newlyVisibleCards,
          '荷官正在补发第三张牌，牌落桌后再继续开牌…',
        )
        return
      }
      flipLockRef.current = false
    }

    if (nextCount === 4) {
      const playerOpeningTotal = handTotal(current.result.playerCards.slice(0, 2))
      const bankerOpeningTotal = handTotal(current.result.bankerCards.slice(0, 2))
      const naturalCall = current.result.natural ? '，天然牌' : ''
      const pointCall = `闲家 ${playerOpeningTotal} 点，庄家 ${bankerOpeningTotal} 点${naturalCall}`
      setRevealAnnouncement(`荷官宣读开局点数：${pointCall}。`)
      casinoAudio.playDealerCall(
        `${current.id}:dealer-call:initial-points`,
        pointCall,
      )
      beginInitialPointCall({
        roundId: current.id,
        profile: effectiveMotionProfile,
        onComplete: continueDealerProcedure,
      })
      return
    }

    continueDealerProcedure()
  }

  const beginRevealCard = (
    cardId: string,
    actor: RevealActor,
    inputMethod?: RevealInputMethod,
  ) => {
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
    if (!(actor === 'user' && inputMethod === 'pointer')) {
      casinoAudio.playRevealStart(
        `${current.id}:reveal:${cardId}:start`,
        expectedSide,
        actor === 'dealer',
      )
    }
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
        scaledMotionDuration(motionFallbackMs(actor), 30),
      )
    }
  }

  useEffect(() => {
    beginRevealCardRef.current = beginRevealCard
  })

  const handleRevealCard = (
    cardId: string,
    inputMethod: RevealInputMethod,
  ) => {
    beginRevealCard(cardId, 'user', inputMethod)
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
      settingsOpen ||
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
    const attemptAutomaticReveal = () => {
      const current = pendingRoundRef.current
      const expected = current
        ? nextRevealCard(current.result, revealedCountRef.current)
        : null
      if (current?.id !== roundId || expected?.id !== cardId) {
        autoFlipTimerRef.current = null
        return
      }
      if (
        !roundReadyRef.current ||
        flipLockRef.current ||
        !dealtCardIdsRef.current.has(cardId)
      ) {
        autoFlipTimerRef.current = window.setTimeout(attemptAutomaticReveal, 40)
        return
      }
      autoFlipTimerRef.current = null
      beginRevealCardRef.current(cardId, 'dealer')
    }
    autoFlipTimerRef.current = window.setTimeout(
      attemptAutomaticReveal,
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 20
        : scaledMotionDuration(420, 20),
    )

    return () => {
      if (autoFlipTimerRef.current !== null) {
        window.clearTimeout(autoFlipTimerRef.current)
        autoFlipTimerRef.current = null
      }
    }
  }, [
    dealtCardIds,
    flippingCardId,
    initialPointsAnnouncedRoundId,
    newShoeOpen,
    pendingNextCard,
    pendingNextRequiresUser,
    pendingRound,
    resetOpen,
    roadFullscreen,
    roundReady,
    rulesOpen,
    scaledMotionDuration,
    settingsOpen,
  ])

  const handleDeal = () => {
    const error = validateBets(bets, game.balance)
    if (error) {
      setFormError(error)
      return
    }

    requestRound({ ...bets }, 'bet')
  }

  const handleFly = () => {
    if (totalBets(bets) > 0) {
      setFormError('飞牌只用于无下注对局，请先清空本局筹码')
      return
    }

    requestRound({ ...EMPTY_BETS }, 'fly')
  }

  const replaceShoe = async () => {
    if (
      roundLockRef.current ||
      pendingRoundRef.current ||
      roundPreludeRef.current ||
      newShoeMotionRef.current ||
      settlementLockRef.current
    ) {
      return
    }
    clearCrowdCheer()
    setNewShoeOpen(false)
    roundLockRef.current = true
    if (audioEnabled) void casinoAudio.unlock()
    setFormError(null)
    const leaseAcquired = await acquireTableLease()
    if (!leaseAcquired) {
      roundLockRef.current = false
      setFormError(tableLeaseUnavailableMessage('更换牌靴'))
      return
    }
    if (
      pendingRoundRef.current ||
      roundPreludeRef.current ||
      newShoeMotionRef.current ||
      settlementLockRef.current
    ) {
      roundLockRef.current = false
      releaseTableLease()
      return
    }
    const canonical = tableCoordinator.read()
    if (canonical.status !== 'ok' || canonical.snapshot.pending) {
      if (canonical.status === 'ok') {
        tableVersionRef.current = tableVersionOf(canonical.snapshot)
        gameRef.current = canonical.snapshot.game
        setGame(canonical.snapshot.game)
      }
      roundLockRef.current = false
      releaseTableLease()
      setFormError(
        canonical.status === 'ok'
          ? '权威牌桌仍有未完成牌局，无法更换牌靴。'
          : '无法读取权威牌桌快照，未更换牌靴。',
      )
      return
    }

    const preparedShoe = createShoe()
    let nextState
    try {
      nextState = replaceShoeState(
        { game: canonical.snapshot.game, pending: null },
        { shoe: preparedShoe },
      )
    } catch {
      roundLockRef.current = false
      releaseTableLease()
      setFormError('新牌靴校验失败，原牌靴保持不变。')
      return
    }
    const committed = tableCoordinator.commit(
      tableVersionOf(canonical.snapshot),
      nextState,
      'replace-shoe',
    )
    if (committed.status !== 'committed') {
      if (committed.status === 'conflict' && committed.current) {
        tableVersionRef.current = tableVersionOf(committed.current)
        gameRef.current = committed.current.game
        setGame(committed.current.game)
      }
      roundLockRef.current = false
      releaseTableLease()
      setFormError(
        committed.status === 'conflict'
          ? '另一标签页已推进牌桌，新牌靴操作已取消。'
          : '新牌靴未能耐久写入，原牌靴保持不变。',
      )
      return
    }

    tableVersionRef.current = tableVersionOf(committed.snapshot)
    gameRef.current = committed.snapshot.game
    setGame(committed.snapshot.game)
    beginNewShoeMotion('manual', null, preparedShoe)
  }

  const resetSimulation = async () => {
    if (
      roundLockRef.current ||
      pendingRoundRef.current ||
      roundPreludeRef.current ||
      newShoeMotionRef.current ||
      settlementLockRef.current
    ) {
      return
    }
    roundLockRef.current = true
    const leaseAcquired = await acquireTableLease()
    if (!leaseAcquired) {
      roundLockRef.current = false
      setResetOpen(false)
      setFormError(tableLeaseUnavailableMessage('重置'))
      return
    }
    if (
      pendingRoundRef.current ||
      roundPreludeRef.current ||
      newShoeMotionRef.current ||
      settlementLockRef.current
    ) {
      roundLockRef.current = false
      releaseTableLease()
      return
    }
    const canonical = tableCoordinator.read()
    if (canonical.status !== 'ok' || canonical.snapshot.pending) {
      if (canonical.status === 'ok') {
        tableVersionRef.current = tableVersionOf(canonical.snapshot)
        gameRef.current = canonical.snapshot.game
        setGame(canonical.snapshot.game)
      }
      roundLockRef.current = false
      releaseTableLease()
      setResetOpen(false)
      setFormError(
        canonical.status === 'ok'
          ? '权威牌桌仍有未完成牌局，无法重置。'
          : '无法读取权威牌桌快照，未重置任何数据。',
      )
      return
    }

    let resetState
    try {
      resetState = resetTableState(
        { game: canonical.snapshot.game, pending: null },
        {
          shoe: createShoe(),
          balance: STARTING_BALANCE,
          sessionStartedAt: new Date().toISOString(),
        },
      )
    } catch {
      roundLockRef.current = false
      releaseTableLease()
      setResetOpen(false)
      setFormError('重置快照未通过校验，原数据保持不变。')
      return
    }
    const committed = tableCoordinator.commit(
      tableVersionOf(canonical.snapshot),
      resetState,
      'reset',
    )
    if (committed.status !== 'committed') {
      if (committed.status === 'conflict' && committed.current) {
        tableVersionRef.current = tableVersionOf(committed.current)
        gameRef.current = committed.current.game
        setGame(committed.current.game)
      }
      roundLockRef.current = false
      releaseTableLease()
      setResetOpen(false)
      setFormError(
        committed.status === 'conflict'
          ? '另一标签页已推进牌桌，请确认最新进度后再重置。'
          : '重置未能耐久写入，原数据保持不变。',
      )
      return
    }

    clearCrowdCheer()
    const nextGame = committed.snapshot.game
    tableVersionRef.current = tableVersionOf(committed.snapshot)
    gameRef.current = nextGame
    setGame(nextGame)
    setBets({ ...EMPTY_BETS })
    setSelectedChip(100)
    clearVisualWagers()
    setResetOpen(false)
    setDetailView(null)
    setFormError(null)
    setRevealAnnouncement('请先选择下注对象与筹码，然后确认开牌。')
    setNotice('牌桌与教学分已重置；排行榜历史最高保留。')
    roundLockRef.current = false
    releaseTableLease()
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
    <div
      className="app-shell is-minimal-table"
      data-motion-profile={effectiveMotionProfile}
    >
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
          <button onClick={() => openDetailView('lab')}>概率实验</button>
          <button onClick={openRulesModal}>规则与来源</button>
        </nav>

        <div className="topbar-status">
          <span className="simulation-badge">
            <i />
            纯模拟 · 无真钱
          </span>
          {connectivityStatus !== 'online' && (
            <span className="simulation-badge" role="status" aria-live="polite">
              <CircleAlert size={14} aria-hidden="true" />
              {connectivityStatus === 'offline'
                ? '网络离线 · 每 10 分钟重试'
                : '正在验证网络连接'}
            </span>
          )}
          <button
            className="outline-button"
            onClick={openNewShoeModal}
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
                  currentShoeRecords.slice(-12).map((record, index, records) => (
                    <i
                      key={record.id}
                      className={`mini-result mini-result-${record.winner} ${
                        index === records.length - 1 ? 'is-latest' : ''
                      }`}
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
              ref={tableStageRef}
              className={`table-stage casino-table-stage ${
                pendingRound ? 'is-revealing' : ''
              } ${pendingRound && !roundReady ? 'is-dealing-cards' : ''} ${
                activeDealMotion ? 'is-dealing-card' : ''
              } ${roundRequesting || isLockingBets ? 'is-locking-bets' : ''} ${
                settlementPresentation ? 'is-settling-table' : ''
              } ${cardSweepMotion ? 'is-clearing-cards' : ''
              } ${newShoeMotion ? 'is-new-shoe' : ''} ${
                flippingCardId && revealActor === 'dealer'
                  ? 'is-dealer-revealing'
                  : ''
              }`}
              data-table-phase={tableMotionPhase}
              data-round-ready={roundReady}
              data-flip-locked={flipLockRef.current}
              data-dealt-card-count={dealtCardIds.size}
              data-pending-next-card-id={pendingNextCard?.id}
            >
              <div className="felt-pattern" />
              <div className="motion-asset-preload" aria-hidden="true">
                {MOTION_ASSET_URLS.map((src) => (
                  <img key={src} src={src} alt="" decoding="async" />
                ))}
              </div>
              <div className="dealer-idle-breath" aria-hidden="true" />
              <div className="dealer-idle-arm-plate" aria-hidden="true" />
              <div className="casino-scene-vignette" aria-hidden="true" />
              <TableMotionAtmosphere
                phase={tableMotionPhase}
                outcome={tableMotionOutcome}
                motionId={outcomeMotion?.id ?? null}
              />
              <div
                className="dealer-shoe-motion-anchor"
                data-dealer-shoe-anchor
                aria-hidden="true"
              />
              <div
                className="dealer-shoe-foreground-occlusion"
                data-dealer-shoe-occlusion
                aria-hidden="true"
              />
              <DealerArmBridge
                key={
                  activeDealMotion?.sequence ??
                  (flippingCardId && revealActor === 'dealer'
                    ? `reveal-${flippingCardId}`
                    : 'dealer-idle')
                }
                motion={activeDealMotion}
                revealCardId={
                  flippingCardId && revealActor === 'dealer'
                    ? flippingCardId
                    : null
                }
                stageRef={tableStageRef}
              />
              <DealerNewShoeAction
                shoe={newShoeMotion?.shoe ?? null}
                mode={newShoeMotion?.mode ?? 'manual'}
              />
              <DealerTableAction
                key={settlementMotion?.id ?? 'dealer-settlement-idle'}
                motion={settlementMotion}
                stageRef={tableStageRef}
                motionProfile={effectiveMotionProfile}
                onStepChange={handleDealerSettlementStep}
                onComplete={handleDealerSettlementComplete}
              />
              <DealerCardSweepAction
                motion={cardSweepMotion}
                stageRef={tableStageRef}
              />
              <div className="table-corner-controls">
                <button
                  type="button"
                  className={`table-audio-toggle ${
                    audioEnabled ? 'is-enabled' : ''
                  }`}
                  onClick={handleAudioToggle}
                  aria-pressed={audioEnabled}
                  aria-label={
                    audioEnabled ? '关闭牌桌空间音效' : '开启牌桌空间音效'
                  }
                >
                  {audioEnabled ? (
                    <Volume2 size={16} aria-hidden="true" />
                  ) : (
                    <VolumeX size={16} aria-hidden="true" />
                  )}
                  <span>现场音效</span>
                  <strong>{audioEnabled ? '开' : '关'}</strong>
                </button>
                <button
                  type="button"
                  className="table-new-shoe-toggle"
                  onClick={openNewShoeModal}
                  disabled={isDealing}
                  aria-label="手动开启新牌靴"
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  <span>新牌靴</span>
                </button>
                <button
                  type="button"
                  className="table-settings-toggle"
                  onClick={openSettingsModal}
                  aria-label="打开体验设置"
                >
                  <Settings2 size={15} aria-hidden="true" />
                  <span>体验设置</span>
                </button>
                <button
                  type="button"
                  className="table-reset-toggle"
                  onClick={openResetModal}
                  disabled={isDealing}
                  aria-label="重置模拟"
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  <span>重置模拟</span>
                </button>
                <div className="table-simulation-corner">
                  <span aria-hidden="true">九</span>
                  <strong>纯模拟 · 无真钱</strong>
                </div>
              </div>

              <TableDealerHeader
                settlementHeading={settlementProcedureHeading}
                settlementStatus={settlementProcedureStatus}
                newShoeMotion={newShoeMotion}
                roundRequesting={roundRequesting}
                roundPrelude={roundPrelude}
                pendingRound={pendingRound}
                roundReady={roundReady}
                flippingCardId={flippingCardId}
                revealActor={revealActor}
                pendingNextRequiresUser={pendingNextRequiresUser}
                pendingNextSide={pendingNextSide}
                settledRound={settledCurrentRound}
                pendingManualSides={pendingManualSides}
                revealedCount={revealedCount}
                revealDisplayTotal={revealDisplayTotal}
                records={currentShoeRecords}
              />

              {settlementPresentation && settledCurrentRound ? (
                <TableGuests
                  guests={tableGuests}
                  phase="settled"
                  settlementReactions={guestSettlementReactions}
                />
              ) : pendingRound ? (
                <TableGuests
                  guests={tableGuests}
                  phase="revealing"
                  activeReaction={guestRevealReactions.at(-1) ?? null}
                />
              ) : (
                <TableGuests guests={tableGuests} phase="betting" />
              )}

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
                  settledCardState={settledCardState}
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
                  settledCardState={settledCardState}
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
                {settlementProcedureHeading
                  ? `荷官：${settlementProcedureHeading}`
                  : revealAnnouncement}
              </p>

              <TableDealerProcedure
                pendingRound={pendingRound} roundPrelude={roundPrelude}
                settledRound={settledCurrentRound}
                settlementPresentation={settlementPresentation}
                revealedCount={revealedCount} dealtCardIds={dealtCardIds}
                roundReady={roundReady} roundRequesting={roundRequesting}
                initialPointsAnnouncedRoundId={initialPointsAnnouncedRoundId}
                settlementActions={
                  settlementPresentation ? settlementActions : undefined
                }
              />

              <BettingPanel
                bets={displayedBets}
                wagerChipLedger={displayedWagerChipLedger}
                balance={game.balance}
                selectedChip={selectedChip}
                isDealing={isDealing}
                isSettling={settlementPresentation !== null}
                dealingMode={dealingMode}
                error={formError}
                hasLastBets={totalBets(game.lastBets) > 0}
                onSelectChip={setSelectedChip}
                onAddBet={handleAddBet}
                onRemoveLastBet={handleRemoveLastBet}
                onClear={() => {
                  setBets({ ...EMPTY_BETS })
                  clearVisualWagers()
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

        {ruleTraceResult && (
          <RoundRuleTrace
            result={ruleTraceResult}
            revealedCount={ruleTraceRevealedCount}
          />
        )}

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
          <TableDetailActions
            detailView={detailView}
            onChange={setDetailView}
            onOpenRules={openRulesModal}
          />
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

        {detailView === 'lab' && <ProbabilityLab />}

        <LeaderboardPanel
          active={detailView === 'leaderboard'}
          currentBalance={game.balance}
          recordedHighestBalance={recordedLeaderboardHigh}
          scoreEventId={game.history.at(-1)?.id ?? null}
        />

        <section className="simulator-disclosure">
          <ShieldCheck size={20} />
          <p>
            八副牌经 Web Crypto 洗牌，并按公开监管补牌规则逐张发出。教学分不可购买、兑换或提现；
            视觉场景为原创模拟环境，与任何实体娱乐场无关。匿名昵称与历史最高会尝试自报至公开的未验证模拟榜。
          </p>
          <button onClick={openRulesModal}>查看公开依据</button>
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
          <button onClick={openRulesModal}>规则与来源</button>
          <button onClick={openResetModal} disabled={isDealing}>
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

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />

      <ExperienceSettingsModal
        open={settingsOpen}
        audioEnabled={audioEnabled}
        audioMix={audioMix}
        motionProfile={motionProfile}
        effectiveMotionProfile={effectiveMotionProfile}
        disabled={isDealing}
        onAudioMixChange={handleAudioMixChange}
        onMotionProfileChange={handleMotionProfileChange}
        onClose={() => setSettingsOpen(false)}
      />

      <TableMaintenanceModals
        resetOpen={resetOpen}
        newShoeOpen={newShoeOpen}
        cardsRemaining={cardsRemaining(game.shoe)}
        onCloseReset={() => setResetOpen(false)}
        onConfirmReset={resetSimulation}
        onCloseNewShoe={() => setNewShoeOpen(false)}
        onConfirmNewShoe={replaceShoe}
      />
    </div>
  )
}

export default App
