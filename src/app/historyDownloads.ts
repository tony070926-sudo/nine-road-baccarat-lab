import { RULESET_VERSION } from '../game/baccarat'
import { downloadTextFile, historyToCsv } from '../game/historyExport'
import type { RoundRecord } from '../types'

function datedHistoryFilename(extension: 'csv' | 'json'): string {
  return `baccarat-history-${new Date().toISOString().slice(0, 10)}.${extension}`
}

export function downloadHistoryCsv(history: RoundRecord[]): void {
  downloadTextFile(
    datedHistoryFilename('csv'),
    `\uFEFF${historyToCsv(history)}`,
    'text/csv;charset=utf-8',
  )
}

export function downloadHistoryJson(history: RoundRecord[]): void {
  downloadTextFile(
    datedHistoryFilename('json'),
    JSON.stringify(
      { exportedAt: new Date().toISOString(), rulesetVersion: RULESET_VERSION, history },
      null,
      2,
    ),
    'application/json;charset=utf-8',
  )
}
