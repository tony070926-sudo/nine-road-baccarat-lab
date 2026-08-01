import { ExternalLink } from 'lucide-react'
import { Modal } from './Modal'

const RULE_SOURCES = [
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
] as const

interface RulesModalProps {
  open: boolean
  onClose: () => void
}

export function RulesModal({ open, onClose }: RulesModalProps) {
  if (!open) return null

  return (
    <Modal title="标准佣金百家乐规则" onClose={onClose} wide>
      <div className="rules-intro">
        <span className="simulation-badge">8 副牌 · 416 张 · 传统庄佣</span>
        <p>
          本模拟器以新加坡博彩监管局公布的 Marina Bay Sands Baccarat Version 8
          为数学与结算主规则来源，并固定使用其中允许的八副牌配置；开牌流程采用澳门式
          “闲家先开”的明确桌面配置。
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
        <article>
          <h3>本桌咪牌与限额</h3>
          <p>
            先开闲家首两张，再开庄家首两张，随后依次处理闲、庄增牌；增牌单独观看，
            首两张牌在该阶段收拢。
          </p>
          <p>
            下注庄或闲主注后，可选择自己咪对应一侧，或拒绝接牌并由荷官开牌；
            和、对子单注由荷官开牌。开牌方式不改变牌靴、结果或派彩。
            主注限额 10–10,000，和/对子限额 10–1,000。
          </p>
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
        {RULE_SOURCES.map((source) => (
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
  )
}
