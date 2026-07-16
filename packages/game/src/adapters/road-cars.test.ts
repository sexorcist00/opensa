import type { VehiclePathNode } from '@opensa/renderware';

import { describe, expect, it } from 'vitest';

import { roadCarPlacements } from './road-cars';

function node(x: number, y: number, extra: Partial<VehiclePathNode> = {}): VehiclePathNode {
  return { area: 0, boats: false, heading: 0, id: 0, linkCount: 1, position: [x, y, 5], ...extra };
}

const REGION = { position: [0, 0, 5] as const, radius: 200, spacing: 50 };

describe('roadCarPlacements', () => {
  describe('negative cases', () => {
    it('skips water nodes and nodes outside every region', () => {
      const placements = roadCarPlacements([node(0, 0, { boats: true }), node(1000, 1000)], {
        models: ['landstal'],
        regions: [REGION],
      });

      expect(placements).toHaveLength(0);
    });

    it('returns nothing without models or regions', () => {
      expect(roadCarPlacements([node(0, 0)], { models: [], regions: [REGION] })).toHaveLength(0);
      expect(roadCarPlacements([node(0, 0)], { models: ['landstal'], regions: [] })).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('enforces the region spacing (one car per spacing cell) — the density knob', () => {
      const dense = [node(0, 0), node(10, 0, { id: 1 }), node(120, 0, { id: 2 })];
      const placements = roadCarPlacements(dense, { models: ['landstal'], regions: [REGION] });

      expect(placements).toHaveLength(2); // 0 and 120 survive; 10 shares the 50-unit cell with 0
    });

    it('is deterministic and offsets the car to the RIGHT of the heading (lane, not road centre)', () => {
      const east = node(0, 0, { heading: -Math.PI / 2 }); // facing +X
      const first = roadCarPlacements([east], { models: ['a', 'b', 'c'], regions: [REGION] });
      const second = roadCarPlacements([east], { models: ['a', 'b', 'c'], regions: [REGION] });

      expect(first).toEqual(second);
      // Facing +X, right = −Y (cos(−π/2), sin(−π/2)) → the car sits south of the node.
      expect(first[0].position[1]).toBeCloseTo(-2.5, 5);
      expect(first[0].groundSnap).toBe(true);
    });
  });
});
