import { describe, expect, it } from 'vitest';

import type { EnterableVehicle } from './enter-vehicle.system';

import { FakeVehicleHandle } from './vehicle-handle.fake';
import { lampAnchorsOf, lampsOf, lampStateFor, quatFromHeading } from './vehicle-lamps';

/** A car at the origin facing +Y (heading 0), with authored lamp dummies unless `anchors` says otherwise. */
function car(heading = 0, anchors = true): EnterableVehicle {
  const handle = new FakeVehicleHandle();
  if (anchors) {
    handle.lampAnchors.set('head', [0.8, 1.8, 0]);
    handle.lampAnchors.set('tail', [0.6, -2.4, 0]);
  }

  return {
    halfExtents: [1, 2, 0.7],
    handle,
    heading,
    orientation: quatFromHeading(heading),
    position: [0, 0, 0],
  } as unknown as EnterableVehicle;
}

/** The same car, ROLLED onto its roof (180° about its own +Y axis) — heading is unchanged by a roll. */
function rolledCar(): EnterableVehicle {
  return { ...car(), orientation: [0, 1, 0, 0] } as unknown as EnterableVehicle;
}

describe('vehicle-lamps', () => {
  describe('negative cases', () => {
    it('a car with no lamp dummies falls back to its half-extents', () => {
      const anchors = lampAnchorsOf(car(0, false));

      // Fractions of [hx, hy, hz] = [1, 2, 0.7]; the rear anchor is BEHIND the car (−y).
      expect(anchors.front[1]).toBeGreaterThan(0);
      expect(anchors.rear[1]).toBeLessThan(0);
    });

    it('lamps stay dark unless the car is being DRIVEN at night', () => {
      const vehicle = car();

      expect(lampStateFor(vehicle, false, false, true, 1).car).toBeNull(); // in range but not seated
      expect(lampStateFor(vehicle, true, false, false, 1).car).toBeNull(); // seated, but daytime
      expect(lampStateFor(null, true, false, true, 1).car).toBeNull(); // on foot
    });

    it('a dark car never reports brakes (the state must not leak from the last driven frame)', () => {
      expect(lampStateFor(car(), true, true, false, 1).state).toEqual({
        brakes: false,
        headlights: false,
        intensity: 1,
      });
    });
  });

  describe('positive cases', () => {
    it('each anchor yields a LEFT and a RIGHT lamp (SA authors one per end and mirrors it)', () => {
      const lamps = lampsOf(car());

      expect(lamps).toHaveLength(4);
      const heads = lamps.filter((lamp) => lamp.kind === 'head');
      expect(heads.map((lamp) => lamp.position[0]).sort()).toEqual([-0.8, 0.8]);
      expect(heads.every((lamp) => lamp.position[1] === 1.8)).toBe(true);
    });

    it('heads face forward and tails face backward — a corona must not glow through the boot', () => {
      const lamps = lampsOf(car());

      for (const lamp of lamps) {
        expect(lamp.facing[1]).toBeCloseTo(lamp.kind === 'head' ? 1 : -1, 5);
      }
    });

    it('the whole lamp rig rotates with the car', () => {
      const lamps = lampsOf(car(Math.PI / 2)); // turned 90° left: the car now faces −X
      const head = lamps.find((lamp) => lamp.kind === 'head')!;

      expect(head.facing[0]).toBeCloseTo(-1, 5);
      expect(head.facing[1]).toBeCloseTo(0, 5);
      // Its position swung with it: the +Y-forward anchor is now out along −X.
      expect(head.position[0]).toBeCloseTo(-1.8, 5);
    });

    it('a driven car at night lights up, and brakes ride the driving state', () => {
      const vehicle = car();

      const lit = lampStateFor(vehicle, true, true, true, 0.5);

      expect(lit.car).toBe(vehicle);
      expect(lit.state).toEqual({ brakes: true, headlights: true, intensity: 0.5 });
    });
  });
});

describe('lampsOf (a rolled car)', () => {
  describe('positive cases', () => {
    it('the lamps ride the BODY, not the heading — a car on its roof has its lamps under it', () => {
      // A roll leaves `heading` untouched, so anything driven off the heading alone stays upright while the
      // car does not: the coronas visibly slid off the wreck in the field. The lamps must follow the chassis's
      // full orientation.
      const upright = lampsOf(car());
      const rolled = lampsOf(rolledCar());

      for (let lamp = 0; lamp < upright.length; lamp += 1) {
        // Rolled 180° about +Y: the lamp's own X and Z flip, its Y (fore/aft) does not.
        expect(rolled[lamp].position[0]).toBeCloseTo(-upright[lamp].position[0], 5);
        expect(rolled[lamp].position[1]).toBeCloseTo(upright[lamp].position[1], 5);
        expect(rolled[lamp].position[2]).toBeCloseTo(-upright[lamp].position[2], 5);
      }
      // And they still face fore/aft — the beam does not point into the ground because the car flipped.
      expect(rolled[0].facing[1]).toBeCloseTo(1, 5);
    });
  });
});
