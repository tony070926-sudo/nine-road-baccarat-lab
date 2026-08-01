import type { Bets, PendingRound, PlayMode, ShoeState, Winner } from '../types'

export type RevealActor = 'user' | 'dealer'
export type DetailView = 'road' | 'history' | 'leaderboard' | 'lab' | null

export interface RoundPrelude {
  id: string
  bets: Bets
  playMode: PlayMode
  pending: PendingRound
}

export interface NewShoeMotion {
  id: string
  mode: 'manual' | 'automatic'
  shoe: ShoeState
  roundIntent: RoundPrelude | null
}

export interface OutcomeMotion {
  id: string
  winner: Winner
}
