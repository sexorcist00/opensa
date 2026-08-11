import { describe, expect, it } from 'vitest';

import type { SubMesh } from '../core/ir';

import { repairMesh } from './repair-uv-stretch';

/**
 * Two triangles sharing the edge (1, 2) on a flat 2×1 quad in the XY plane:
 *
 *   3 ---- 2      healthy = (0,1,2), broken = (2,1,3)
 *   |    / |      positions: 0=(0,0) 1=(1,0) 2=(1,1) 3=(0,1)
 *   |  /   |
 *   0 ---- 1
 */
const quad = (brokenUv: readonly number[]): SubMesh => ({
  extraUvs: undefined,
  materialCount: 1,
  name: 'quad',
  nightColors: null,
  normals: null,
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  prelitColors: null,
  triangles: [
    { a: 0, b: 1, c: 2, material: 0 },
    { a: 2, b: 1, c: 3, material: 0 },
  ],
  uvs: new Float32Array([0, 0, 1, 0, 1, 1, ...brokenUv]),
});

/** σmax/σmin of a face, recomputed from the mesh so the assertions read the RESULT, not the intent. */
const anisotropy = (mesh: SubMesh, face: number): number => {
  const { a, b, c } = mesh.triangles[face];
  const p = mesh.positions;
  const t = mesh.uvs!;
  const e1p = [0, 1, 2].map((k) => p[b * 3 + k] - p[a * 3 + k]);
  const e2p = [0, 1, 2].map((k) => p[c * 3 + k] - p[a * 3 + k]);
  const e1t = [t[b * 2] - t[a * 2], t[b * 2 + 1] - t[a * 2 + 1]];
  const e2t = [t[c * 2] - t[a * 2], t[c * 2 + 1] - t[a * 2 + 1]];
  const det = e1t[0] * e2t[1] - e1t[1] * e2t[0];
  if (Math.abs(det) < 1e-14) return Number.POSITIVE_INFINITY;
  const du = [0, 1, 2].map((k) => (e1p[k] * e2t[1] - e2p[k] * e1t[1]) / det);
  const dv = [0, 1, 2].map((k) => (e2p[k] * e1t[0] - e1p[k] * e2t[0]) / det);
  const guu = du.reduce((s, x, i) => s + x * du[i], 0);
  const gvv = dv.reduce((s, x, i) => s + x * dv[i], 0);
  const guv = du.reduce((s, x, i) => s + x * dv[i], 0);
  const mean = (guu + gvv) / 2;
  const spread = Math.sqrt(Math.max(0, ((guu - gvv) / 2) ** 2 + guv * guv));
  const small = Math.sqrt(Math.max(0, mean - spread));

  return small > 1e-9 ? Math.sqrt(Math.max(0, mean + spread)) / small : Number.POSITIVE_INFINITY;
};

describe('repairMesh', () => {
  describe('negative cases', () => {
    it('does nothing to a mesh whose faces are all healthy', () => {
      const mesh = quad([0, 1]); // vertex 3 at its correct UV
      const before = new Float32Array(mesh.uvs!);

      expect(repairMesh(mesh)).toEqual({ refused: 0, repaired: 0, split: 0 });
      expect(mesh.uvs).toEqual(before);
    });

    it('REFUSES when the broken face has no healthy neighbour, and says so', () => {
      const mesh = quad([1, 0]); // collapses face 1
      mesh.uvs!.set([0, 0, 1, 0, 1, 0], 0); // and face 0 too — nothing healthy left to inherit from
      const before = new Float32Array(mesh.uvs!);
      const stats = repairMesh(mesh);

      expect(stats.repaired).toBe(0);
      expect(stats.refused).toBeGreaterThan(0);
      expect(mesh.uvs).toEqual(before);
    });

    it('leaves a mesh without UVs alone', () => {
      const mesh = quad([0, 1]);
      mesh.uvs = null;

      expect(repairMesh(mesh)).toEqual({ refused: 0, repaired: 0, split: 0 });
    });
  });

  describe('positive cases', () => {
    it('re-derives a collapsed face from its healthy neighbour', () => {
      const mesh = quad([1, 0]); // vertex 3 given face 1's own UV → its UV triangle collapses

      expect(anisotropy(mesh, 1)).toBe(Number.POSITIVE_INFINITY);
      const stats = repairMesh(mesh);

      expect(stats).toEqual({ refused: 0, repaired: 1, split: 1 });
      expect(anisotropy(mesh, 1)).toBeCloseTo(1, 6); // square texel, from the neighbour's own map
    });

    it('never moves a UV a healthy face uses — the corrected corner goes on a COPY', () => {
      const mesh = quad([1, 0]);
      const healthyBefore = Array.from(mesh.uvs!.slice(0, 6));
      repairMesh(mesh);

      expect(Array.from(mesh.uvs!.slice(0, 6))).toEqual(healthyBefore);
      expect(mesh.triangles[0]).toEqual({ a: 0, b: 1, c: 2, material: 0 }); // untouched
      expect(mesh.positions.length / 3).toBe(5); // one appended vertex
    });

    it('carries every per-vertex attribute onto the split copy', () => {
      const mesh = quad([1, 0]);
      mesh.normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
      mesh.prelitColors = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      repairMesh(mesh);

      expect(mesh.normals.length / 3).toBe(5);
      expect(mesh.prelitColors.length / 4).toBe(5);
      // The copy inherits vertex 3's colour, since that is the vertex it stands in for.
      expect(Array.from(mesh.prelitColors.slice(16))).toEqual([13, 14, 15, 16]);
    });

    it('keeps the repaired corner at the position it always had — only the UV is re-derived', () => {
      const mesh = quad([1, 0]);
      repairMesh(mesh);

      expect(Array.from(mesh.positions.slice(12))).toEqual([0, 1, 0]); // same place as vertex 3
    });
  });
});
