import { describe, test, expect } from 'bun:test';
import {
  MAIN_VIRTUALIZATION,
  THREAD_VIRTUALIZATION,
  MIN_ESTIMATED_HEIGHT,
  computeAdaptiveWindowSize,
  computeSmoothedAverageHeight,
  shouldKeepBottomAnchored,
  shouldApplyTopSpacerCompensation,
} from '../../src/lib/components/messages/virtualizationHeuristics';

describe('virtualization heuristics', () => {
  test('keeps adaptive window size bounded by config', () => {
    expect(
      computeAdaptiveWindowSize({
        containerHeight: 4000,
        averageRowHeight: MIN_ESTIMATED_HEIGHT,
        config: MAIN_VIRTUALIZATION,
      })
    ).toBe(MAIN_VIRTUALIZATION.maxWindowSize);

    expect(
      computeAdaptiveWindowSize({
        containerHeight: 280,
        averageRowHeight: 84,
        config: THREAD_VIRTUALIZATION,
      })
    ).toBe(THREAD_VIRTUALIZATION.initialWindowSize);
  });

  test('smooths average height shifts to reduce spacer drift', () => {
    const next = computeSmoothedAverageHeight({
      previousAverage: 70,
      observedAverage: 190,
      minHeight: 40,
      maxHeight: 280,
      blendWeight: 0.2,
      maxStep: 2.5,
    });

    expect(next).toBeCloseTo(72.5, 3);
  });

  test('keeps bottom anchoring enabled while already near bottom', () => {
    expect(shouldKeepBottomAnchored({ isNearBottom: true, pinnedUntilMs: 0, nowMs: 10 })).toBe(true);
    expect(shouldKeepBottomAnchored({ isNearBottom: false, pinnedUntilMs: 100, nowMs: 99 })).toBe(true);
    expect(shouldKeepBottomAnchored({ isNearBottom: false, pinnedUntilMs: 100, nowMs: 101 })).toBe(false);
  });

  test('ignores tiny spacer compensation deltas to avoid micro-jitter', () => {
    expect(shouldApplyTopSpacerCompensation(0.4)).toBe(false);
    expect(shouldApplyTopSpacerCompensation(1.0)).toBe(false);
    expect(shouldApplyTopSpacerCompensation(1.1)).toBe(true);
  });
});
