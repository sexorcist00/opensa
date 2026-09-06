/**
 * The world hour has to agree ACROSS consoles, so the negative cases are the ways it could quietly stop
 * agreeing: a console inventing its own time while a server is speaking, one that drifts without
 * re-converging, and one that imports a clock skew it has no way to measure.
 */
import { describe, expect, it } from 'vitest';

import type { WorldClock, WorldTimeAnchor } from './world-clock';

import {
  DEFAULT_HOUR,
  HOUR_REDRAW_STEP,
  hourFromAnchor,
  quantizeHour,
  resolveWorldHour,
  SA_HOURS_PER_SECOND,
  wrapHour,
} from './world-clock';

/** The console's own day window and the sky LUT's own quantum — the two the step is derived from. */
const DAWN = 6;
const DUSK = 20;
const SKY_LUT_ELEVATION_STEPS = 200;

/** What `engine-environment-driver.ts` feeds the LUT: the sun's elevation as a 0..1 ratio. */
function elevationRatio(hour: number): number {
  if (hour <= DAWN || hour >= DUSK) {
    return 0;
  }

  return Math.sin(((hour - DAWN) / (DUSK - DAWN)) * Math.PI);
}

const anchor = (hour: number, receivedAtMs: number, hoursPerSecond = SA_HOURS_PER_SECOND): WorldTimeAnchor => ({
  hour,
  hoursPerSecond,
  receivedAtMs,
});

const clock = (over: Partial<WorldClock> = {}): WorldClock => ({
  anchor: null,
  local: null,
  operatorHour: null,
  ...over,
});

describe('the world clock', () => {
  describe('negative cases', () => {
    it('never runs past midnight into a 25th hour', () => {
      expect(hourFromAnchor(anchor(23.5, 0), 60 * 60 * 1000)).toBeCloseTo(wrapHour(23.5 + 60), 6);
      expect(wrapHour(25)).toBe(1);
      expect(wrapHour(-1)).toBe(23);
    });

    it('does not rewind the world when the clock goes backwards', () => {
      // A monotonic source that was not is a real thing on a phone that slept. Clamping keeps the world
      // where it was; letting it run negative would take the city back through dawn.
      expect(hourFromAnchor(anchor(12, 5000), 1000)).toBe(12);
    });

    it('does not let a console invent an hour while the server is speaking', () => {
      const withFeed = clock({ anchor: anchor(3, 0), local: anchor(21, 0) });

      expect(resolveWorldHour(withFeed, 0).source).toBe('feed');
      expect(resolveWorldHour(withFeed, 0).hour).toBeCloseTo(3, 6);
    });

    it('measures elapsed time on ITS OWN clock, so a skewed server timestamp cannot reach the world', () => {
      // Two consoles whose wall clocks disagree by an hour receive the same anchor at their own `receivedAtMs`.
      // Ten seconds later each is ten seconds further into the day — the skew never enters the arithmetic.
      const consoleA = hourFromAnchor(anchor(8, 1_000_000), 1_010_000);
      const consoleB = hourFromAnchor(anchor(8, 4_600_000), 4_610_000);

      expect(consoleA).toBeCloseTo(consoleB, 10);
    });

    it('re-converges on every tick rather than accumulating drift', () => {
      // A console that has been interpolating for a while, and the next anchor that arrives. What it draws
      // after the anchor depends on the ANCHOR alone, so yesterday's drift cannot survive into today.
      const drifted = hourFromAnchor(anchor(6, 0), 600_000);
      const corrected = hourFromAnchor(anchor(9, 600_000), 600_000);

      expect(drifted).not.toBeCloseTo(9, 3);
      expect(corrected).toBe(9);
    });
    // The step exists to stop a running clock making every frame dirty. If it were too COARSE the sky would
    // move in visible jumps, so this is the assertion that keeps the derivation honest rather than quoted:
    // sweep the whole day and check no step ever skips a quantum of the key the sky is rebuilt on.
    it('never skips a sky-LUT quantum, which is what would make the sky jump', () => {
      let worst = 0;
      for (let hour = 0; hour < 24; hour += HOUR_REDRAW_STEP) {
        const moved = Math.abs(elevationRatio(hour + HOUR_REDRAW_STEP) - elevationRatio(hour));
        worst = Math.max(worst, moved * SKY_LUT_ELEVATION_STEPS);
      }

      expect(worst).toBeLessThanOrEqual(1);
    });

    it('is not so fine that it redraws every frame, which is the thing it exists to prevent', () => {
      // At SA's own day a step must be worth more than a frame: 0.0223 game hours is ~1.3 real seconds.
      const realSecondsPerStep = HOUR_REDRAW_STEP / SA_HOURS_PER_SECOND;

      expect(realSecondsPerStep).toBeGreaterThan(1);
    });
  });

  describe('positive cases', () => {
    it('rounds to the step the frame is redrawn on', () => {
      expect(quantizeHour(0)).toBeCloseTo(0, 10);
      expect(quantizeHour(HOUR_REDRAW_STEP * 3.4)).toBeCloseTo(HOUR_REDRAW_STEP * 3, 10);
    });

    it('runs SA’s own day: twenty-four hours in twenty-four minutes', () => {
      const afterOneMinute = hourFromAnchor(anchor(0, 0), 60_000);

      expect(afterOneMinute).toBeCloseTo(1, 6);
    });

    it('lets the operator pin the hour, and says that is what happened', () => {
      const pinned = resolveWorldHour(clock({ anchor: anchor(3, 0), operatorHour: 22 }), 0);

      expect(pinned).toEqual({ hour: 22, source: 'operator' });
    });

    it('falls back to a local day when no server has ever spoken', () => {
      const alone = resolveWorldHour(clock({ local: anchor(10, 0) }), 60_000);

      expect(alone.source).toBe('local');
      expect(alone.hour).toBeCloseTo(11, 6);
    });

    it('opens at the hour every 201 capture is taken at when nothing at all has spoken', () => {
      expect(resolveWorldHour(clock(), 0)).toEqual({ hour: DEFAULT_HOUR, source: 'local' });
    });

    it('puts two consoles that joined at different times on the same hour', () => {
      // The point of the whole module: one server, one anchor, two consoles that started minutes apart.
      const early = hourFromAnchor(anchor(14, 0), 300_000);
      const joinedLate = hourFromAnchor(anchor(early, 300_000), 300_000);

      expect(joinedLate).toBeCloseTo(early, 10);
    });
  });
});
