import { describe, expect, it } from 'vitest';

import type { Operations, Unit } from './types';

import { UNITS_ON_SCREEN } from './budget';
import { BYTES_PER_SAMPLE, SAMPLE_INTERVAL_MS, SAMPLES_PER_TRACK, UnitTracks } from './tracks';

function board(now: number, units: readonly Partial<Unit>[]): Operations {
  return {
    incidents: [],
    log: [],
    now,
    units: units.map((unit, index) => ({
      at: [0, 0],
      callsign: `U${index}`,
      heading: 0,
      id: `u${index}`,
      incident: null,
      kind: 'patrol',
      status: 'available',
      target: null,
      ...unit,
    })),
  };
}

/** Drive one unit along +x at `speed` world units per second, ticking at 20 Hz like the app does. */
function drive(tracks: UnitTracks, seconds: number, speed: number, from = 0): void {
  for (let ms = from; ms <= from + seconds * 1000; ms += 50) {
    tracks.record(board(ms, [{ at: [(ms / 1000) * speed, 0] }]));
  }
}

describe('UnitTracks', () => {
  describe('negative cases', () => {
    it('answers null for a unit it has never seen', () => {
      expect(new UnitTracks().at('nobody', 0)).toBeNull();
    });

    it('does NOT extrapolate past the last sample — it holds, and says how old the answer is', () => {
      const tracks = new UnitTracks();
      drive(tracks, 20, 10);
      const last = tracks.at('u0', 20_000);

      const later = tracks.at('u0', 80_000);
      expect(later?.at).toEqual(last?.at);
      expect(later?.stale).toBe(true);
      expect(later?.ageMs).toBeGreaterThan(55_000);
    });

    it('is not stale inside one publish interval — a fix that has not arrived yet is not a lie', () => {
      const tracks = new UnitTracks();
      drive(tracks, 20, 10);

      expect(tracks.at('u0', 20_000 + SAMPLE_INTERVAL_MS - 1)?.stale).toBe(false);
    });

    it('answers the first sample before the track starts, rather than nothing', () => {
      const tracks = new UnitTracks();
      tracks.record(board(10_000, [{ at: [100, 200] }]));

      expect(tracks.at('u0', 0)?.at).toEqual([100, 200]);
    });

    it('records at the PUBLISH rate, not the tick rate — 20 Hz in must not be 20 Hz stored', () => {
      const tracks = new UnitTracks();
      drive(tracks, 60, 10);

      // 60 s at one sample per 4 s, plus the first: nothing like the 1201 ticks that went in.
      expect(tracks.stats().samples).toBeLessThanOrEqual(60_000 / SAMPLE_INTERVAL_MS + 2);
      expect(tracks.stats().samples).toBeGreaterThan(10);
    });

    it('collapses a stationary run to its two ends — a parked shift is not 7200 samples', () => {
      const tracks = new UnitTracks();
      for (let ms = 0; ms <= 3_600_000; ms += 1000) {
        tracks.record(board(ms, [{ at: [500, -500] }]));
      }

      expect(tracks.stats().samples).toBe(2);
      expect(tracks.at('u0', 1_800_000)?.at).toEqual([500, -500]);
    });

    it('drops the oldest sample when the ring wraps rather than growing', () => {
      const tracks = new UnitTracks(4);
      drive(tracks, 40, 10);
      const stats = tracks.stats();

      expect(stats.samples).toBe(4);
      expect(stats.bytes).toBe(4 * BYTES_PER_SAMPLE);
    });

    it('forgets a unit that went off duty', () => {
      const tracks = new UnitTracks();
      tracks.record(board(0, [{ at: [1, 2] }]));
      tracks.forget('u0');

      expect(tracks.at('u0', 0)).toBeNull();
      expect(tracks.stats().tracks).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('interpolates between two received samples', () => {
      const tracks = new UnitTracks();
      drive(tracks, 20, 10);
      const midway = tracks.at('u0', 6000);

      // 10 u/s: at t=6 s the unit is at x=60, between the 4 s and 8 s samples.
      expect(midway?.at[0]).toBeCloseTo(60, 0);
      expect(midway?.stale).toBe(false);
      expect(midway?.ageMs).toBe(0);
    });

    it('samples a status change immediately, whatever the rate limit says', () => {
      const tracks = new UnitTracks();
      tracks.record(board(0, [{ at: [0, 0], status: 'available' }]));
      tracks.record(board(100, [{ at: [0, 0], status: 'enRoute' }]));

      expect(tracks.stats().samples).toBe(2);
      expect(tracks.at('u0', 100)?.status).toBe('enRoute');
    });

    it('takes the short way round when a heading crosses north', () => {
      const tracks = new UnitTracks();
      tracks.record(board(0, [{ at: [0, 0], heading: 0.1 }]));
      tracks.record(board(SAMPLE_INTERVAL_MS, [{ at: [40, 0], heading: Math.PI * 2 - 0.1 }]));
      const midway = tracks.at('u0', SAMPLE_INTERVAL_MS / 2);

      // Halfway between +0.1 and -0.1 is 0, not π. A blend through the long way would land near 3.14.
      expect(Math.abs(Math.atan2(Math.sin(midway?.heading ?? 0), Math.cos(midway?.heading ?? 0)))).toBeLessThan(0.05);
    });

    it('reports the window it holds, so a scrub knows what it may ask for', () => {
      const tracks = new UnitTracks();
      drive(tracks, 30, 10);

      expect(tracks.stats().window?.[0]).toBe(0);
      expect(tracks.stats().window?.[1]).toBeGreaterThanOrEqual(28_000);
    });
  });
});

describe('UnitTracks cost', () => {
  describe('positive cases', () => {
    it('prices the declared worst case: 150 units, one shift, at the publish rate', () => {
      const tracks = new UnitTracks();
      tracks.record(
        board(
          0,
          Array.from({ length: UNITS_ON_SCREEN }, () => ({})),
        ),
      );
      const { bytes } = tracks.stats();

      expect(bytes).toBe(UNITS_ON_SCREEN * SAMPLES_PER_TRACK * BYTES_PER_SAMPLE);
      // 17.51 MB, measured against a real `arrayBuffers` delta in
      // docs/benchmarks/opensa-engine/2026-08-22-dispatch-track-memory.json. HOST bytes, never the GPU
      // residency ceiling.
      expect(bytes / (1024 * 1024)).toBeCloseTo(17.51, 1);
    });
  });
});
