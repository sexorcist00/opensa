import { describe, expect, it } from 'vitest';

import { boardTickMs, PUBLISH_INTERVAL_MS, REPLAY_TICK_MS } from './feed-rate';

describe('boardTickMs', () => {
  describe('negative cases', () => {
    it('falls back to the feed rate rather than measuring something nobody asked for', () => {
      for (const query of ['tick=', 'tick=fast', 'tick=0', 'tick=-50', 'tick=15', 'tick=60001']) {
        expect(boardTickMs(new URLSearchParams(query))).toBe(PUBLISH_INTERVAL_MS);
      }
    });

    it('does not let the mock outrun the interface it stands in for by default', () => {
      // The defect this step closes: 50 ms against the publish rate, and the gate compares by identity. The
      // rate itself moved to 500 ms on 2026-09-05, so the assertion is against the CONSTANT rather than a
      // literal — a test that pins the number twice is a test that has to be edited to change the rate.
      expect(boardTickMs(new URLSearchParams(''))).not.toBe(REPLAY_TICK_MS);
      expect(boardTickMs(new URLSearchParams(''))).toBe(PUBLISH_INTERVAL_MS);
    });
  });

  describe('positive cases', () => {
    it('takes an override, so a capture can put the old churn back for a comparison', () => {
      expect(boardTickMs(new URLSearchParams('tick=50'))).toBe(50);
      expect(boardTickMs(new URLSearchParams('tick=1000'))).toBe(1000);
    });

    it('rounds a fractional tick rather than handing setInterval a fraction', () => {
      expect(boardTickMs(new URLSearchParams('tick=33.4'))).toBe(33);
    });
  });
});
