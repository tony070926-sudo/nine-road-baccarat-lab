export type CrowdCheerSide = 'player' | 'banker'
export type CrowdCheerTone =
  | 'anticipation'
  | 'celebration'
  | 'reaction'
  | 'hush'

export interface ActiveCrowdCheer {
  id: string
  side: CrowdCheerSide
  tone: CrowdCheerTone
  messages: readonly string[]
}

interface CrowdCheerOverlayProps {
  cheer: ActiveCrowdCheer | null
}

export function CrowdCheerOverlay({ cheer }: CrowdCheerOverlayProps) {
  if (!cheer) return null

  return (
    <div
      className={`crowd-cheer-layer crowd-cheer-${cheer.side} crowd-cheer-${cheer.tone}`}
      data-cheer-event={cheer.id}
      data-cheer-side={cheer.side}
      aria-hidden="true"
      key={cheer.id}
    >
      {cheer.messages.slice(0, 3).map((message, index) => (
        <span
          className={`crowd-cheer-bubble crowd-cheer-bubble-${index}`}
          key={`${cheer.id}-${index}`}
        >
          <i className="crowd-cheer-avatar" />
          <strong>{message}</strong>
        </span>
      ))}
    </div>
  )
}
