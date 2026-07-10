import { describe, expect, it } from 'vitest';

import { needsRefresh, shadowDistanceFactor, sliceSphere, splitRanges } from './csm-math';

describe('splitRanges', () => {
  describe('negative cases', () => {
    it('lambda 0 gives pure uniform splits', () => {
      const ranges = splitRanges(1, 901, 3, 0);
      expect(ranges.map((r) => r.far)).toEqual([301, 601, 901]);
    });
  });

  describe('positive cases', () => {
    it('covers [near, maxDistance] contiguously', () => {
      const ranges = splitRanges(1, 1000, 3, 0.6);
      expect(ranges[0].near).toBe(1);
      expect(ranges[2].far).toBeCloseTo(1000, 9);
      expect(ranges[1].near).toBe(ranges[0].far);
      expect(ranges[2].near).toBe(ranges[1].far);
    });

    it('lambda pulls the first split closer (logarithmic bias toward the camera)', () => {
      const uniform = splitRanges(1, 1000, 3, 0)[0].far;
      const log = splitRanges(1, 1000, 3, 1)[0].far;
      expect(log).toBeLessThan(uniform);
    });
  });
});

describe('sliceSphere', () => {
  describe('negative cases', () => {
    it('clamps the centre into the slice for wide FOVs', () => {
      const { centerDistance } = sliceSphere(120, 2, 1, 10);
      expect(centerDistance).toBeLessThanOrEqual(10);
      expect(centerDistance).toBeGreaterThanOrEqual(1);
    });
  });

  describe('positive cases', () => {
    it('the sphere contains all eight slice corners', () => {
      const fov = 60;
      const aspect = 16 / 9;
      const [near, far] = [10, 250];
      const { centerDistance, radius } = sliceSphere(fov, aspect, near, far);
      const tanY = Math.tan((fov * Math.PI) / 360);
      const tanX = tanY * aspect;
      for (const d of [near, far]) {
        const corner = Math.sqrt((d - centerDistance) ** 2 + (d * tanX) ** 2 + (d * tanY) ** 2);
        expect(corner).toBeLessThanOrEqual(radius + 1e-9);
      }
    });

    it('a longer slice needs a bigger sphere', () => {
      expect(sliceSphere(60, 1.78, 1, 1000).radius).toBeGreaterThan(sliceSphere(60, 1.78, 1, 250).radius);
    });
  });
});

describe('shadowDistanceFactor', () => {
  describe('negative cases', () => {
    it('clamps below the horizon to the minimum factor', () => {
      expect(shadowDistanceFactor(-0.5)).toBe(0.35);
      expect(shadowDistanceFactor(0)).toBe(0.35);
    });
  });

  describe('positive cases', () => {
    it('reaches full extent above the threshold elevation', () => {
      expect(shadowDistanceFactor(0.35)).toBe(1);
      expect(shadowDistanceFactor(1)).toBe(1);
    });

    it('shrinks continuously between horizon and threshold', () => {
      const half = shadowDistanceFactor(0.175);
      expect(half).toBeGreaterThan(0.35);
      expect(half).toBeLessThan(1);
    });
  });
});

describe('needsRefresh', () => {
  const CENTER = [100, 0, 100] as const;
  const SUN = [0, 1, 0] as const;

  describe('negative cases', () => {
    it('holds the cached map for small camera moves and sun drift', () => {
      const last = { center: CENTER, sunDir: SUN };
      expect(needsRefresh(last, [140, 0, 100], SUN, 250)).toBe(false); // 40 < 250/4
      expect(needsRefresh(last, CENTER, [0.005, 0.99998, 0], 250)).toBe(false); // ~0.3° < 0.6°
    });
  });

  describe('positive cases', () => {
    it('renders the very first frame (no state yet)', () => {
      expect(needsRefresh(null, CENTER, SUN, 250)).toBe(true);
    });

    it('re-renders when the camera leaves the covered margin', () => {
      const last = { center: CENTER, sunDir: SUN };
      expect(needsRefresh(last, [170, 0, 100], SUN, 250)).toBe(true); // 70 > 250/4
    });

    it('re-renders when the sun rotated past the policy angle', () => {
      const last = { center: CENTER, sunDir: SUN };
      expect(needsRefresh(last, CENTER, [0.05, 0.99875, 0], 250)).toBe(true); // ~2.9° > 0.6°
    });
  });
});
