import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChipStackVisual } from './ChipStackVisual'

describe('ChipStackVisual', () => {
  it('renders bounded denomination layers and aggregate metadata', () => {
    const markup = renderToStaticMarkup(
      <ChipStackVisual amount={1_260} className="placed-stack" />,
    )

    expect(markup).toContain('placed-stack')
    expect(markup).toContain('data-chip-stack-amount="1260"')
    expect(markup).toContain('data-chip-stack-layers="5"')
    expect(markup).toContain('data-chip-tier="gold"')
    expect(markup).toContain('data-chip-tier="red"')
    expect(markup).toContain('data-chip-tier="blue"')
  })

  it('compresses very large stacks without changing the visible total', () => {
    const markup = renderToStaticMarkup(
      <ChipStackVisual amount={10_000} maximumVisible={3} />,
    )

    expect(markup).toContain('data-chip-stack-layers="3"')
    expect(markup).toContain('data-chip-stack-hidden="7"')
    expect(markup).toContain('10,000')
    expect(markup).toContain('×10')
  })

  it('keeps five individually placed 100 chips instead of exchanging them', () => {
    const markup = renderToStaticMarkup(
      <ChipStackVisual amount={500} chips={[100, 100, 100, 100, 100]} />,
    )

    expect(markup.match(/data-chip-tier="red"/g)).toHaveLength(5)
    expect(markup).not.toContain('data-chip-tier="purple"')
    expect(markup).toContain('data-chip-stack-layers="5"')
  })

  it('renders a mixed session history in its original bottom-to-top order', () => {
    const markup = renderToStaticMarkup(
      <ChipStackVisual amount={660} chips={[100, 50, 500, 10]} />,
    )
    const renderedValues = Array.from(
      markup.matchAll(/data-chip-value="([^"]+)"/g),
      (match) => Number(match[1]),
    )

    expect(renderedValues).toEqual([100, 50, 500, 10])
  })
})
