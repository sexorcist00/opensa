import type { DebugLineSetId, Engine } from '@opensa/engine';

import { describe, expect, it } from 'vitest';

import type { Operations, Unit, UnitStatus } from '../ops/types';

import { UNITS_ON_SCREEN } from '../ops/budget';
import { Beacons } from './beacons';

function board(units: number, status: UnitStatus = 'available'): Operations {
  return { incidents: [], log: [], now: 0, units: Array.from({ length: units }, (_, i) => unit(i, status)) };
}

/** Records every line set the layer creates and every write into one — the buffer sizing is what is on
 *  trial, and on a real device writing past a set's allocation is a WebGPU validation error. */
function fakeEngine(): { engine: Engine; sets: Map<number, { capacity: number; written: number }> } {
  const sets = new Map<number, { capacity: number; written: number }>();
  let next = 0;
  const engine = {
    createDebugLines: (positions: Float32Array): DebugLineSetId => {
      next += 1;
      sets.set(next, { capacity: positions.length, written: 0 });

      return next;
    },
    destroyDebugLines: (id: DebugLineSetId): void => {
      sets.delete(id);
    },
    updateDebugLines: (id: DebugLineSetId, positions: Float32Array): void => {
      const set = sets.get(id);
      if (!set) {
        throw new Error('wrote into a set that does not exist');
      }
      if (positions.length > set.capacity) {
        throw new Error(`wrote ${positions.length} floats into a set allocated for ${set.capacity}`);
      }
      set.written = positions.length;
    },
  };

  return { engine: engine as unknown as Engine, sets };
}

function unit(index: number, status: UnitStatus): Unit {
  return {
    at: [1000 + index * 3, -1000],
    callsign: `4-XRAY-${index}`,
    elevation: 13,
    heading: 0,
    id: `u${index}`,
    incident: null,
    kind: 'patrol',
    model: 'copcarls',
    status,
    target: null,
  };
}

/** Floats per marker — a pillar plus a two-segment ground cross. Mirrors the layer's own constant. */
const FLOATS_PER_MARKER = 18;

describe('Beacons', () => {
  describe('negative cases', () => {
    it('does not drop a marker when a set fills up — it grows, and says it did', () => {
      const { engine } = fakeEngine();
      const beacons = new Beacons(engine);
      const over = UNITS_ON_SCREEN + 40;

      beacons.update(board(over), null);

      expect(beacons.stats().grownSets).toBeGreaterThan(0);
      expect(beacons.stats().capacity).toBeGreaterThanOrEqual(over);
    });

    it('does NOT count trail growth as the board outgrowing its unit budget', () => {
      const { engine } = fakeEngine();
      const beacons = new Beacons(engine);
      // 51 points per unit is the measured typical leg; 150 of them is 45 000 floats, sixteen times what a
      // marker set holds. Sizing the trail set off MARKER_CAPACITY made this warn on the FIRST frame.
      const trails = new Map(
        Array.from({ length: UNITS_ON_SCREEN }, (_, i) => [
          `u${i}`,
          new Float32Array(Array.from({ length: 102 }, (_, k) => 1000 + i + k)),
        ]),
      );

      beacons.update(board(UNITS_ON_SCREEN), null, trails);

      expect(beacons.stats().grownSets).toBe(0);
      expect(beacons.stats().capacity).toBe(UNITS_ON_SCREEN);
    });

    it("never writes past a set's allocation — the grown buffer gets a new set first", () => {
      const { engine } = fakeEngine();
      const beacons = new Beacons(engine);

      expect(() => beacons.update(board(UNITS_ON_SCREEN * 4), null)).not.toThrow();
    });

    it('draws no beacon for a unit a car is already drawing — the overlay rule, through depth', () => {
      // Extended here at the operator's word, 2026-09-05: this layer and the symbology layer draw the same
      // fact in two places, so filtering one and not the other moves the clutter instead of removing it.
      // Compared against the FLOOR rather than against zero: an empty set still writes a degenerate line.
      const { engine, sets } = fakeEngine();
      const beacons = new Beacons(engine);
      const written = (): number => [...sets.values()].reduce((sum, set) => sum + set.written, 0);

      beacons.update(board(0), null);
      const floor = written();
      beacons.update(board(40, 'available'), null, undefined, () => true);
      const hidden = written();
      beacons.update(board(40, 'available'), null, undefined, () => false);

      expect(hidden).toBe(floor);
      expect(written()).toBeGreaterThan(floor);
    });

    it('drops the TRAIL with the mark, so a track cannot outlive the unit that drew it', () => {
      const { engine, sets } = fakeEngine();
      const beacons = new Beacons(engine);
      const trails = new Map([['u0', new Float32Array([0, 0, 10, 10, 20, 20])]]);
      const written = (): number => [...sets.values()].reduce((sum, set) => sum + set.written, 0);

      beacons.update(board(1, 'available'), null, trails, () => true);
      const hidden = written();
      beacons.update(board(1, 'onScene'), null, trails, () => true);

      expect(written()).toBeGreaterThan(hidden);
    });
  });

  describe('positive cases', () => {
    it('holds the whole declared budget in ONE status without growing', () => {
      const { engine } = fakeEngine();
      const beacons = new Beacons(engine);

      beacons.update(board(UNITS_ON_SCREEN), null);

      expect(beacons.stats().grownSets).toBe(0);
      expect(beacons.stats().capacity).toBe(UNITS_ON_SCREEN);
    });

    it('writes one marker per unit into the set its status names', () => {
      const { engine, sets } = fakeEngine();
      const beacons = new Beacons(engine);

      beacons.update(board(12, 'enRoute'), null);

      const written = [...sets.values()].map((set) => set.written).filter((floats) => floats > FLOATS_PER_MARKER);
      expect(written).toEqual([12 * FLOATS_PER_MARKER]);
    });
  });
});
