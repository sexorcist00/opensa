import { describe, expect, it } from 'vitest';

import { GAP_SECONDS, PANEL_TONES, renderTone, toneSeconds } from './tones';

/** The largest absolute sample in a rendered tone. */
function peak(samples: Float32Array): number {
  let most = 0;
  for (const sample of samples) {
    most = Math.max(most, Math.abs(sample));
  }

  return most;
}

describe('renderTone', () => {
  describe('negative cases', () => {
    it('FADES in rather than starting, because a bare sine switched on is a click', () => {
      // `samples[0] === 0` proves nothing: sin(0) is zero with or without an envelope. What an attack does
      // is hold the first cycles down — at 880 Hz a period is 1.14 ms and the attack is 4 ms, so the first
      // millisecond must be well under the tone's own level.
      const samples = renderTone([{ gain: 1, hz: 880, seconds: 0.15 }], 48_000);
      const firstMs = peak(samples.slice(0, 48));

      expect(firstMs).toBeLessThan(0.35);
      expect(peak(samples)).toBeGreaterThan(0.9);
    });

    it('fades OUT too — a tone that stops is the same click at the other end', () => {
      const samples = renderTone([{ gain: 1, hz: 880, seconds: 0.15 }], 48_000);
      const lastMs = peak(samples.slice(samples.length - 48));

      expect(lastMs).toBeLessThan(0.35);
    });

    it('never leaves a pulse louder than it was authored at', () => {
      const samples = renderTone([{ gain: 0.5, hz: 880, seconds: 0.1 }], 48_000);

      expect(peak(samples)).toBeLessThanOrEqual(0.5);
      expect(peak(samples)).toBeGreaterThan(0.45);
    });

    it('is one sample rather than nothing for an empty spec', () => {
      // A name with no tone must still produce a buffer: `createBuffer(1, 0, rate)` throws.
      expect(renderTone([], 48_000)).toHaveLength(1);
      expect(toneSeconds([])).toBe(0);
    });

    it('puts real silence between pulses, so three reads as three', () => {
      const spec = [
        { gain: 1, hz: 880, seconds: 0.1 },
        { gain: 1, hz: 880, seconds: 0.1 },
      ];
      const samples = renderTone(spec, 48_000);
      const midGap = Math.round((0.1 + GAP_SECONDS / 2) * 48_000);

      expect(samples[midGap]).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('is deterministic to the sample — the same spec renders the same bytes', () => {
      const spec = PANEL_TONES.link_lost ?? [];

      expect([...renderTone(spec, 24_000)]).toEqual([...renderTone(spec, 24_000)]);
    });

    it('lasts what its pulses and gaps add up to, at any rate', () => {
      const spec = PANEL_TONES.call_created_p1 ?? [];

      for (const rate of [12_000, 48_000]) {
        expect(renderTone(spec, rate).length / rate).toBeCloseTo(toneSeconds(spec), 3);
      }
    });

    it('actually carries the frequency it was asked for', () => {
      // Zero crossings over a held pulse: a 1000 Hz tone for 0.1 s crosses about 200 times.
      const samples = renderTone([{ gain: 1, hz: 1_000, seconds: 0.1 }], 48_000);
      let crossings = 0;
      for (let at = 1; at < samples.length; at += 1) {
        if (Math.sign(samples[at] ?? 0) !== Math.sign(samples[at - 1] ?? 0)) {
          crossings += 1;
        }
      }

      expect(crossings).toBeGreaterThan(180);
      expect(crossings).toBeLessThan(220);
    });

    it('codes priority by REPETITION rather than by level', () => {
      const [p1, p2, p3] = [PANEL_TONES.call_created_p1, PANEL_TONES.call_created_p2, PANEL_TONES.call_created_p3];

      // Three pulses, two, one — urgency without volume, which is what a priority is.
      expect(p1?.length).toBe(3);
      expect(p2?.length).toBe(2);
      expect(p3?.length).toBe(1);
      expect(toneSeconds(p1 ?? [])).toBeGreaterThan(toneSeconds(p3 ?? []));
    });

    it('gives the two floored events the longest, most insistent shapes', () => {
      // panic and link_lost are what the whole chain exists to deliver; they may not sound like a chime.
      expect(toneSeconds(PANEL_TONES.panic_button ?? [])).toBeGreaterThan(toneSeconds(PANEL_TONES.notification ?? []));
      expect(toneSeconds(PANEL_TONES.link_lost ?? [])).toBeGreaterThan(toneSeconds(PANEL_TONES.notification ?? []));
    });

    it('has a tone for every name the contract gives an event', () => {
      // A name with no tone is a silent alert, which is the one thing the floor exists to prevent.
      for (const name of [
        'alpr_hit',
        'assist_request',
        'bolo_new',
        'call_closed',
        'call_created_p1',
        'call_created_p2',
        'call_created_p3',
        'incident_created',
        'link_back',
        'link_lost',
        'notification',
        'panic_button',
        'simplex_accepted',
        'simplex_declined',
        'simplex_request',
        'unit_arrived',
        'unit_assigned',
        'unit_stale',
      ]) {
        expect(PANEL_TONES[name], name).toBeDefined();
      }
    });
  });
});
