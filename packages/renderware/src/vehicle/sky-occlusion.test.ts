import { describe, expect, it } from 'vitest';

import { skyOcclusion } from './sky-occlusion';

/** A horizontal plate of `count` x `count` vertices at height `z`, spanning [-half, half] in x and y. */
function plate(half: number, z: number, count = 12): number[] {
  const out: number[] = [];
  for (let ix = 0; ix < count; ix += 1) {
    for (let iy = 0; iy < count; iy += 1) {
      out.push(-half + (2 * half * ix) / (count - 1), -half + (2 * half * iy) / (count - 1), z);
    }
  }

  return out;
}

/** Every vertex faces straight up — the plates below are horizontal. */
function up(count: number): number[] {
  return Array.from({ length: count * 3 }, (_, i) => (i % 3 === 2 ? 1 : 0));
}

describe('skyOcclusion', () => {
  describe('negative cases', () => {
    it('returns open sky for an empty model', () => {
      expect(skyOcclusion([], [], 0)).toEqual(new Uint8Array(0));
    });

    it('returns open sky when every vertex sits on one spot (no footprint to occlude)', () => {
      const occlusion = skyOcclusion([0, 0, 0, 0, 0, 1], [0, 0, 1, 0, 0, 1], 2);

      expect([...occlusion]).toEqual([255, 255]);
    });
  });

  describe('positive cases', () => {
    it('leaves a lone horizontal plate fully open to the sky', () => {
      const positions = plate(1, 0);
      const occlusion = skyOcclusion(positions, up(positions.length / 3), positions.length / 3);

      expect(Math.min(...occlusion)).toBe(255);
    });

    it('darkens the floor under a roof and leaves the roof itself open', () => {
      const floor = plate(1, 0);
      const roof = plate(1, 1);
      const positions = [...floor, ...roof];
      const occlusion = skyOcclusion(positions, up(positions.length / 3), positions.length / 3);
      const floorCount = floor.length / 3;
      const under = [...occlusion.subarray(0, floorCount)];
      const above = [...occlusion.subarray(floorCount)];

      // The middle of the floor is the most enclosed point there is.
      expect(Math.min(...under)).toBeLessThan(120);
      expect(Math.max(...under)).toBeLessThan(Math.min(...above));
      expect(Math.max(...above)).toBe(255);
    });

    it('leaves an open cabin open when the roof above it is not part of the shown shell', () => {
      const floor = plate(1, 0);
      const roof = plate(1, 1);
      const positions = [...floor, ...roof];
      const count = positions.length / 3;
      const shown = new Uint8Array(count); // only the floor casts — the "roof" is a hidden LOD blob
      shown.fill(1, 0, floor.length / 3);
      const occlusion = skyOcclusion(positions, up(count), count, shown);

      expect(Math.min(...occlusion.subarray(0, floor.length / 3))).toBe(255);
    });

    it('keeps a skin tilted slightly below horizontal bright next to a thin lip (085 comet smudges)', () => {
      // A vertical door skin whose normal points 15° DOWN, one cell inboard of a thin skirt lip that tops
      // out above it. Every azimuth weight is then a numerical scrap, and dividing occluded by their sum
      // used to swing the vertex to fully occluded — the black smudges on the comet's doors.
      const skin = [0, 0, 0];
      const lip = [-0.12, 0, 0.35];
      const spread = [...plate(1.5, -0.5, 4)]; // enough footprint for a real grid
      const positions = [...skin, ...lip, ...spread];
      const count = positions.length / 3;
      const normals = [-0.99, 0, -0.15, ...up(count - 1)];
      const occlusion = skyOcclusion(positions, normals, count);

      // Bright, not smudge-black: the scrap-ratio verdict put this vertex at ~42 of 255.
      expect(occlusion[0]).toBeGreaterThan(200);
    });

    it('never drops below the indirect floor', () => {
      const positions = [...plate(1, 0), ...plate(1, 4)];
      const occlusion = skyOcclusion(positions, up(positions.length / 3), positions.length / 3);

      expect(Math.min(...occlusion)).toBeGreaterThanOrEqual(Math.round(0.15 * 255));
    });
  });
});
