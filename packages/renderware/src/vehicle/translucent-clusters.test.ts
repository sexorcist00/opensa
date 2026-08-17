import { describe, expect, it } from 'vitest';

import type { RWTriangle } from '../parsers/binary/types';

import { clusterTriangles } from './translucent-clusters';

/** A unit quad at `origin` (two triangles sharing an edge), appended to `positions`; returns its triangles. */
function quad(positions: number[], origin: [number, number, number]): RWTriangle[] {
  const base = positions.length / 3;
  const [x, y, z] = origin;
  positions.push(x, y, z, x + 0.1, y, z, x + 0.1, y + 0.1, z, x, y + 0.1, z);

  return [
    { a: base, b: base + 1, c: base + 2, materialIndex: 0 },
    { a: base, b: base + 2, c: base + 3, materialIndex: 0 },
  ];
}

describe('clusterTriangles', () => {
  describe('negative cases', () => {
    it('keeps one connected piece as one cluster', () => {
      const positions: number[] = [];
      const tris = quad(positions, [0, 0, 0]);

      expect(clusterTriangles(tris, Float32Array.from(positions))).toEqual([tris]);
    });

    it('joins pieces that share a vertex POSITION through different indices (a UV seam)', () => {
      const positions: number[] = [];
      const a = quad(positions, [0, 0, 0]);
      const b = quad(positions, [0.1, 0, 0]); // its left edge duplicates a's right edge, new indices

      expect(clusterTriangles([...a, ...b], Float32Array.from(positions))).toHaveLength(1);
    });

    it('merges separate pieces that lie within the gap', () => {
      const positions: number[] = [];
      const a = quad(positions, [0, 0, 0]);
      const b = quad(positions, [0.25, 0, 0]); // 0.05 clear of a

      expect(clusterTriangles([...a, ...b], Float32Array.from(positions), 0.2)).toHaveLength(1);
    });
  });

  describe('positive cases', () => {
    it('splits pieces farther apart than the gap into their own clusters (dash gauges vs shelf speakers)', () => {
      const positions: number[] = [];
      const gauges = quad(positions, [0, 0.38, 0.25]);
      const speakerL = quad(positions, [-0.4, -1.46, 0.32]);
      const speakerR = quad(positions, [0.3, -1.46, 0.32]);

      const clusters = clusterTriangles([...gauges, ...speakerL, ...speakerR], Float32Array.from(positions), 0.2);

      expect(clusters).toHaveLength(3);
      expect(clusters.map((c) => c.length)).toEqual([2, 2, 2]);
    });

    it('caps the cluster count by merging the nearest pairs first', () => {
      const positions: number[] = [];
      const tris = [0, 1, 2, 3, 4].flatMap((i) => quad(positions, [i * 1.0, 0, 0])); // 0.9 apart, 5 pieces
      const far = quad(positions, [0, 10, 0]);

      const clusters = clusterTriangles([...tris, ...far], Float32Array.from(positions), 0.2, 2);

      expect(clusters).toHaveLength(2);
      // The far piece stays alone; the row of five merged among themselves.
      expect(clusters.map((c) => c.length).sort((a, b) => a - b)).toEqual([2, 10]);
    });
  });
});
