import { describe, expect, it } from 'vitest';

import {
  frustumFromViewProj,
  frustumIntersectsSphere,
  mat4Identity,
  mat4LookAt,
  mat4Multiply,
  mat4PerspectiveZO,
  sphereFullyBeyond,
} from './math';

function viewProj(eye: [number, number, number], target: [number, number, number]): Float32Array {
  const proj = mat4Identity();
  const view = mat4Identity();
  const out = mat4Identity();
  mat4PerspectiveZO(proj, Math.PI / 3, 16 / 9, 0.1, 1000);
  mat4LookAt(view, eye, target, [0, 1, 0]);

  return mat4Multiply(out, proj, view);
}

describe('engine math', () => {
  describe('negative cases', () => {
    it('culls a sphere far behind the camera', () => {
      const planes = new Float32Array(24);
      frustumFromViewProj(planes, viewProj([0, 0, 10], [0, 0, 0]));

      expect(frustumIntersectsSphere(planes, 0, 0, 100, 5)).toBe(false);
    });

    it('culls a sphere far off to the side', () => {
      const planes = new Float32Array(24);
      frustumFromViewProj(planes, viewProj([0, 0, 10], [0, 0, 0]));

      expect(frustumIntersectsSphere(planes, 500, 0, 0, 5)).toBe(false);
    });

    it('does not report a sphere beyond when any part of it is inside the distance', () => {
      // Centre at 1150 with radius 100 → closest point 1050 < 1100: still (partly) visible.
      expect(sphereFullyBeyond([0, 0, 0], 1150, 0, 0, 100, 1100)).toBe(false);
      // The eye is inside the sphere.
      expect(sphereFullyBeyond([0, 0, 0], 10, 0, 0, 50, 1100)).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('projects a point in front of the camera inside clip space with 0..1 depth', () => {
      const m = viewProj([0, 0, 10], [0, 0, 0]);
      // Transform the origin (world) — camera at z=10 looking at origin → view depth 10.
      const clipW = m[3] * 0 + m[7] * 0 + m[11] * 0 + m[15];
      const clipZ = m[2] * 0 + m[6] * 0 + m[10] * 0 + m[14];
      const ndcZ = clipZ / clipW;

      expect(clipW).toBeGreaterThan(0);
      expect(ndcZ).toBeGreaterThan(0);
      expect(ndcZ).toBeLessThan(1);
    });

    it('keeps a visible sphere and one straddling the frustum edge', () => {
      const planes = new Float32Array(24);
      frustumFromViewProj(planes, viewProj([0, 0, 10], [0, 0, 0]));

      expect(frustumIntersectsSphere(planes, 0, 0, 0, 1)).toBe(true);
      // Far to the side but with a huge radius → still intersects.
      expect(frustumIntersectsSphere(planes, 500, 0, 0, 600)).toBe(true);
    });

    it('reports a sphere fully beyond the fog cut (closest point at/past the distance)', () => {
      // Closest point exactly AT the cut: the shader's hard cut is 1 there — cullable.
      expect(sphereFullyBeyond([0, 0, 0], 1200, 0, 0, 100, 1100)).toBe(true);
      // 3D distance counts: a high cell over the horizon is farther than its ground distance.
      expect(sphereFullyBeyond([0, 200, 0], 1150, 0, 0, 50, 1100)).toBe(true);
    });
  });
});
