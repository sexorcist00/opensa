import { describe, expect, it, vi } from 'vitest';

import { AudioClock, type AudioClockHost, DEFAULT_TICK_HZ } from './audio-clock';

/** Time and timers a test drives by hand — no real clock, so the numbers are exact. */
function fakeHost(): AudioClockHost & { advance(ms: number): void; cancelled: number[]; fire(costMs?: number): void } {
  let time = 0;
  let scheduled: (() => void) | null = null;
  let interval = 0;
  const cancelled: number[] = [];
  let pendingCost = 0;

  return {
    advance: (ms) => {
      time += ms;
    },
    cancel: (handle) => {
      cancelled.push(handle);
      scheduled = null;
    },
    cancelled,
    /** Run one tick, charging it `costMs` of work. */
    fire: (costMs = 0) => {
      pendingCost = costMs;
      scheduled?.();
    },
    now: () => {
      const answer = time;
      // The clock reads `now` twice a tick — before and after the callback — so charging the cost to the
      // second read is what makes a tick "take" time without a real timer.
      time += pendingCost;
      pendingCost = 0;

      return answer;
    },
    schedule: (callback, intervalMs) => {
      scheduled = callback;
      interval = intervalMs;

      return interval;
    },
  };
}

describe('AudioClock', () => {
  describe('negative cases', () => {
    it('does not start a SECOND timer when started twice', () => {
      // Two clocks on one pool doubles the CPU line with no other symptom, so the second start is a no-op.
      const host = fakeHost();
      const schedule = vi.spyOn(host, 'schedule');
      const clock = new AudioClock(host);

      clock.start(() => undefined);
      clock.start(() => undefined);

      expect(schedule).toHaveBeenCalledTimes(1);
    });

    it('stopping a clock that never started is not an error', () => {
      const host = fakeHost();
      const clock = new AudioClock(host);

      clock.stop();

      expect(host.cancelled).toEqual([]);
      expect(clock.running).toBe(false);
    });

    it('reports a zero mean before it has ticked, rather than dividing by no ticks', () => {
      expect(new AudioClock(fakeHost()).report()).toEqual({ maxMs: 0, meanMs: 0, rateHz: DEFAULT_TICK_HZ, ticks: 0 });
    });
  });

  describe('positive cases', () => {
    it('ticks at the configured rate, and says which rate a row was taken at', () => {
      const host = fakeHost();
      const schedule = vi.spyOn(host, 'schedule');
      const clock = new AudioClock(host, { rateHz: 20 });

      clock.start(() => undefined);

      expect(schedule.mock.calls[0]?.[1]).toBe(50);
      expect(clock.report().rateHz).toBe(20);
    });

    it('hands the callback the REAL gap, not the nominal one — a throttled tab is honest', () => {
      const host = fakeHost();
      const clock = new AudioClock(host);
      const gaps: number[] = [];
      clock.start((dt) => gaps.push(dt));

      host.advance(1_000);
      host.fire();
      host.advance(100);
      host.fire();

      expect(gaps).toEqual([1, 0.1]);
    });

    it('times every tick, keeping the mean and the WORST', () => {
      const host = fakeHost();
      const clock = new AudioClock(host);
      clock.start(() => undefined);

      host.fire(1);
      host.fire(3);
      host.fire(2);

      expect(clock.report()).toMatchObject({ maxMs: 3, meanMs: 2, ticks: 3 });
    });

    it('keeps its measurements after it stops, because a capture is read afterwards', () => {
      const host = fakeHost();
      const clock = new AudioClock(host);
      clock.start(() => undefined);
      host.fire(2);

      clock.stop();

      expect(clock.running).toBe(false);
      expect(clock.report()).toMatchObject({ maxMs: 2, ticks: 1 });
    });

    it('runs ten times a second by default — 3 m of travel a tick at 30 m/s', () => {
      expect(DEFAULT_TICK_HZ).toBe(10);
    });
  });
});
