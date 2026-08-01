import type {
  TableGuest,
  TableGuestRevealReaction,
  TableGuestSettlementReaction,
} from '../game/tableGuests'

interface TableGuestsBaseProps {
  guests: readonly TableGuest[]
  className?: string
  ariaLabel?: string
}

interface BettingTableGuestsProps extends TableGuestsBaseProps {
  phase: 'betting'
  activeReaction?: never
  settlementReactions?: never
}

interface RevealingTableGuestsProps extends TableGuestsBaseProps {
  phase: 'revealing'
  activeReaction: TableGuestRevealReaction | null
  settlementReactions?: never
}

interface SettledTableGuestsProps extends TableGuestsBaseProps {
  phase: 'settled'
  activeReaction?: never
  settlementReactions: readonly TableGuestSettlementReaction[]
}

export type TableGuestsProps =
  | BettingTableGuestsProps
  | RevealingTableGuestsProps
  | SettledTableGuestsProps

interface GuestPresentation {
  message: string | null
  messageId: string | null
  messageKind: 'intent' | 'reaction' | 'settlement' | null
  tone: string | null
  outcome: string | null
}

function presentationForGuest(
  props: TableGuestsProps,
  guest: TableGuest,
): GuestPresentation {
  if (props.phase === 'betting') {
    return {
      message: guest.intent.message,
      messageId: `${guest.id}:intent`,
      messageKind: 'intent',
      tone: 'intent',
      outcome: null,
    }
  }

  if (props.phase === 'revealing') {
    const reaction =
      props.activeReaction?.guestId === guest.id ? props.activeReaction : null

    return {
      message: reaction?.message ?? null,
      messageId: reaction?.id ?? null,
      messageKind: reaction ? 'reaction' : null,
      tone: reaction?.tone ?? null,
      outcome: null,
    }
  }

  const reaction =
    props.settlementReactions.find((item) => item.guestId === guest.id) ?? null

  return {
    message: reaction?.message ?? null,
    messageId: reaction?.id ?? null,
    messageKind: reaction ? 'settlement' : null,
    tone: reaction?.tone ?? null,
    outcome: reaction?.outcome ?? null,
  }
}

function avatarText(name: string): string {
  return Array.from(name).at(-1) ?? '客'
}

type MobileGuestSlot = 'primary' | 'secondary' | 'hidden'

function mobileGuestSlots(
  props: TableGuestsProps,
): ReadonlyMap<string, MobileGuestSlot> {
  const activeGuestId =
    props.phase === 'revealing' &&
    props.activeReaction &&
    props.guests.some((guest) => guest.id === props.activeReaction?.guestId)
      ? props.activeReaction.guestId
      : null
  const primaryGuestId = activeGuestId ?? props.guests[0]?.id ?? null
  const secondaryGuestId =
    props.guests.find((guest) => guest.id !== primaryGuestId)?.id ?? null

  return new Map(
    props.guests.map((guest) => [
      guest.id,
      guest.id === primaryGuestId
        ? 'primary'
        : guest.id === secondaryGuestId
          ? 'secondary'
          : 'hidden',
    ]),
  )
}

/**
 * Structural, intentionally unstyled virtual table companions. The data
 * attributes and class names are stable integration hooks for the table scene.
 * Guest chatter is readable but is not a live region, so it cannot compete
 * with the dealer's authoritative round announcements.
 */
export function TableGuests(props: TableGuestsProps) {
  const {
    guests,
    phase,
    className = '',
    ariaLabel = '虚拟同桌',
  } = props
  const mobileSlots = mobileGuestSlots(props)

  return (
    <aside
      className={`table-guests table-guests-${phase} ${className}`.trim()}
      aria-label={ariaLabel}
      data-table-guests="true"
      data-guest-phase={phase}
      data-guest-count={guests.length}
    >
      <ul className="table-guests-list">
        {guests.map((guest) => {
          const presentation = presentationForGuest(props, guest)
          const isSpeaking = presentation.message !== null
          const mobileSlot = mobileSlots.get(guest.id) ?? 'hidden'

          return (
            <li
              className={`table-guest table-guest-${guest.seat} table-guest-${phase} ${
                isSpeaking ? 'is-speaking' : ''
              } ${
                presentation.tone
                  ? `table-guest-tone-${presentation.tone}`
                  : ''
              } ${
                presentation.outcome
                  ? `table-guest-outcome-${presentation.outcome}`
                  : ''
              }`
                .trim()
                .replace(/\s+/g, ' ')}
              data-table-guest="true"
              data-guest-id={guest.id}
              data-guest-seat={guest.seat}
              data-guest-tendency={guest.tendency}
              data-guest-intent={guest.intent.target}
              data-guest-speaking={isSpeaking ? 'true' : 'false'}
              data-guest-mobile-slot={mobileSlot}
              data-guest-message-kind={presentation.messageKind ?? undefined}
              data-guest-reaction-tone={presentation.tone ?? undefined}
              data-guest-outcome={presentation.outcome ?? undefined}
              data-guest-event={presentation.messageId ?? undefined}
              key={guest.id}
            >
              <span className="table-guest-avatar" aria-hidden="true">
                {avatarText(guest.name)}
              </span>
              <span className="table-guest-content">
                <strong className="table-guest-name">{guest.name}</strong>
                {presentation.message && (
                  <span
                    className={`table-guest-message table-guest-message-${presentation.messageKind}`}
                    aria-live="off"
                    key={presentation.messageId}
                  >
                    {presentation.message}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
