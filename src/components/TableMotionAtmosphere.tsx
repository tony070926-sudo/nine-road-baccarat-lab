import type { Winner } from '../types'

export type TableMotionPhase =
  | 'betting'
  | 'no-more-bets'
  | 'dealing'
  | 'revealing'
  | 'settling'
  | 'new-shoe'

interface TableMotionAtmosphereProps {
  phase: TableMotionPhase
  outcome: Winner | null
  motionId: string | null
}

/**
 * Visual-only lighting cues for the physical table phases. The layer consumes
 * already-committed game state and never owns a timer or advances a round.
 */
export function TableMotionAtmosphere({
  phase,
  outcome,
  motionId,
}: TableMotionAtmosphereProps) {
  return (
    <div
      className="table-motion-atmosphere"
      data-motion-phase={phase}
      data-motion-outcome={outcome ?? 'none'}
      data-motion-id={motionId ?? 'none'}
      aria-hidden="true"
    >
      <span className="table-phase-glow" />
      <span className="table-phase-sweep" />
      <span
        key={motionId ?? 'outcome-idle'}
        className="table-outcome-aura"
      >
        <i />
        <i />
      </span>
    </div>
  )
}
