import type { OspakManifest } from '@opensa/engine-formats';

import { describe, expect, it } from 'vitest';

import type { Engine } from '../engine';

import { StreamingDriver, type StreamingRadii } from './streaming';

function harness(
  cells: string[],
  radii: StreamingRadii = {},
  fogCutDistance = 2400,
  /** Per-cell texture-array refs (003 phase 4). Omit to model a pre-`textures` pak (eager, legacy). */
  cellTextures?: Record<string, number[]>,
): {
  deliver: (key: string) => void;
  driver: StreamingDriver;
  liveArrays: () => number[];
  loaded: string[];
  loadedArrays: string[];
  requested: string[];
  unloaded: string[];
  unloadedArrays: number[];
} {
  const loaded: string[] = [];
  const unloaded: string[] = [];
  const requested: string[] = [];
  const loadedArrays: string[] = [];
  const unloadedArrays: number[] = [];
  const live = new Set<number>();
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
    textures: {
      has: (ref: number): boolean => live.has(ref),
      load: (ref: number): void => {
        live.add(ref);
        loadedArrays.push(`array-${ref}`);
      },
      unload: (ref: number): void => {
        live.delete(ref);
        unloadedArrays.push(ref);
      },
    },
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
  const driver = new StreamingDriver(engine, manifestWith(cells, cellTextures), worker, radii);

  return {
    deliver: (key: string): void => {
      onMessage?.({ data: { buffer: new ArrayBuffer(4), key, type: 'blob' } });
    },
    driver,
    liveArrays: (): number[] => [...live].sort((a, b) => a - b),
    loaded,
    loadedArrays,
    requested,
    unloaded,
    unloadedArrays,
  };
}

/** Minimal manifest: one 250 u cell at grid (3,3) with both levels (engine rect x[750,1000] z[−1000,−750]). */
function manifestWith(cells: string[], cellTextures?: Record<string, number[]>): OspakManifest {
  const entries: OspakManifest['cells'] = {};
  const arrays: OspakManifest['textures'] = {};
  for (const key of cells) {
    const refs = cellTextures?.[key];
    entries[key] = { hash: 0, length: 4, offset: 0, ...(refs ? { textures: refs } : {}) };
    for (const ref of refs ?? []) {
      arrays[`array-${ref}`] = { format: 0, hash: 0, height: 4, layers: 1, length: 4, offset: 0, width: 4 };
    }
  }

  return { byteLength: 4096, cells: entries, cellSize: 250, textures: arrays, version: 1 };
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

/**
 * Per-ring texture residency (003 phase 4). The invariant that matters: a cell is never recorded against an
 * array that is not uploaded — `CellStore` binds `textures.get(ref)` while building the bundle and throws
 * on a miss — and an array outlives exactly as long as some loaded cell still draws with it.
 */
describe('StreamingDriver texture residency', () => {
  describe('negative cases', () => {
    it('does not create a cell whose arrays have not arrived yet', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1200 }, 2400, { '3,3,lod': [7] });
      h.driver.update([0, 0, 0]); // requests the cell AND array-7
      h.deliver('3,3,lod'); // the cell blob lands first

      h.driver.update([0, 0, 0]);

      expect(h.loaded).toEqual([]); // still waiting on array-7
      expect(h.requested).toContain('array-7');
    });

    it('loads nothing up-front — an array arrives only with the cell that needs it', () => {
      const h = harness(['3,3,lod', '9,9,lod'], { lodRadius: 1200 }, 2400, {
        '3,3,lod': [1],
        '9,9,lod': [2], // far away: its array must never be fetched
      });

      h.driver.update([0, 0, 0]);

      expect(h.requested).toContain('array-1');
      expect(h.requested).not.toContain('array-2');
    });

    it('keeps an array a second loaded cell still draws with', () => {
      const h = harness(['3,3,lod', '4,3,lod'], { lodRadius: 1600 }, 2400, {
        '3,3,lod': [5],
        '4,3,lod': [5], // shared
      });
      for (const key of ['3,3,lod', '4,3,lod']) {
        h.driver.update([0, 0, 0]);
        h.deliver(key);
        h.deliver('array-5');
        h.driver.update([0, 0, 0]);
      }
      expect(h.loaded).toEqual(['3,3,lod', '4,3,lod']);

      h.driver.update([10000, 0, 0]); // evicts BOTH — but only after both are gone may the array die

      expect(h.unloadedArrays).toEqual([5]);
      expect(h.liveArrays()).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('creates the cell once its arrays are uploaded', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1200 }, 2400, { '3,3,lod': [7] });
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.deliver('array-7');

      h.driver.update([0, 0, 0]);

      expect(h.loaded).toEqual(['3,3,lod']);
      expect(h.liveArrays()).toEqual([7]);
    });

    it('releases the array when the last cell drawing with it is evicted', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1200 }, 2400, { '3,3,lod': [7] });
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.deliver('array-7');
      h.driver.update([0, 0, 0]);

      h.driver.update([10000, 0, 0]); // far outside the ring + evict margin

      expect(h.unloaded).toEqual(['3,3,lod']);
      expect(h.unloadedArrays).toEqual([7]);
      expect(h.liveArrays()).toEqual([]);
    });

    it('keeps a shared array alive across an HD↔LOD swap instead of destroying and refetching it', () => {
      // The claim-before-release rule: both levels of one cell draw with array-3, so the swap must not
      // let its user count touch zero.
      const h = harness(['3,3,hd', '3,3,lod'], { hdRadius: 1200, lodRadius: 1600 }, 2400, {
        '3,3,hd': [3],
        '3,3,lod': [3],
      });
      // Stand IN the cell (centre 875, −875) so HD is the desired level.
      h.driver.update([875, 0, -875]);
      h.deliver('3,3,hd');
      h.deliver('array-3');
      h.driver.update([875, 0, -875]);
      expect(h.loaded).toEqual(['3,3,hd']);

      // Move out past the HD edge + hysteresis (centre 1400 > 1260) while the rect (1275) holds the LOD ring.
      const away: [number, number, number] = [2275, 0, -875];
      h.driver.update(away);
      h.deliver('3,3,lod');
      h.driver.update(away);

      expect(h.loaded).toEqual(['3,3,hd', '3,3,lod']);
      expect(h.unloadedArrays).toEqual([]); // never released mid-swap
      expect(h.loadedArrays).toEqual(['array-3']); // and therefore never re-fetched
    });

    it('still works on a pre-`textures` pak — nothing to wait for, nothing to release', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1200 });
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');

      h.driver.update([0, 0, 0]);

      expect(h.loaded).toEqual(['3,3,lod']);
      expect(h.requested.filter((key) => key.startsWith('array-'))).toEqual([]);
    });
  });
});

