import { Download, FileJson, ListFilter } from 'lucide-react'
import { isFlyRound } from '../game/records'
import type { RoundRecord } from '../types'

interface HistoryTableProps {
  history: RoundRecord[]
  onExportCsv: () => void
  onExportJson: () => void
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)
}

function cardText(record: RoundRecord, side: 'player' | 'banker'): string {
  const cards = side === 'player' ? record.playerCards : record.bankerCards
  const suitSymbol = {
    spades: '♠',
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
  }
  return cards.map((card) => `${card.rank}${suitSymbol[card.suit]}`).join(' ')
}

export function HistoryTable({ history, onExportCsv, onExportJson }: HistoryTableProps) {
  const latestFirst = [...history].reverse()

  return (
    <section className="history-section" id="history">
      <div className="section-heading history-heading">
        <div>
          <p className="eyebrow">AUDIT LOG · 本机保存</p>
          <h2>完整牌局记录</h2>
        </div>
        <div className="history-actions">
          <span className="record-count">
            <ListFilter size={15} />
            {history.length} 局
          </span>
          <button className="secondary-button" onClick={onExportCsv} disabled={!history.length}>
            <Download size={15} />
            CSV
          </button>
          <button className="secondary-button" onClick={onExportJson} disabled={!history.length}>
            <FileJson size={15} />
            JSON
          </button>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="empty-history">
          <span>牌</span>
          <p>完成第一局后，这里会记录牌面、点数、下注、结算和余额变化。</p>
        </div>
      ) : (
        <div className="table-scroll" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">牌靴 / 局</th>
                <th scope="col">结果</th>
                <th scope="col">闲家</th>
                <th scope="col">庄家</th>
                <th scope="col">标记</th>
                <th scope="col">投注</th>
                <th scope="col">庄佣</th>
                <th scope="col">净输赢</th>
                <th scope="col">结余</th>
                <th scope="col">时间</th>
              </tr>
            </thead>
            <tbody>
              {latestFirst.map((record) => (
                <tr key={record.id}>
                  <td>
                    <span className="shoe-code">{record.shoeId.slice(-8)}</span>
                    <small>#{record.handNumber}</small>
                  </td>
                  <td>
                    <span className={`result-pill result-${record.winner}`}>
                      {record.winner === 'banker' ? '庄 B' : record.winner === 'player' ? '闲 P' : '和 T'}
                    </span>
                  </td>
                  <td>
                    <span className="history-cards">{cardText(record, 'player')}</span>
                    <strong>{record.playerTotal} 点</strong>
                  </td>
                  <td>
                    <span className="history-cards">{cardText(record, 'banker')}</span>
                    <strong>{record.bankerTotal} 点</strong>
                  </td>
                  <td>
                    <span className="tag-list">
                      {isFlyRound(record) && <i className="tag-fly">飞牌</i>}
                      {record.natural && <i>自然牌</i>}
                      {record.playerPair && <i>闲对</i>}
                      {record.bankerPair && <i>庄对</i>}
                      {!isFlyRound(record) &&
                        !record.natural &&
                        !record.playerPair &&
                        !record.bankerPair &&
                        '—'}
                    </span>
                  </td>
                  <td>{formatNumber(record.settlement.totalStake)}</td>
                  <td>
                    {formatNumber(
                      record.settlement.commissionCharged ??
                        (record.winner === 'banker' ? record.bets.banker * 0.05 : 0),
                    )}
                  </td>
                  <td className={record.settlement.net >= 0 ? 'is-positive' : 'is-negative'}>
                    {record.settlement.net > 0 ? '+' : ''}
                    {formatNumber(record.settlement.net)}
                  </td>
                  <td>{formatNumber(record.balanceAfter)}</td>
                  <td>
                    {new Intl.DateTimeFormat('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    }).format(new Date(record.timestamp))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="storage-note">
        记录仅保存在当前浏览器，最多保留最近 500 局；导出文件包含规则与洗牌版本，便于复核。
      </p>
    </section>
  )
}
