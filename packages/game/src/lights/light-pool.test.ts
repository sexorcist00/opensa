import { describe, expect, it } from 'vitest';

import type { LampLight } from './light-pool';

import { lampKey, selectLamps } from './light-pool';

function lamp(x: number, y = 0, z = 0): LampLight {
  return { color: [255, 200, 120], key: lampKey([x, y, z]), position: [x, y, z], radius: 12 };
}

const ORIGIN = [0, 0, 0] as const;

describe('lampKey', () => {
  describe('negative cases', () => {
    it('separates lamps that differ beyond centimetre precision', () => {
      expect(lampKey([1, 0, 0])).not.toBe(lampKey([1.05, 0, 0]));
    });
  });

  describe('positive cases', () => {
    it('is stable for the same baked position', () => {
      expect(lampKey([1.234, -5, 2])).toBe(lampKey([1.234, -5, 2]));
    });
  });
});

describe('selectLamps', () => {
  describe('negative cases', () => {
    it('returns nothing when there are no slots', () => {
      expect(selectLamps([lamp(1)], ORIGIN, 0, 100)).toEqual([]);
    });

    it('drops lamps beyond the max distance', () => {
      expect(selectLamps([lamp(500)], ORIGIN, 4, 100)).toEqual([]);
    });

    it('returns fewer than the slot count when few lamps are in range', () => {
      expect(selectLamps([lamp(5), lamp(900)], ORIGIN, 4, 100)).toHaveLength(1);
    });
  });

  describe('positive cases', () => {
    it('picks the nearest lamps, nearest first', () => {
      const picked = selectLamps([lamp(30), lamp(5), lamp(12)], ORIGIN, 2, 100);
      expect(picked.map((entry) => entry.position[0])).toEqual([5, 12]);
    });

    it('keeps an incumbent whose rival is only marginally nearer (no slot thrash)', () => {
      const incumbent = lamp(10);
      const rival = lamp(9.5);
      const picked = selectLamps([rival, incumbent], ORIGIN, 1, 100, new Set([incumbent.key]));
      expect(picked[0].key).toBe(incumbent.key);
    });

    it('lets a clearly nearer rival take the slot', () => {
      const incumbent = lamp(10);
      const rival = lamp(3);
      const picked = selectLamps([rival, incumbent], ORIGIN, 1, 100, new Set([incumbent.key]));
      expect(picked[0].key).toBe(rival.key);
    });
  });
});
