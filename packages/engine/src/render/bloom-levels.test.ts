import { describe, expect, it } from 'vitest';

import { BLOOM_MAX_LEVELS, BLOOM_MIN_LEVELS, bloomLevelsFor, bloomPassCount } from './bloom-levels';

describe('bloomLevelsFor', () => {
  describe('negative cases', () => {
    it('never returns fewer than the composite can bind', () => {
      // `resultView` is `upViews[0]` and there are `levels - 1` up views, so one level binds nothing.
      for (const [width, height] of [
        [1, 1],
        [32, 24],
        [64, 8],
      ]) {
        expect(bloomLevelsFor(width, height)).toBe(BLOOM_MIN_LEVELS);
      }
    });

    it('does not grow the pass count without bound on a large surface', () => {
      expect(bloomLevelsFor(7680, 4320)).toBe(BLOOM_MAX_LEVELS);
    });

    it('clamps a pinned count rather than trusting it — an out-of-range arm would build an unbindable chain', () => {
      expect(bloomLevelsFor(720, 640, 0)).toBe(BLOOM_MIN_LEVELS);
      expect(bloomLevelsFor(720, 640, -3)).toBe(BLOOM_MIN_LEVELS);
      expect(bloomLevelsFor(720, 640, 99)).toBe(BLOOM_MAX_LEVELS);
    });

    it('derives rather than pinning when the arm is absent or not a number', () => {
      expect(bloomLevelsFor(720, 640, undefined)).toBe(5);
      expect(bloomLevelsFor(720, 640, Number.NaN)).toBe(5);
    });
  });

  describe('positive cases', () => {
    it('stops before the level whose shorter edge falls under 16 px', () => {
      // 720x640 halves to 360x320, 180x160, 90x80, 45x40, 22x20, then 11x10 — which is the one dropped.
      expect(bloomLevelsFor(720, 640)).toBe(5);
    });

    it('derives more levels for a bigger surface, from the same line of code', () => {
      expect(bloomLevelsFor(1920, 1080)).toBe(6);
      expect(bloomLevelsFor(3840, 2160)).toBe(7);
    });

    it('reads the SHORTER edge, so a wide strip does not buy levels it cannot fill', () => {
      expect(bloomLevelsFor(4096, 640)).toBe(bloomLevelsFor(720, 640));
    });

    it('takes a pinned count, which is how the old behaviour is put back for the A/B', () => {
      expect(bloomLevelsFor(720, 640, BLOOM_MAX_LEVELS)).toBe(8);
    });
  });
});

describe('bloomPassCount', () => {
  describe('positive cases', () => {
    it('prices the chain the way 9/05 states it: the prefilter, the downs and the ups', () => {
      expect(bloomPassCount(8)).toBe(16);
      expect(bloomPassCount(5)).toBe(10);
    });

    it('is what the derived count buys at the size the captures were taken at', () => {
      const before = bloomPassCount(BLOOM_MAX_LEVELS);
      const after = bloomPassCount(bloomLevelsFor(720, 640));

      expect(before - after).toBe(6);
    });
  });
});
