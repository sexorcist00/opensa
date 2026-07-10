import { describe, expect, it } from 'vitest';

import { sunSplit } from './sun-split';

const DEFAULTS = { sunDirect: 1, sunIndirect: 0.7 };

describe('sunSplit', () => {
  describe('negative cases', () => {
    it('degrades to the exact classic look at night (elevation 0)', () => {
      expect(sunSplit({ ...DEFAULTS, overcast: 0, sunElevation: 0 })).toEqual({
        directScale: 0,
        indirectScale: 1,
      });
    });

    it('clamps out-of-range elevation and overcast', () => {
      expect(sunSplit({ ...DEFAULTS, overcast: -1, sunElevation: 2 })).toEqual(
        sunSplit({ ...DEFAULTS, overcast: 0, sunElevation: 1 }),
      );
    });

    it('sunDirect 0 disables the direct term without touching indirect', () => {
      const split = sunSplit({ overcast: 0, sunDirect: 0, sunElevation: 1, sunIndirect: 0.7 });
      expect(split.directScale).toBe(0);
      expect(split.indirectScale).toBeCloseTo(0.7, 10);
    });
  });

  describe('positive cases', () => {
    it('clear noon: full direct, prelit retained at sunIndirect', () => {
      const split = sunSplit({ ...DEFAULTS, overcast: 0, sunElevation: 1 });
      expect(split.directScale).toBeCloseTo(1, 10);
      expect(split.indirectScale).toBeCloseTo(0.7, 10);
    });

    it('full overcast suppresses direct and hands prelit back', () => {
      const clear = sunSplit({ ...DEFAULTS, overcast: 0, sunElevation: 1 });
      const overcast = sunSplit({ ...DEFAULTS, overcast: 1, sunElevation: 1 });
      expect(overcast.directScale).toBeLessThan(clear.directScale * 0.2);
      expect(overcast.indirectScale).toBeGreaterThan(clear.indirectScale);
    });

    it('is continuous (linear) in elevation — no pops across the sun arc', () => {
      const at = (sunElevation: number): number => sunSplit({ ...DEFAULTS, overcast: 0, sunElevation }).directScale;
      expect(at(0.5)).toBeCloseTo((at(0) + at(1)) / 2, 10);
    });
  });
});
