import { describe, expect, it } from 'vitest';

import { seaState } from './wave-params';

const base = { overcast: 0, storm: 0, weather: 0 };

describe('seaState', () => {
  describe('negative cases', () => {
    it('is calm on a clear, stormless day', () => {
      const sea = seaState(base);
      expect(sea.amplitude).toBeCloseTo(0.12, 5);
      expect(sea.foam).toBeCloseTo(0.02, 5);
    });

    it('clamps out-of-range inputs', () => {
      expect(seaState({ ...base, overcast: 5, storm: -1 })).toEqual(seaState({ ...base, overcast: 1, storm: 0 }));
    });
  });

  describe('positive cases', () => {
    it('a storm dominates mere overcast', () => {
      const cloudy = seaState({ ...base, overcast: 1 });
      const stormy = seaState({ ...base, overcast: 1, storm: 1 });
      expect(stormy.amplitude).toBeGreaterThan(cloudy.amplitude);
      expect(stormy.amplitude).toBeCloseTo(1.35, 5); // full storm reaches the ceiling
      expect(stormy.foam).toBeGreaterThan(cloudy.foam);
      expect(stormy.steepness).toBeGreaterThan(cloudy.steepness);
    });

    it('is continuous in storm strength (weather blends must not snap)', () => {
      const at = (storm: number): number => seaState({ ...base, storm }).amplitude;
      expect(at(0.5)).toBeCloseTo((at(0.49) + at(0.51)) / 2, 6);
    });

    it('gives each weather a stable heading that never depends on time', () => {
      expect(seaState({ ...base, weather: 3 }).windAngle).toBe(seaState({ ...base, weather: 3 }).windAngle);
      expect(seaState({ ...base, weather: 3 }).windAngle).not.toBe(seaState({ ...base, weather: 4 }).windAngle);
    });
  });
});
