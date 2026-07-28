import { describe, expect, it } from 'vitest';

import { CABIN_LEVELS, cabinLight } from './cabin';

/**
 * A toy car, model space with z up: two glass vertices marking a greenhouse from y −1…1, x −1…1, up to
 * z 1.2, and then the candidate vertices per case. The hubs sit at z −0.3, so the lamp hangs near the
 * FRONT of whatever cabin the case describes (+y is forward).
 */
const GLASS: [number, number, number][] = [
  [-1, 1, 1.2],
  [1, -1, 0.6],
];
const HUB = -0.3;

interface Row {
  glass?: boolean;
  position: [number, number, number];
  sky: number;
}

/** One quad (two triangles) over the four candidate rows — enough for the neighbour fill to read. */
const QUAD = [0, 1, 2, 0, 2, 3];

function levelsOf(
  rows: readonly Row[],
  indices: readonly number[] = [],
  excludedIndex: null | number = null,
): number[] {
  const all: Row[] = [...GLASS.map((position) => ({ glass: true, position, sky: 0.95 })), ...rows];
  const excluded = new Uint8Array(all.length);
  if (excludedIndex !== null) {
    excluded[GLASS.length + excludedIndex] = 1;
  }
  const light = cabinLight(
    all.flatMap((row) => row.position),
    Uint8Array.from(all, (row) => Math.round(row.sky * 255)),
    Uint8Array.from(all, (row) => (row.glass ? 1 : 0)),
    HUB,
    excluded,
    indices.map((index) => GLASS.length + index),
  );

  return [...light].slice(GLASS.length);
}

/** Whether each candidate is lit at all — most cases only care about membership. */
function litOf(rows: readonly Row[], indices: readonly number[] = [], excludedIndex: null | number = null): number[] {
  return levelsOf(rows, indices, excludedIndex).map((level) => (level > 0 ? 1 : 0));
}

describe('cabinLight', () => {
  describe('negative cases', () => {
    it('lights nothing in a model with no glass at all (a bike, an open boat)', () => {
      const light = cabinLight([0, 0, 0.2], Uint8Array.of(120), Uint8Array.of(0), HUB, Uint8Array.of(0), []);

      expect([...light]).toEqual([0]);
    });

    it('leaves the SHELL around the cabin alone — a roof skin shares the volume but sees the sky', () => {
      // The one clause that separates an interior from the panel enclosing it: measured on the previon,
      // cabin vertices sit at 0.32-0.69 and the skins at 0.90-1.00.
      expect(litOf([{ position: [0, 0, 1.1], sky: 0.95 }])).toEqual([0]);
    });

    it('leaves everything BELOW the wheel hubs alone — underbody, wheel well and engine bay are enclosed too', () => {
      expect(litOf([{ position: [0, 0, -0.6], sky: 0.4 }])).toEqual([0]);
    });

    it('leaves what stands OUTSIDE the greenhouse alone — the engine bay ahead of the windscreen', () => {
      expect(litOf([{ position: [0, 1.9, 0.2], sky: 0.4 }])).toEqual([0]);
    });

    it('never lights a vertex the builder excluded (a wheel top stands inside the volume)', () => {
      expect(litOf([{ position: [0.9, -0.9, 0.1], sky: 0.4 }], [], 0)).toEqual([0]);
    });

    it('never lights the GLASS itself', () => {
      expect(litOf([{ glass: true, position: [0, 0, 0.2], sky: 0.4 }])).toEqual([0]);
    });

    it('clears a LONE cabin vertex stranded among shell neighbours', () => {
      // The occlusion bake is noisy over organic geometry; thresholded, that noise becomes speckle, and
      // speckle is what painted hard polygonal patches across the previon's seats.
      const shell = { sky: 0.95 };

      expect(
        litOf(
          [
            { position: [-0.2, 0.9, 0.2], sky: 0.4 }, // the only vertex the volume test accepts
            { position: [0.2, 0.9, 0.2], ...shell },
            { position: [0.2, -0.1, 0.2], ...shell },
            { position: [-0.2, -0.1, 0.2], ...shell },
          ],
          QUAD,
        ),
      ).toEqual([0, 0, 0, 0]);
    });

    it('will not fill an EXCLUDED vertex however enclosed its neighbourhood looks', () => {
      const cabin = { sky: 0.4 };
      const levels = levelsOf(
        [
          { position: [-0.2, 0.9, 0.2], sky: 0.95 }, // excluded AND failing on its own
          { position: [0.2, 0.9, 0.2], ...cabin },
          { position: [0.2, -0.1, 0.2], ...cabin },
          { position: [-0.2, -0.1, 0.2], ...cabin },
        ],
        QUAD,
        0,
      );

      expect(levels[0]).toBe(0);
      expect(levels[1]).toBeGreaterThan(0);
    });
  });

  describe('positive cases', () => {
    it('closes a HOLE the noisy bake left inside a cabin — a lit seat may not have dark triangles in it', () => {
      const cabin = { sky: 0.4 };
      const levels = levelsOf(
        [
          { position: [-0.2, 0.9, 0.2], sky: 0.95 }, // the hole: bright enough to fail the threshold alone
          { position: [0.2, 0.9, 0.2], ...cabin },
          { position: [0.2, -0.1, 0.2], ...cabin },
          { position: [-0.2, -0.1, 0.2], ...cabin },
        ],
        QUAD,
      );

      expect(levels[0]).toBeGreaterThan(0); // its neighbours carried it
      expect(levels[0]).toBe(levels[1]); // and it is lit like the vertex beside it, not as a seam
    });

    it('measures each vertex OUT from the lamp — the dash sits at level 1, the rear seat far from it', () => {
      // The lamp hangs near the FRONT of the cabin's own box, and the baked value is a DISTANCE (the shader
      // owns the falloff), so it grows toward the back and saturates at the last level.
      const [front, middle, back] = levelsOf([
        { position: [0, 0.9, 0.1], sky: 0.4 },
        { position: [0, 0.1, 0.1], sky: 0.4 },
        { position: [0, -0.9, 0.1], sky: 0.4 },
      ]);

      expect(front).toBeLessThan(middle);
      expect(middle).toBeLessThan(back);
      expect(front).toBeGreaterThan(0); // 0 is reserved for "not cabin at all"
      expect(back).toBeLessThanOrEqual(CABIN_LEVELS);
    });
  });
});
