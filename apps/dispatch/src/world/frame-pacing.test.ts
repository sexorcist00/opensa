/**
 * The measure exists because a rate cannot answer the smoothness question, so the negative cases are the
 * ways a smoothness number lies: by calling an even frame uneven, by calling a stutter even, and by
 * depending on the display's refresh rate when it claims not to.
 */
import { describe, expect, it } from 'vitest';

import { FramePacing, PACE_RATIO } from './frame-pacing';

/** `count` frames alternating between one display interval and two — 45 fps on a 60 Hz panel. */
function alternating(count: number, interval: number): number[] {
  return Array.from({ length: count }, (_, frame) => (frame % 3 === 2 ? interval * 2 : interval));
}

function feed(values: readonly number[]): FramePacing {
  const pacing = new FramePacing();
  for (const value of values) {
    pacing.add(value);
  }

  return pacing;
}

describe('FramePacing', () => {
  describe('negative cases', () => {
    it('reports zeroes rather than dividing by no pairs', () => {
      const pacing = feed([]);

      expect({ changeRate: pacing.changeRate, changes: pacing.changes, pairs: pacing.pairCount }).toEqual({
        changeRate: 0,
        changes: 0,
        pairs: 0,
      });
    });

    it('opens no pair on a single frame — one frame has no pace', () => {
      expect(feed([16.7]).pairCount).toBe(0);
    });

    it('does not call a STEADY SLOW frame uneven, which is the failure a rate would make', () => {
      const flat30 = feed(Array.from({ length: 200 }, () => 33.3));

      expect(flat30.changeRate).toBe(0);
      expect(flat30.changes).toBe(0);
    });

    it('does not call ordinary jitter within one rung a change', () => {
      const jittery = feed([16.4, 16.9, 16.2, 17.1, 16.6, 16.8, 17.0, 16.3]);

      expect(jittery.changes).toBe(0);
      expect(jittery.worstRatio).toBeLessThan(PACE_RATIO);
    });

    it('does not let a non-positive dt fabricate a ratio, or join the frames around it', () => {
      const withGap = feed([16.7, 0, 33.4]);

      expect({ changes: withGap.changes, pairs: withGap.pairCount }).toEqual({ changes: 0, pairs: 0 });
    });

    it('is not fooled by a HISTOGRAM-EQUAL pair: the same frames, ordered two ways', () => {
      const interval = 16.7;
      const stuttering = feed([interval, interval * 2, interval, interval * 2, interval, interval * 2]);
      const sorted = feed([interval, interval, interval, interval * 2, interval * 2, interval * 2]);

      expect(stuttering.changes).toBe(5);
      expect(sorted.changes).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('counts every rung change in a 60/30 alternation — one entering the slow frame and one leaving it', () => {
      const frames = alternating(60, 16.7);
      const doubled = frames.filter((ms) => ms > 16.7).length;
      const stutter = feed(frames);

      // Each doubled frame changes the pace twice, except the last one, which has no successor to change back to.
      expect(stutter.changes).toBe(doubled * 2 - 1);
      expect(stutter.worstRatio).toBeCloseTo(2, 5);
    });

    it('reads the same on a 144 Hz desk as on a 60 Hz phone — the ratio carries no refresh rate', () => {
      const phone = feed(alternating(90, 16.7));
      const desk = feed(alternating(90, 6.94));

      expect(desk.changeRate).toBeCloseTo(phone.changeRate, 10);
    });

    it('separates one hitch from a frame that is doing this constantly', () => {
      const oneHitch = feed([
        ...Array.from({ length: 60 }, () => 16.7),
        120,
        ...Array.from({ length: 60 }, () => 16.7),
      ]);
      const constant = feed(alternating(121, 16.7));

      expect(oneHitch.changes).toBe(2);
      expect(oneHitch.worstRatio).toBeCloseTo(120 / 16.7, 5);
      expect(constant.changes).toBeGreaterThan(oneHitch.changes * 30);
    });

    it('ranks the measured arms the way the operator would: nobloom over field', () => {
      // The 2026-09-05 re-flight: 78 % of field's frames on the first rung against 95 % of nobloom's.
      const field = feed(Array.from({ length: 500 }, (_, frame) => (frame % 5 === 4 ? 33.4 : 16.7)));
      const nobloom = feed(Array.from({ length: 500 }, (_, frame) => (frame % 20 === 19 ? 33.4 : 16.7)));

      expect(nobloom.changeRate).toBeLessThan(field.changeRate);
    });
  });
});
