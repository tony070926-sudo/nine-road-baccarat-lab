import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TableMotionAtmosphere } from './TableMotionAtmosphere'

describe('TableMotionAtmosphere', () => {
  it('exposes phase and outcome hooks without interactive content', () => {
    const markup = renderToStaticMarkup(
      <TableMotionAtmosphere
        phase="settling"
        outcome="banker"
        motionId="round-8"
      />,
    )

    expect(markup).toContain('data-motion-phase="settling"')
    expect(markup).toContain('data-motion-outcome="banker"')
    expect(markup).toContain('data-motion-id="round-8"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).not.toContain('role=')
  })

  it('uses an explicit neutral outcome outside settlement', () => {
    const markup = renderToStaticMarkup(
      <TableMotionAtmosphere
        phase="betting"
        outcome={null}
        motionId={null}
      />,
    )

    expect(markup).toContain('data-motion-outcome="none"')
  })
})
