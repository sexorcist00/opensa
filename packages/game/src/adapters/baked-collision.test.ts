import type { Oscol, OscolRegion } from '@opensa/engine-formats';

import { decodeOscol, encodeOscol } from '@opensa/engine-formats';
import { describe, expect, it } from 'vitest';

import { bakedModelColliders } from './baked-collision';

/** Through the container, the way the runtime meets it: pak bytes in, colliders out. */
function decoded(cell: Oscol): ReturnType<typeof bakedModelColliders> {
  return bakedModelColliders(decodeOscol(encodeOscol(cell)));
}

/** One region with a triangle pair, a box, a sphere and two placements — the shapes a cell actually holds. */
function region(overrides: Partial<OscolRegion> = {}): OscolRegion {
  return {
    boxes: [{ material: 7, max: [1, 2, 3], min: [-1, -2, -3] }],
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    materials: Uint8Array.from([4, 17]),
    name: 'roads32_law2',
    spheres: [{ center: [0, 0, 2], material: 9, radius: 1.5 }],
    transforms: [Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12.5, -3, 7, 1])],
    vertices: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    ...overrides,
  };
}

describe('bakedModelColliders', () => {
  describe('negative cases', () => {
    it('leaves an empty cell empty — "nothing here" is a legitimate bake', () => {
      expect(decoded({ regions: [] })).toEqual([]);
    });

    it('keeps an absent surface table ABSENT rather than inventing surface 0', () => {
      const bare = region();
      delete bare.materials;

      const [model] = decoded({ regions: [bare] });

      expect(model.shape.materials).toBeUndefined();
    });

    it('does not invent a surface id for a primitive the source had none for', () => {
      const [model] = decoded({
        regions: [region({ boxes: [{ max: [1, 1, 1], min: [0, 0, 0] }], spheres: [{ center: [0, 0, 0], radius: 1 }] })],
      });

      expect(model.shape.boxes[0].material).toBeUndefined();
      expect(model.shape.spheres[0].material).toBeUndefined();
    });

    it('carries no instance keys for a model that does not shatter — the adapter tags those', () => {
      expect(decoded({ regions: [region()] })[0].instanceKeys).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('carries every surface id through — the wheel asks this table what it is standing on', () => {
      const [model] = decoded({ regions: [region()] });

      expect(model.shape.materials).toEqual(Uint8Array.from([4, 17]));
      expect(model.shape.boxes[0].material).toBe(7);
      expect(model.shape.spheres[0].material).toBe(9);
    });

    it('reads the placements as world matrices, column-major, without rebuilding them', () => {
      const [model] = decoded({
        regions: [
          region({
            transforms: [
              Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12.5, -3, 7, 1]),
              Float32Array.from([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 40, 8, -2, 1]),
            ],
          }),
        ],
      });

      expect(model.transforms).toHaveLength(2);
      expect(model.transforms[0].elements.slice(12, 15)).toEqual([12.5, -3, 7]);
      expect(model.transforms[1].elements).toEqual([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 40, 8, -2, 1]);
    });

    it('hands the mesh over as the flat arrays the physics layer consumes', () => {
      const [model] = decoded({ regions: [region()] });

      expect(model.name).toBe('roads32_law2');
      expect(model.shape.indices).toEqual(Uint32Array.from([0, 1, 2, 0, 2, 3]));
      expect(model.shape.vertices).toEqual(Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]));
    });

    it('keeps the regions in the order the bake wrote them', () => {
      const cell = { regions: [region({ name: 'first' }), region({ name: 'second' })] };

      expect(decoded(cell).map((model) => model.name)).toEqual(['first', 'second']);
    });
  });
});
