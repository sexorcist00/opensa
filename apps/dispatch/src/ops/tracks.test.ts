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
    it("answers with the LAST FIX between two samples — it does not slide (the user's call, 08-22)", () => {
      const tracks = new UnitTracks();
      drive(tracks, 20, 10);
      const midway = tracks.at('u0', 6000);

      // 10 u/s at a 4 s rate: the fix at t=4 s puts the unit at x=40, and t=6 s is still that fix. A slide
      // would answer 60 — smooth, confident, and a position nobody reported.
      expect(midway?.at[0]).toBeCloseTo(40, 0);
      expect(midway?.stale).toBe(false);
      expect(midway?.ageMs).toBe(0);
    });

    it('gives every unit status a distinct stored id — an unknown one wrote 255 and replayed as available', () => {
      const tracks = new UnitTracks();
      const statuses: Unit['status'][] = ['available', 'busy', 'enRoute', 'onScene'];
      for (const [i, status] of statuses.entries()) {
        tracks.record(board(i * SAMPLE_INTERVAL_MS, [{ at: [i, 0], status }]));
      }

      // Each reads back as itself. Before the ids were exhaustive by type, a status outside the table
      // stored 255, came back `available`, and sampled on every tick instead of every 4 s.
      for (const [i, status] of statuses.entries()) {
        expect(tracks.at('u0', i * SAMPLE_INTERVAL_MS)?.status).toBe(status);
      }
      expect(tracks.stats().samples).toBe(statuses.length);
    });

    it('samples a status change immediately, whatever the rate limit says', () => {
      const tracks = new UnitTracks();
      tracks.record(board(0, [{ at: [0, 0], status: 'available' }]));
      tracks.record(board(100, [{ at: [0, 0], status: 'enRoute' }]));

      expect(tracks.stats().samples).toBe(2);
      expect(tracks.at('u0', 100)?.status).toBe('enRoute');
    });

    it('carries the heading of the fix it answers with, unblended', () => {
      const tracks = new UnitTracks();
      tracks.record(board(0, [{ at: [0, 0], heading: 0.1 }]));
      tracks.record(board(SAMPLE_INTERVAL_MS, [{ at: [40, 0], heading: Math.PI * 2 - 0.1 }]));

      // No blend, so no wrap-around question to get wrong: each answer is one recorded heading.
      expect(tracks.at('u0', SAMPLE_INTERVAL_MS / 2)?.heading).toBeCloseTo(0.1, 5);
      expect(tracks.at('u0', SAMPLE_INTERVAL_MS)?.heading).toBeCloseTo(Math.PI * 2 - 0.1, 5);
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
