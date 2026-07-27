import type { Card } from '../types'

const SUIT_LABEL = {
  spades: '黑桃',
  hearts: '红心',
  diamonds: '方块',
  clubs: '梅花',
} as const

export function cardLabel(card: Card): string {
  return `${SUIT_LABEL[card.suit]} ${card.rank}`
}
