import {
  initialLeaderboardBalance,
  isLeaderboardBalance,
} from './profile'

interface RecordedBalance {
  balanceBefore: number
  balanceAfter: number
}

export function leaderboardHighFromRecordedGame(
  currentBalance: number,
  history: readonly RecordedBalance[],
): number {
  let highestBalance = initialLeaderboardBalance(currentBalance)
  for (const record of history) {
    if (isLeaderboardBalance(record.balanceBefore)) {
      highestBalance = Math.max(highestBalance, record.balanceBefore)
    }
    if (isLeaderboardBalance(record.balanceAfter)) {
      highestBalance = Math.max(highestBalance, record.balanceAfter)
    }
  }
  return highestBalance
}
