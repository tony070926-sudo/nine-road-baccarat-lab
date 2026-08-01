import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}

export function Modal({ title, onClose, children, wide = false }: ModalProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const backgroundElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.app-shell > :not(.modal-backdrop):not(.toast)',
      ),
    )
    const priorInert = backgroundElements.map((element) => element.inert)
    backgroundElements.forEach((element) => {
      element.inert = true
    })
    dialogRef.current?.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden)
      if (focusable.length === 0) {
        event.preventDefault()
        dialogRef.current.focus({ preventScroll: true })
        return
      }

      const first = focusable[0]
      const last = focusable.at(-1) ?? first
      const activeElement = document.activeElement
      if (
        activeElement === dialogRef.current ||
        !dialogRef.current.contains(activeElement)
      ) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      backgroundElements.forEach((element, index) => {
        element.inert = priorInert[index]
      })
      previouslyFocused?.focus({ preventScroll: true })
    }
  }, [])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className={`modal-card ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
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
