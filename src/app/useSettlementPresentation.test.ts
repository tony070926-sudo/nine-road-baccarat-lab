import { describe, expect, it, vi } from 'vitest'
import {
  MIN_PRESENTATION_HOLD_MS,
  NEXT_ROUND_HOLD_MS,
  ROAD_RECORD_HOLD_MS,
  cancelSettlementPresentationRuntime,
  settlementPresentationHold,
  settlementPresentationCopy,
  settlementRecordIsVisible,
  settlementStateForAction,
} from './useSettlementPresentation'

describe('settlement presentation timing', () => {
  it('scales road and next-round holds with every effective motion profile', () => {
    expect(settlementPresentationHold(ROAD_RECORD_HOLD_MS, 'cinematic')).toBe(546)
    expect(settlementPresentationHold(ROAD_RECORD_HOLD_MS, 'standard')).toBe(420)
    expect(settlementPresentationHold(ROAD_RECORD_HOLD_MS, 'fast')).toBe(231)
    expect(settlementPresentationHold(ROAD_RECORD_HOLD_MS, 'reduced')).toBe(
      MIN_PRESENTATION_HOLD_MS,
    )
    expect(settlementPresentationHold(NEXT_ROUND_HOLD_MS, 'standard')).toBe(160)
  })

  it('maps physical chip actions onto the public dealer procedure', () => {
    expect(settlementStateForAction('collect')).toBe(
      'collecting-losing-wagers',
    )
    expect(settlementStateForAction('push')).toBe(
      'returning-pushed-wagers',
    )
    expect(settlementStateForAction('pay')).toBe('paying-winners')
  })

  it('publishes a result to the road only when road recording begins', () => {
    expect(settlementRecordIsVisible('round-1', null)).toBe(true)
    expect(settlementRecordIsVisible('round-1', null, 'round-1')).toBe(false)
    expect(settlementRecordIsVisible('round-1', null, 'round-2')).toBe(true)
    expect(
      settlementRecordIsVisible('round-1', {
        roundId: 'round-2',
        state: 'not-started',
      }),
    ).toBe(true)
    expect(
      settlementRecordIsVisible(
        'round-1',
        { roundId: 'round-2', state: 'recording-road' },
        'round-1',
      ),
    ).toBe(false)
    for (const state of [
      'not-started',
      'collecting-losing-wagers',
      'returning-pushed-wagers',
      'paying-winners',
    ] as const) {
      expect(
        settlementRecordIsVisible(
          'round-1',
          { roundId: 'round-1', state },
          'round-1',
        ),
      ).toBe(false)
    }
    for (const state of [
      'recording-road',
      'discarding-cards',
      'complete',
    ] as const) {
      expect(
        settlementRecordIsVisible(
          'round-1',
          { roundId: 'round-1', state },
          'round-1',
        ),
      ).toBe(true)
    }
  })

  it('cancels local continuations without completing the presentation', () => {
    const onComplete = vi.fn()
    const activeRef = { current: { roundId: 'round-1', onComplete } }
    const timerRef = { current: 73 }
    const clearTimeout = vi.fn()
    const clearCardSweepMotion = vi.fn()
    const clearPresentation = vi.fn()
    const clearReadyRound = vi.fn()

    cancelSettlementPresentationRuntime({
      activeRef,
      timerRef,
      clearTimeout,
      clearCardSweepMotion,
      clearPresentation,
      clearReadyRound,
    })

    expect(clearTimeout).toHaveBeenCalledWith(73)
    expect(timerRef.current).toBeNull()
    expect(activeRef.current).toBeNull()
    expect(clearCardSweepMotion).toHaveBeenCalledOnce()
    expect(clearPresentation).toHaveBeenCalledOnce()
    expect(clearReadyRound).toHaveBeenCalledOnce()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('keeps the dealer call aligned with road and discard phases', () => {
    expect(settlementPresentationCopy('not-started', false)).toEqual({
      heading: '荷官正在宣读本局点数与胜方',
      status: '报点中',
    })
    expect(settlementPresentationCopy('recording-road', false)).toEqual({
      heading: '荷官正在记录路单',
      status: '录单中',
    })
    expect(settlementPresentationCopy('discarding-cards', true)).toEqual({
      heading: '荷官正在收牌',
      status: '收牌中',
    })
    expect(
      settlementPresentationCopy('returning-pushed-wagers', false),
    ).toEqual({
      heading: '荷官正在退回和注',
      status: '退注中',
    })
    expect(settlementPresentationCopy(null, false)).toEqual({
      heading: null,
      status: null,
    })
  })
})
