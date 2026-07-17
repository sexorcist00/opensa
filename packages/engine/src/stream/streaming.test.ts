import type { OspakManifest } from '@opensa/engine-formats';

import { describe, expect, it } from 'vitest';

import type { Engine } from '../engine';

import { StreamingDriver, type StreamingRadii } from './streaming';

function harness(
  cells: string[],
  radii: StreamingRadii = {},
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

    it('does not create more than one cell per update', () => {
      const h = harness(['3,3,lod', '4,3,lod'], { lodRadius: 2000 });
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.deliver('4,3,lod');
      h.driver.update([0, 0, 0]);

      expect(h.loaded).toHaveLength(1);
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
  });
});
