import { useEffect, useMemo, useState } from 'react'
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
import { PlayingCard } from './components/PlayingCard'
import { RoadBoard } from './components/RoadBoard'
import {
  EMPTY_BETS,
  HOUSE_EDGES,
  RULESET_VERSION,
  THEORETICAL_PROBABILITIES,
  cardsRemaining,
  createShoe,
  dealRound,
  settleBets,
  totalBets,
  validateBets,
} from './game/baccarat'
import {
  clearGameState,
  downloadTextFile,
  historyToCsv,
  loadGameState,
  saveGameState,
} from './game/storage'
import { isFlyRound } from './game/records'
import type {
  Bets,
  PersistedGameState,
  PlayMode,
  RoundRecord,
  ShoeState,
  Winner,
} from './types'
import './styles.css'

const STARTING_BALANCE = 10_000

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

function App() {
  const [game, setGame] = useState<PersistedGameState>(() => loadGameState() ?? makeInitialState())
  const [bets, setBets] = useState<Bets>({ ...EMPTY_BETS })
  const [selectedChip, setSelectedChip] = useState(100)
  const [isDealing, setIsDealing] = useState(false)
  const [dealingMode, setDealingMode] = useState<PlayMode | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [newShoeOpen, setNewShoeOpen] = useState(false)
  const [roadFullscreen, setRoadFullscreen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

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

  const latestRound = game.history[game.history.length - 1] ?? null
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

  const commitRound = (
    activeShoe: ShoeState,
    balanceBefore: number,
    roundBets: Bets,
    playMode: PlayMode,
  ) => {
    const { shoe, result } = dealRound(activeShoe)
    const settlement = settleBets(roundBets, result)
    const balanceAfter = balanceBefore - settlement.totalStake + settlement.totalReturned
    const record: RoundRecord = {
      ...result,
      id: createRoundId(),
      shoeId: shoe.id,
      handNumber: shoe.handNumber,
      timestamp: new Date().toISOString(),
      playMode,
      bets: { ...roundBets },
      settlement,
      balanceBefore,
      balanceAfter,
      cardsRemaining: cardsRemaining(shoe),
      rulesetVersion: RULESET_VERSION,
      shuffleVersion: shoe.shuffleVersion,
    }

    setGame((previous) => ({
      ...previous,
      balance: balanceAfter,
      shoe,
      history: [...previous.history, record].slice(-500),
      lastBets: settlement.totalStake > 0 ? { ...roundBets } : previous.lastBets,
    }))
    setBets({ ...EMPTY_BETS })
    setIsDealing(false)
    setDealingMode(null)
    if (shoe.needsShuffle) {
      setNotice('切牌位置已到达：本局有效，下一局将自动开启新牌靴。')
    }
  }

  const startRound = (roundBets: Bets, playMode: PlayMode) => {
    if (isDealing) return
    setFormError(null)
    setDealingMode(playMode)
    setIsDealing(true)
    const activeShoe = game.shoe.needsShuffle ? createShoe() : game.shoe
    if (game.shoe.needsShuffle) {
      setGame((previous) => ({ ...previous, shoe: activeShoe }))
      setNotice(`已自动开启新牌靴 ${activeShoe.id.slice(-8)}。`)
    }

    const balanceBefore = game.balance
    window.setTimeout(
      () => commitRound(activeShoe, balanceBefore, roundBets, playMode),
      620,
    )
  }

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
    const shoe = createShoe()
    setGame((previous) => ({ ...previous, shoe }))
    setBets({ ...EMPTY_BETS })
    setNewShoeOpen(false)
    setNotice(`已手动开启新牌靴 ${shoe.id.slice(-8)}；既有记录仍保留。`)
  }

  const resetSimulation = () => {
    clearGameState()
    setGame(makeInitialState())
    setBets({ ...EMPTY_BETS })
    setResetOpen(false)
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
            <section className={`table-stage ${isDealing ? 'is-dealing' : ''}`} aria-live="polite">
              <div className="felt-pattern" />
              <div className="table-stage-heading">
                <div>
                  <p className="eyebrow">CURRENT HAND · 当前局</p>
                  <h2>
                    {isDealing
                      ? dealingMode === 'fly'
                        ? '正在飞牌'
                        : '正在发牌'
                      : latestRound && latestRound.shoeId === game.shoe.id
                        ? outcomeLabel(latestRound.winner)
                        : '等待开牌'}
                  </h2>
                </div>
                {latestRound && latestRound.shoeId === game.shoe.id && !isDealing && (
                  <div
                    className={`round-net ${
                      isFlyRound(latestRound)
                        ? 'fly'
                        : latestRound.settlement.net >= 0
                          ? 'positive'
                          : 'negative'
                    }`}
                  >
                    <span>{isFlyRound(latestRound) ? '本局模式' : '本局净输赢'}</span>
                    <strong>
                      {isFlyRound(latestRound)
                        ? '飞牌 · 无下注'
                        : `${latestRound.settlement.net > 0 ? '+' : ''}${formatNumber(
                            latestRound.settlement.net,
                          )}`}
                    </strong>
                  </div>
                )}
              </div>

              <div className="hands-layout">
                <div className="hand hand-player">
                  <div className="hand-label">
                    <span>
                      闲 <small>PLAYER</small>
                    </span>
                    <strong>
                      {latestRound && latestRound.shoeId === game.shoe.id && !isDealing
                        ? latestRound.playerTotal
                        : '—'}
                      <small> 点</small>
                    </strong>
                  </div>
                  <div className="cards-row">
                    {latestRound && latestRound.shoeId === game.shoe.id && !isDealing ? (
                      latestRound.playerCards.map((card, index) => (
                        <PlayingCard card={card} index={index} key={card.id} />
                      ))
                    ) : (
                      <>
                        <div className="card-back" />
                        <div className="card-back" />
                      </>
                    )}
                  </div>
                  <div className="hand-tags">
                    {latestRound?.natural && latestRound.shoeId === game.shoe.id && !isDealing && (
                      <span>自然牌</span>
                    )}
                    {latestRound?.playerPair && latestRound.shoeId === game.shoe.id && !isDealing && (
                      <span>闲对</span>
                    )}
                    {latestRound &&
                      latestRound.shoeId === game.shoe.id &&
                      !isDealing &&
                      latestRound.playerCards.length === 3 && <span>补第三张</span>}
                  </div>
                </div>

                <div className="versus-mark" aria-hidden="true">
                  <span>VS</span>
                </div>

                <div className="hand hand-banker">
                  <div className="hand-label">
                    <span>
                      庄 <small>BANKER</small>
                    </span>
                    <strong>
                      {latestRound && latestRound.shoeId === game.shoe.id && !isDealing
                        ? latestRound.bankerTotal
                        : '—'}
                      <small> 点</small>
                    </strong>
                  </div>
                  <div className="cards-row">
                    {latestRound && latestRound.shoeId === game.shoe.id && !isDealing ? (
                      latestRound.bankerCards.map((card, index) => (
                        <PlayingCard card={card} index={index} key={card.id} />
                      ))
                    ) : (
                      <>
                        <div className="card-back" />
                        <div className="card-back" />
                      </>
                    )}
                  </div>
                  <div className="hand-tags">
                    {latestRound?.natural && latestRound.shoeId === game.shoe.id && !isDealing && (
                      <span>自然牌</span>
                    )}
                    {latestRound?.bankerPair && latestRound.shoeId === game.shoe.id && !isDealing && (
                      <span>庄对</span>
                    )}
                    {latestRound &&
                      latestRound.shoeId === game.shoe.id &&
                      !isDealing &&
                      latestRound.bankerCards.length === 3 && <span>补第三张</span>}
                  </div>
                </div>
              </div>

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
