import { describe, expect, it } from 'vitest';

import { rebuildSmoothNormals } from './smooth-normals';

describe('rebuildSmoothNormals', () => {
  describe('negative cases', () => {
    it('returns null with no triangles', () => {
      expect(rebuildSmoothNormals(new Float32Array(9), new Uint32Array(0))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('leaves a flat quad un-split with one consistent normal', () => {
      // Two coplanar triangles in the XY plane (winding → +Z).
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
      const result = rebuildSmoothNormals(positions, [0, 1, 2, 0, 2, 3])!;
      expect(result.splitSources).toEqual([]); // one smooth group → no split
      expect([...result.indices]).toEqual([0, 1, 2, 0, 2, 3]); // indices unchanged
      expect([...result.normals.slice(0, 3)]).toEqual([0, 0, 1]);
    });

    it('splits the shared edge of a 90° crease (sharper than 45°)', () => {
      // Two triangles sharing edge A–B: one flat (XY), one vertical — dihedral 90° > crease.
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
      const result = rebuildSmoothNormals(positions, [0, 1, 2, 0, 1, 3])!;
      expect(result.splitSources).toEqual([0, 1]); // A and B each split into a second copy
      expect(result.normals).toHaveLength((4 + 2) * 3); // 4 originals + 2 appended
    });

    it('weights by corner angle so a huge sliver does not dominate a junction vertex (plan 021)', () => {
      // Faces share edge (0,1): a unit triangle tilted 30° (normal (0,−0.5,0.866)) and a 200 u road-strip
      // sliver in the XY plane (normal +Z, area 2 — 4× the unit face) whose corner angle at vertex 0 is
      // only ~0.02 rad. Area-only weighting lands near +Z (nz ≈ 0.99); angle×area keeps the tilt.
      const positions = new Float32Array([
        0,
        0,
        0, // 0 — the junction
        1,
        0,
        0, // 1
        0.5,
        Math.cos(Math.PI / 6),
        Math.sin(Math.PI / 6), // 2 — tilts triangle (0,1,2) by 30°
        200,
        -4,
        0, // 3 — sliver far end
      ]);
      const result = rebuildSmoothNormals(positions, [0, 1, 2, 0, 3, 1], { creaseAngleDeg: 60 })!;
      expect(result.splitSources).toEqual([]); // 30° dihedral < 60° crease — one smooth group
      const ny = result.normals[1];
      const nz = result.normals[2];
      expect(nz).toBeLessThan(0.93); // area-only would give ≈ 0.99
      expect(ny).toBeLessThan(-0.3); // the tilted face's −Y lean survives
    });
  });
});
