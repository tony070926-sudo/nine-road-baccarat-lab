import type { CSSProperties } from 'react'
import {
  chipStackLayout,
  chipStackLayoutFromValues,
  type ChipStackLayer,
} from '../game/chipPhysics'

interface ChipStackVisualProps {
  amount: number
  label?: string
  className?: string
  maximumVisible?: number
  /** Optional session history, ordered from the first chip to the top chip. */
  chips?: readonly number[]
}

function layerStyle(layer: ChipStackLayer): CSSProperties {
  return {
    '--chip-layer-index': layer.index,
    '--chip-layer-x': `${layer.x}px`,
    '--chip-layer-y': `${layer.y}px`,
    '--chip-layer-rotation': `${layer.rotation}deg`,
  } as CSSProperties
}

function defaultLabel(amount: number): string {
  return amount.toLocaleString('zh-CN', {
    maximumFractionDigits: 1,
  })
}

/**
 * Shared visual representation used by placed wagers and dealer settlement.
 * It never participates in game accounting; optional session history only
 * preserves the denominations and order that were physically placed.
 */
export function ChipStackVisual({
  amount,
  label,
  className = '',
  maximumVisible,
  chips,
}: ChipStackVisualProps) {
  const layout = chips
    ? chipStackLayoutFromValues(amount, chips, maximumVisible)
    : chipStackLayout(amount, maximumVisible)
  if (layout.layers.length === 0) return null

  const topLayer = layout.layers.at(-1)
  const style = {
    '--chip-stack-top-y': `${topLayer?.y ?? 0}px`,
  } as CSSProperties

  return (
    <span
      className={`chip-stack-visual ${className}`.trim()}
      style={style}
      data-chip-stack-amount={layout.amount}
      data-chip-stack-layers={layout.layers.length}
      data-chip-stack-hidden={layout.hiddenCount}
      aria-hidden="true"
    >
      <span className="chip-stack-impact" />
      {layout.layers.map((layer) => (
        <i
          className="chip-stack-disc"
          data-chip-value={layer.value}
          data-chip-tier={layer.tier}
          style={layerStyle(layer)}
          key={`${layer.index}:${layer.value}`}
        >
          <span>{layer.label}</span>
        </i>
      ))}
      <strong>{label ?? defaultLabel(layout.amount)}</strong>
      {layout.hiddenCount > 0 && (
        <small>×{layout.hiddenCount + layout.layers.length}</small>
      )}
    </span>
  )
}
