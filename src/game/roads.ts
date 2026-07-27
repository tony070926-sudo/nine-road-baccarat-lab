import type { BigRoadCell, RoadCell, RoadColor, RoundRecord, Winner } from '../types'

type MainWinner = Exclude<Winner, 'tie'>

interface LogicalRoadItem {
  winner: MainWinner
  record: RoundRecord
}

interface RunItem {
  winner: MainWinner
  records: RoundRecord[]
}

function key(row: number, col: number): string {
  return `${row}:${col}`
}

function layoutSequence<T extends string>(
  sequence: T[],
): Array<RoadCell<T>> {
  if (sequence.length === 0) return []

  const occupied = new Set<string>()
  const cells: Array<RoadCell<T>> = []
  let startCol = 0
  let row = 0
  let col = 0
  let previous = sequence[0]

  sequence.forEach((value, sourceIndex) => {
    if (sourceIndex === 0) {
      // First result is always the top-left cell.
    } else if (value === previous) {
      const candidateRow = row + 1
      if (candidateRow < 6 && !occupied.has(key(candidateRow, col))) {
        row = candidateRow
      } else {
        col += 1
        while (occupied.has(key(row, col))) col += 1
      }
    } else {
      startCol += 1
      row = 0
      col = startCol
      while (occupied.has(key(row, col))) {
        startCol += 1
        col = startCol
      }
    }

    cells.push({ row, col, value, sourceIndex })
    occupied.add(key(row, col))
    previous = value
  })

  return cells
}

function logicalRuns(records: RoundRecord[]): RunItem[] {
  const nonTies: LogicalRoadItem[] = records
    .filter((record) => record.winner !== 'tie')
    .map((record) => ({ winner: record.winner as MainWinner, record }))

  return nonTies.reduce<RunItem[]>((runs, item) => {
    const current = runs[runs.length - 1]
    if (!current || current.winner !== item.winner) {
      runs.push({ winner: item.winner, records: [item.record] })
    } else {
      current.records.push(item.record)
    }
    return runs
  }, [])
}

export function buildBeadPlate(records: RoundRecord[]): Array<RoadCell<Winner>> {
  return records.map((record, index) => ({
    row: index % 6,
    col: Math.floor(index / 6),
    value: record.winner,
    sourceIndex: index,
  }))
}

export function buildBigRoad(records: RoundRecord[]): BigRoadCell[] {
  const nonTies = records.filter((record) => record.winner !== 'tie')
  if (nonTies.length === 0) {
    if (records.length === 0) return []
    return [
      {
        row: 0,
        col: 0,
        value: 'tie',
        sourceIndex: 0,
        tieCount: records.length,
        playerPair: records.some((record) => record.playerPair),
        bankerPair: records.some((record) => record.bankerPair),
        roundIds: records.map((record) => record.id),
      },
    ]
  }

  const positions = layoutSequence(nonTies.map((record) => record.winner as MainWinner))
  const cells: BigRoadCell[] = positions.map((position, index) => {
    const record = nonTies[index]
    return {
      ...position,
      value: record.winner as MainWinner,
      tieCount: 0,
      playerPair: record.playerPair,
      bankerPair: record.bankerPair,
      roundIds: [record.id],
    }
  })

  let activeCell: BigRoadCell | null = null
  let nonTieIndex = -1
  let leadingTieCount = 0
  let leadingPlayerPair = false
  let leadingBankerPair = false

  records.forEach((record) => {
    if (record.winner === 'tie') {
      if (!activeCell) {
        leadingTieCount += 1
        leadingPlayerPair ||= record.playerPair
        leadingBankerPair ||= record.bankerPair
      } else {
        activeCell.tieCount += 1
        activeCell.playerPair ||= record.playerPair
        activeCell.bankerPair ||= record.bankerPair
        activeCell.roundIds.push(record.id)
      }
      return
    }

    nonTieIndex += 1
    activeCell = cells[nonTieIndex]
    if (nonTieIndex === 0 && leadingTieCount > 0) {
      activeCell.tieCount = leadingTieCount
      activeCell.playerPair ||= leadingPlayerPair
      activeCell.bankerPair ||= leadingBankerPair
      activeCell.roundIds.unshift(...records.slice(0, leadingTieCount).map((item) => item.id))
    }
  })

  return cells
}

/**
 * Builds the red/blue pattern sequence for a derived road.
 * lookback=1: Big Eye Boy, 2: Small Road, 3: Cockroach Road.
 */
export function deriveRoadSequence(
  records: RoundRecord[],
  lookback: 1 | 2 | 3,
): RoadColor[] {
  const runs = logicalRuns(records)
  const colors: RoadColor[] = []

  runs.forEach((run, runIndex) => {
    run.records.forEach((_record, rowIndex) => {
      if (rowIndex === 0) {
        const referenceIndex = runIndex - 1 - lookback
        if (referenceIndex < 0) return
        const previousLength = runs[runIndex - 1].records.length
        const referenceLength = runs[referenceIndex].records.length
        colors.push(previousLength === referenceLength ? 'red' : 'blue')
        return
      }

      const referenceIndex = runIndex - lookback
      if (referenceIndex < 0) return
      const referenceLength = runs[referenceIndex].records.length
      // Only the first step beyond the reference column is irregular (blue).
      // Any further extension has already established a new regular tail.
      colors.push(rowIndex === referenceLength ? 'blue' : 'red')
    })
  })

  return colors
}

export function buildDerivedRoad(
  records: RoundRecord[],
  lookback: 1 | 2 | 3,
): Array<RoadCell<RoadColor>> {
  return layoutSequence(deriveRoadSequence(records, lookback))
}

export function roadColumnCount(cells: Array<RoadCell<string>>, minimum = 12): number {
  const maxCol = cells.reduce((max, cell) => Math.max(max, cell.col), -1)
  return Math.max(minimum, maxCol + 2)
}
