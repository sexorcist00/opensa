import type { OsaudioZone } from '@opensa/engine-formats';

import { describe, expect, it } from 'vitest';

import { audioZoneAt, contains } from './zones';

/** A box zone, stated the way an `AUZO` row states one: two corners, in either order. */
function box(name: string, min: [number, number, number], max: [number, number, number], active = true): OsaudioZone {
  return { active, id: 0, max, min, name, shape: 'box' };
}

/** A sphere zone. */
function sphere(name: string, centre: [number, number, number], radius: number, active = true): OsaudioZone {
  return { active, centre, id: 0, name, radius, shape: 'sphere' };
}

describe('audioZoneAt', () => {
  describe('negative cases', () => {
    it('is null in the open world, where no zone contains the listener', () => {
      expect(audioZoneAt([box('CITY', [0, 0, 0], [10, 10, 10])], [50, 50, 50])).toBeNull();
      expect(audioZoneAt([], [0, 0, 0])).toBeNull();
    });

    it('SKIPS a zone the map switched off, even standing inside it', () => {
      // `flags == 1` is what the game passes as isActive; 4 of the stock 155 are off.
      const zones = [box('OFF', [-10, -10, -10], [10, 10, 10], false)];

      expect(audioZoneAt(zones, [0, 0, 0])).toBeNull();
    });

    it('is not fooled by a row whose corners are the other way round', () => {
      // An IPL states two corners and promises nothing about which is which. Read literally, such a zone is
      // one nobody can ever be inside — silent rather than wrong, which is the worst kind.
      const zones = [box('REVERSED', [10, 10, 10], [-10, -10, -10])];

      expect(audioZoneAt(zones, [0, 0, 0])?.name).toBe('REVERSED');
    });
  });

  describe('positive cases', () => {
    it('picks the SMALLEST containing zone — a club inside a district is the club', () => {
      const zones = [
        box('DISTRICT', [-100, -100, -100], [100, 100, 100]),
        box('CLUB', [-5, -5, -5], [5, 5, 5]),
        box('BLOCK', [-30, -30, -30], [30, 30, 30]),
      ];

      expect(audioZoneAt(zones, [0, 0, 0])?.name).toBe('CLUB');
      expect(audioZoneAt(zones, [20, 0, 0])?.name).toBe('BLOCK');
      expect(audioZoneAt(zones, [60, 0, 0])?.name).toBe('DISTRICT');
    });

    it('compares a sphere against a box by VOLUME, not by shape', () => {
      const zones = [box('BIG_BOX', [-50, -50, -50], [50, 50, 50]), sphere('SMALL_BALL', [0, 0, 0], 10)];

      expect(audioZoneAt(zones, [0, 0, 0])?.name).toBe('SMALL_BALL');
    });

    it('holds a listener on a boundary inside the zone rather than dropping it out', () => {
      expect(contains(box('EDGE', [0, 0, 0], [10, 10, 10]), [10, 10, 10])).toBe(true);
      expect(contains(sphere('BALL', [0, 0, 0], 10), [10, 0, 0])).toBe(true);
    });

    it('measures a sphere by distance in three dimensions, altitude included', () => {
      const ball = sphere('BALL', [0, 0, 0], 10);

      expect(contains(ball, [0, 0, 9])).toBe(true);
      expect(contains(ball, [0, 0, 11])).toBe(false);
      expect(contains(ball, [6, 6, 6])).toBe(false);
    });
  });
});
