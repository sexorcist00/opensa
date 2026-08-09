import { describe, expect, it } from 'vitest';

import { densityEntries, densityFor, densityProfile, validateDensityProfile } from './density';

const MAX = 3;

/** surfinfo names are DATA, so they are values here rather than literal keys (they are not camelCase). */
const surface = { mountain: 'p_mountain', sand: 'p_sand' } as const;

describe('validateDensityProfile', () => {
  describe('negative cases', () => {
    it('names the CATEGORY whose cutoff is above the candidate ceiling, not just the range', () => {
      expect(() => validateDensityProfile({ byCategory: { rocks: 4 } }, MAX)).toThrow(/'rocks'.*got 4/);
    });

    it('names the category AND surface of a bad per-surface entry', () => {
      expect(() => validateDensityProfile({ bySurface: { cacti: { [surface.sand]: 0 } } }, MAX)).toThrow(
        /'cacti\/p_sand'.*got 0/,
      );
    });

    it('refuses NaN, which passes both range comparisons and would empty that category in silence', () => {
      expect(() => validateDensityProfile({ byCategory: { bushes: Number.NaN } }, MAX)).toThrow(/'bushes'/);
      expect(() => validateDensityProfile({ base: Number.POSITIVE_INFINITY }, MAX)).toThrow(/'base'/);
    });

    it('refuses a negative base', () => {
      expect(() => validateDensityProfile({ base: -1 }, MAX)).toThrow(/'base'.*got -1/);
    });
  });

  describe('positive cases', () => {
    it('accepts the empty profile — every category then runs at the authored density', () => {
      expect(() => validateDensityProfile({}, MAX)).not.toThrow();
    });

    it('accepts the ceiling itself, and a thinning cutoff below 1', () => {
      expect(() => validateDensityProfile({ byCategory: { grass: MAX, trees: 0.25 } }, MAX)).not.toThrow();
    });
  });
});

describe('densityFor', () => {
  describe('negative cases', () => {
    it('does not apply one category profile to another', () => {
      const config = { byCategory: { bushes: 2 } };

      expect(densityFor(config, 'rocks', 'p_mountain')).toBe(1);
      expect(densityFor(config, 'bushes', 'p_mountain')).toBe(2);
    });

    it('does not apply a per-surface entry on a different surface', () => {
      const config = { bySurface: { rocks: { [surface.mountain]: 2.5 } } };

      expect(densityFor(config, 'rocks', 'p_underwaterbarren')).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('is vanilla for an empty profile — the regression baseline', () => {
      expect(densityFor({}, 'trees', 'p_woodland')).toBe(1);
    });

    it('resolves most-specific first: category on a surface beats category beats base', () => {
      const config = { base: 0.5, byCategory: { rocks: 2 }, bySurface: { rocks: { [surface.mountain]: 3 } } };

      expect(densityFor(config, 'rocks', 'p_mountain')).toBe(3);
      expect(densityFor(config, 'rocks', 'p_wasteground')).toBe(2);
      expect(densityFor(config, 'flowers', 'p_flowerbed')).toBe(0.5);
    });
  });
});

describe('densityProfile', () => {
  describe('positive cases', () => {
    it('reads a plain number as the whole-map base — what --procobj-density has always meant', () => {
      expect(densityProfile(2)).toEqual({ base: 2 });
      expect(densityFor(densityProfile(2), 'cacti', 'p_sand')).toBe(2);
    });

    it('defaults to vanilla when nothing is configured', () => {
      expect(densityFor(densityProfile(), 'cacti', 'p_sand')).toBe(1);
    });
  });
});

describe('densityEntries', () => {
  describe('positive cases', () => {
    it('lists every cutoff with the key it came from, base included', () => {
      const entries = densityEntries({ byCategory: { rocks: 2 }, bySurface: { cacti: { [surface.sand]: 1.5 } } });

      expect(entries).toEqual([
        { key: 'base', value: 1 },
        { key: 'rocks', value: 2 },
        { key: 'cacti/p_sand', value: 1.5 },
      ]);
    });
  });
});