describe('StreamingDriver manual cells (the map inspector, 074/22)', () => {
  describe('negative cases', () => {
    it('does not load a cell outside the pinned set even when it sits under the focus', () => {
      const h = harness(['3,3,lod', '4,3,lod'], { lodRadius: 2000 });
      h.driver.setManualCells([[4, 3]], true);
      h.driver.update([875, 0, -875]); // standing inside cell 3,3

      expect(h.requested).toEqual(['4,3,lod']);
    });

    it('does not offer a level the pinned cell lacks', () => {
      const h = harness(['3,3,lod'], { lodRadius: 2000 });
      h.driver.setManualCells([[3, 3]]); // asks for HD; the pak has LOD only
      h.driver.update([0, 0, 0]);

      expect(h.requested).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('loads exactly the pinned cell, ignoring the rings entirely', () => {
      // Rect closest point is 1060.7 away — outside this ring, so only the pin can bring it in.
      const h = harness(['3,3,lod'], { lodRadius: 1000 });
      h.driver.setManualCells([[3, 3]], true);
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.driver.update([0, 0, 0]);

      expect(h.loaded).toEqual(['3,3,lod']);
    });

    it('evicts a deselected cell even while it sits well inside the ring', () => {
      const h = harness(['3,3,lod'], { lodRadius: 2000 });
      h.driver.setManualCells([[3, 3]], true);
      h.driver.update([875, 0, -875]);
      h.deliver('3,3,lod');
      h.driver.update([875, 0, -875]);

      h.driver.setManualCells([], true);
      h.driver.update([875, 0, -875]);

      expect(h.unloaded).toEqual(['3,3,lod']);
    });

    it('returns to focus-driven streaming when the pin is cleared', () => {
      const h = harness(['3,3,lod'], { lodRadius: 2000 });
      h.driver.setManualCells([], true);
      h.driver.update([875, 0, -875]);
      expect(h.requested).toEqual([]);

      h.driver.setManualCells(null);
      h.driver.update([875, 0, -875]);

      expect(h.requested).toEqual(['3,3,lod']);
    });

    it('lists every cell the pak offers, once per grid coord', () => {
      const h = harness(['3,3,hd', '3,3,lod', '4,3,lod']);

      expect(h.driver.listCells().sort()).toEqual([
        [3, 3],
        [4, 3],
      ]);
    });
  });
});
