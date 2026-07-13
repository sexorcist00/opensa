import { describe, expect, it } from 'vitest';

import { bakeWater } from './water';

/** A 200×200 water square (grid corner order: v0, +X, +Y, +X+Y) with the water.dat 7-float layout. */
const SQUARE = [
  'processed',
  [
    [0, 0, 5],
    [200, 0, 5],
    [0, 200, 5],
    [200, 200, 5],
  ]
    .map(([x, y, z]) => `${x} ${y} ${z} 0 0 0 0`)
    .join('   ') + ' 1',
].join('\n');

function decode(bin: Uint8Array): { indices: Uint32Array; vertices: Float32Array } {
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const vertexCount = view.getUint32(0, true);
  const indexCount = view.getUint32(4, true);

  return {
    indices: new Uint32Array(bin.buffer, bin.byteOffset + 8 + vertexCount * 16, indexCount),
    vertices: new Float32Array(bin.buffer, bin.byteOffset + 8, vertexCount * 4),
  };
}

describe('bakeWater', () => {
  describe('negative cases', () => {
    it('returns only the ocean frame for empty water data', () => {
      const { bin, manifest } = bakeWater('processed\n');
      expect(manifest.vertexCount).toBeGreaterThan(0); // the solid ocean plane
      expect(decode(bin).indices.length).toBe(manifest.indexCount);
    });
  });

  describe('positive cases', () => {
    it('tessellates a quad and bakes the pseudo-depth field without height data', () => {
      const { bin, manifest } = bakeWater(SQUARE);
      const { indices, vertices } = decode(bin);
      expect(manifest.indexCount).toBe(indices.length);
      // 200/16 → 13 cells per side → 14×14 verts for the square alone (plus the ocean frame's).
      expect(manifest.vertexCount).toBeGreaterThan(14 * 14);
      // Pseudo-depth = shore distance × 0.15: ~15 m mid-square, ~0 at the corner shoreline.
      let centreDepth = 0;
      let cornerDepth = Number.POSITIVE_INFINITY;
      for (let v = 0; v < vertices.length; v += 4) {
        const [x, y, , depth] = [vertices[v], vertices[v + 1], vertices[v + 2], vertices[v + 3]];
        if (Math.abs(x - 96) < 9 && Math.abs(y - 96) < 9) {
          centreDepth = Math.max(centreDepth, depth);
        }
        if (Math.abs(x) < 1 && Math.abs(y) < 1) {
          cornerDepth = Math.min(cornerDepth, depth);
        }
      }
      expect(centreDepth).toBeGreaterThan(10);
      expect(cornerDepth).toBeLessThan(0.5);
      // Water level carried through the tessellation.
      expect(vertices[2]).toBe(5);
      // All indices in range.
      for (const index of indices) {
        expect(index).toBeLessThan(manifest.vertexCount);
      }
    });

    it('bakes TRUE depth where the height grid has data', () => {
      // Ground rises linearly from −10 at x=0 to +5 at x=200: the waterline (z=5) sits at x=200.
      const { bin } = bakeWater(SQUARE, (x) => -10 + (x / 200) * 15);
      const { vertices } = decode(bin);
      let atStart = 0;
      let atEnd = Number.POSITIVE_INFINITY;
      for (let v = 0; v < vertices.length; v += 4) {
        const [x, y, , depth] = [vertices[v], vertices[v + 1], vertices[v + 2], vertices[v + 3]];
        if (y < 0 || y > 200 || x < -1 || x > 201) {
          continue; // ocean frame (constant deep)
        }
        if (x > 2 && x < 20) {
          atStart = Math.max(atStart, depth);
        }
        if (x > 199) {
          atEnd = Math.min(atEnd, depth);
        }
      }
      // Deep end (x≈2–20): water z 5 − ground ≈ −10 → ~14–15 m (the x=0 column belongs to the ocean frame).
      expect(atStart).toBeGreaterThan(13);
      expect(atStart).toBeLessThan(16);
      expect(atEnd).toBeLessThan(0.5); // the visual waterline
    });
  });
});
