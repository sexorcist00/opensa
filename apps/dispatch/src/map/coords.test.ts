import { describe, expect, it } from 'vitest';

import { engineToGta, gtaDistance, gtaToEngine, headingOf, stepTowards } from './coords';

describe('coords', () => {
  describe('negative cases', () => {
    it('does not overshoot when the step is longer than the distance', () => {
      expect(stepTowards([0, 0], [10, 0], 999)).toEqual([10, 0]);
    });

    it('returns the target when the two points coincide, rather than dividing by zero', () => {
      expect(stepTowards([5, 5], [5, 5], 3)).toEqual([5, 5]);
    });

    it('does not mirror the map: a GTA round trip is not the identity on the raw tuple', () => {
      // The trap this file exists for — z = −y, so feeding GTA numbers straight to the engine flips the world.
      expect(gtaToEngine([100, 200])).not.toEqual([100, 200, 0]);
    });
  });

  describe('positive cases', () => {
    it('round-trips a GTA ground point through engine space', () => {
      expect(engineToGta(gtaToEngine([2495, -1687]))).toEqual([2495, -1687]);
    });

    it('maps GTA y to engine −z and lifts on engine y', () => {
      expect(gtaToEngine([10, 20], 5)).toEqual([10, 5, -20]);
    });

    it('measures ground distance in world units', () => {
      expect(gtaDistance([0, 0], [3, 4])).toBe(5);
    });

    it('reads north as heading 0 and east as a quarter turn', () => {
      expect(headingOf([0, 0], [0, 10])).toBeCloseTo(0);
      expect(headingOf([0, 0], [10, 0])).toBeCloseTo(Math.PI / 2);
    });

    it('steps exactly the requested distance along the line', () => {
      expect(stepTowards([0, 0], [10, 0], 2.5)).toEqual([2.5, 0]);
    });
  });
});
