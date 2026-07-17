import type { OspakManifest } from '@opensa/engine-formats';

import { describe, expect, it } from 'vitest';

import type { Engine } from '../engine';

import { StreamingDriver, type StreamingRadii } from './streaming';

function harness(
  cells: string[],
  radii: StreamingRadii = {},
  fogCutDistance = 2400,
): {
  deliver: (key: string) => void;
  driver: StreamingDriver;
  loaded: string[];
  requested: string[];
  unloaded: string[];
} {
  const loaded: string[] = [];
  const unloaded: string[] = [];
  const requested: string[] = [];
  const engine = {
    cells: {
      load: (key: string): void => {
        loaded.push(key);
      },
      unload: (key: string): void => {
        unloaded.push(key);
      },
    },
    environment: { fogCutDistance },
  } as unknown as Engine;
  let onMessage: ((event: { data: unknown }) => void) | null = null;
  const worker = {
    addEventListener: (_type: string, listener: (event: { data: unknown }) => void): void => {
      onMessage = listener;
    },
    postMessage: (message: { key: string }): void => {
      requested.push(message.key);
    },
  } as unknown as Worker;
  const driver = new StreamingDriver(engine, manifestWith(cells), worker, radii);

  return {
    deliver: (key: string): void => {
      onMessage?.({ data: { buffer: new ArrayBuffer(4), key, type: 'blob' } });
    },
    driver,
    loaded,
    requested,
    unloaded,
  };
}

/** Minimal manifest: one 250 u cell at grid (3,3) with both levels (engine rect x[750,1000] z[−1000,−750]). */
function manifestWith(cells: string[]): OspakManifest {
  const entries: OspakManifest['cells'] = {};
  for (const key of cells) {
    entries[key] = { hash: 0, length: 4, offset: 0 };
  }

  return { byteLength: 4096, cells: entries, cellSize: 250, textures: {}, version: 1 };
}

describe('StreamingDriver rings (074/21 P1)', () => {
  describe('negative cases', () => {
    it('does not request a cell whose rect sits outside the LOD ring', () => {
      // Rect closest point (750, −750) → 1060.7 from origin; ring 1000 leaves it out.
      const h = harness(['3,3,lod'], { lodRadius: 1000 });
      h.driver.update([0, 0, 0]);

      expect(h.requested).toEqual([]);
    });

    it('creates at most two cells per update even when more are delivered (the adaptive budget cap)', () => {
      const h = harness(['3,3,lod', '4,3,lod', '5,3,lod'], { lodRadius: 2000 });
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.deliver('4,3,lod');
      h.deliver('5,3,lod');
      h.driver.update([0, 0, 0]);

      // Test creates are ~0 ms, so the time budget admits the second — never a third.
      expect(h.loaded).toHaveLength(2);

      h.driver.update([0, 0, 0]);

      expect(h.loaded).toHaveLength(3);
    });

    it('does not prefetch ahead of a STATIC focus (velocity decays to zero)', () => {
      // Rect closest point from (100, −100) → 919.2; ring 800 leaves it out while nothing moves.
      const h = harness(['3,3,lod'], { lodRadius: 800 });
      for (let step = 0; step < 30; step += 1) {
        h.driver.update([100, 0, -100]);
      }

      expect(h.requested).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('requests a cell whose CENTRE is outside the ring but whose rect is inside (the half-diagonal guarantee)', () => {
      // Centre (875, −875) → 1237.4 > 1200; rect closest point → 1060.7 < 1200. The old centre test
      // would leave this cell unloaded with its corner geometry ~140 u inside the ring.
      const h = harness(['3,3,lod'], { lodRadius: 1200 });
      h.driver.update([0, 0, 0]);

      expect(h.requested).toEqual(['3,3,lod']);
    });

    it('honors a custom lodRadius (the drawDistance knob)', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1400 });
      h.driver.update([0, 0, 0]);

      expect(h.requested).toEqual(['3,3,lod']);
    });

    it('creates a delivered cell and evicts it once the rect leaves ring + margin', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1200 });
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.driver.update([0, 0, 0]);

      expect(h.loaded).toEqual(['3,3,lod']);

      // Teleport far away: rect distance ≫ 1200 + 150 → unload.
      h.driver.update([10000, 0, 0]);

      expect(h.unloaded).toEqual(['3,3,lod']);
    });

    it('promotes to HD by centre distance when the focus stands in the cell', () => {
      const h = harness(['3,3,hd', '3,3,lod']);
      h.driver.update([875, 0, -875]);

      expect(h.requested).toEqual(['3,3,hd']);
    });

    it('prefetches a cell ahead of a MOVING focus before the true ring reaches it (074/21 P3)', () => {
      // Same spot as the static test — but arrived at speed: the smoothed velocity biases the request
      // focus ahead, and the cell is fetched while the TRUE rect distance (919) is still outside 800.
      const h = harness(['3,3,lod'], { lodRadius: 800 });
      for (let step = 0; step <= 10; step += 1) {
        h.driver.update([step * 10, 0, -step * 10]);
      }

      expect(h.requested).toEqual(['3,3,lod']);
    });

    it('counts a create inside the fog cut as LATE — but graces boot and teleports (074/21 P3)', () => {
      // fogCut 2000 > the cell's 1060 rect distance: this create is inside the visible zone.
      const h = harness(['3,3,lod'], { lodRadius: 1200 }, 2000);
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.driver.update([0, 0, 0]);

      // Boot grace: the initial fill is not a pop.
      expect(h.driver.update([0, 0, 0]).lateCreates).toBe(0);

      // Teleport far away (evicts), then teleport BACK: the recreate is graced too.
      h.driver.update([10000, 0, 0]);
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.driver.update([0, 0, 0]);

      expect(h.driver.update([0, 0, 0]).lateCreates).toBe(0);
    });

    it('counts a late create once steady streaming resumes after the grace closes', () => {
      // Two cells; the far one (5,3 — rect 1600) stays outside the 1200 ring until the focus WALKS
      // toward it in sub-teleport steps; with fogCut 2000 its create then lands inside the visible zone.
      const h = harness(['3,3,lod', '5,3,lod'], { lodRadius: 1200 }, 2000);
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.driver.update([0, 0, 0]);
      h.driver.update([0, 0, 0]); // grace closes here (nothing pending)
      for (let step = 1; step <= 2; step += 1) {
        h.driver.update([step * 200, 0, 0]); // 200 u steps — motion, not teleports
      }
      h.deliver('5,3,lod');
      const stats = h.driver.update([400, 0, 0]);

      expect(stats.lateCreates).toBe(1);
    });
  });
});
