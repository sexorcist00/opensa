import { describe, expect, it } from 'vitest';

import type { AxleType } from '../interfaces/world-adapter.interface';
import type { VehicleWheelInfo } from './vehicle-handle';

import { FakeVehicleHandle } from './vehicle-handle.fake';
import { VehicleRig } from './vehicle-rig';

/** A four-wheeled car 1.6 m across the track, both axles built the same way (plan 081/06 §3). */
function carWith(type: AxleType, reverse = false): { handle: FakeVehicleHandle; rig: VehicleRig } {
  const wheels: VehicleWheelInfo[] = [
    { front: true, radius: 0.4 },
    { front: true, radius: 0.4 },
    { front: false, radius: 0.4 },
    { front: false, radius: 0.4 },
  ];
  const handle = new FakeVehicleHandle([], wheels);
  const axle = { reverse, type };
  const rig = new VehicleRig(handle, {
    axles: { front: axle, rear: axle },
    wheels: [
      { connection: [-0.8, 1.4, -0.3], front: true, radius: 0.4 }, // 0 = front LEFT (−X)
      { connection: [0.8, 1.4, -0.3], front: true, radius: 0.4 }, // 1 = front RIGHT
      { connection: [-0.8, -1.4, -0.3], front: false, radius: 0.4 },
      { connection: [0.8, -1.4, -0.3], front: false, radius: 0.4 },
    ],
  });

  return { handle, rig };
}

/** The rig emits ANGLES through the handle now (B5 step 3) — the renderer turns them into rotations. */
function rigWith(...wheels: VehicleWheelInfo[]): { handle: FakeVehicleHandle; rig: VehicleRig } {
  const handle = new FakeVehicleHandle([], wheels);

  return { handle, rig: new VehicleRig(handle) };
}

/** Settle the rig on a pose, then drive it to the target one (the smoothing needs a few steps). */
function settle(rig: VehicleRig, rest: readonly number[], target: readonly number[]): void {
  rig.setLift(rest);
  rig.update(0.016);
  rig.setLift(target);
  for (let step = 0; step < 60; step += 1) {
    rig.update(0.016);
  }
}

describe('VehicleRig', () => {
  describe('negative cases', () => {
    it('leaves wheels unrotated while idle (no speed, no steer)', () => {
      const { handle, rig } = rigWith({ front: true, radius: 1 });

      rig.update(1);

      expect(handle.wheelState[0].spin).toBeCloseTo(0);
      expect(handle.wheelState[0].steer).toBeCloseTo(0);
    });

    it('does not steer the rear wheels', () => {
      const { handle, rig } = rigWith({ front: false, radius: 1 });
      rig.setSteer(0.5);

      rig.update(0); // no distance → no spin; rear ignores steer

      expect(handle.wheelState[0].steer).toBe(0);
    });

    it('draws the wheel at the hub while no suspension has been fed in', () => {
      const { handle, rig } = rigWith({ front: false, radius: 1 });

      rig.update(1);

      expect(handle.wheelState[0].lift).toBe(0);
    });

    it('leans nothing on a car built without a suspension setup', () => {
      const { handle, rig } = rigWith({ front: false, radius: 1 });
      rig.setLift([-0.2]);

      rig.update(0.016);

      expect(handle.wheelState[0].camber).toBe(0);
    });

    it('leans nothing on a NOTILT axle, however far the two sides differ', () => {
      const { handle, rig } = carWith('notilt');

      settle(rig, [-0.1, -0.1, -0.1, -0.1], [0, -0.2, 0, -0.2]);

      expect(handle.wheelState[0].camber).toBe(0);
      expect(handle.wheelState[1].camber).toBe(0);
    });

    it('leans nothing while the car stands square on its springs', () => {
      const { handle, rig } = carWith('solid');

      settle(rig, [-0.1, -0.1, -0.1, -0.1], [-0.12, -0.12, -0.12, -0.12]);

      expect(handle.wheelState[0].camber).toBeCloseTo(0, 6);
      expect(handle.wheelState[3].camber).toBeCloseTo(0, 6);
    });
  });

  describe('positive cases', () => {
    it('rolls a wheel about its axle by distance / radius', () => {
      const { handle, rig } = rigWith({ front: false, radius: 2 });
      rig.setSpeed(4);

      rig.update(0.5); // distance = 2 → spin = −(2 / 2) = −1 rad

      expect(handle.wheelState[0].spin).toBeCloseTo(-1);
    });

    it('steers the front wheels', () => {
      const { handle, rig } = rigWith({ front: true, radius: 2 });
      rig.setSteer(0.3);

      rig.update(0); // no roll → pure steer

      expect(handle.wheelState[0].steer).toBeCloseTo(0.3);
      expect(handle.wheelState[0].spin).toBeCloseTo(0);
    });

    it('accumulates roll across updates', () => {
      const { handle, rig } = rigWith({ front: false, radius: 1 });
      rig.setSpeed(1);

      rig.update(1);
      rig.update(1); // total distance = 2 → spin −2

      expect(handle.wheelState[0].spin).toBeCloseTo(-2);
    });

    it('SEEDS the lift from the first sample — a spawned car must not visibly drop onto its springs', () => {
      const { handle, rig } = rigWith({ front: false, radius: 1 });

      rig.setLift([-0.12]);
      rig.update(0.016);

      expect(handle.wheelState[0].lift).toBeCloseTo(-0.12);
    });

    it('tilts a SOLID axle by the angle its own two lifts describe, both wheels alike', () => {
      const { handle, rig } = carWith('solid');

      // The body has rolled right: the right wheel stands 8 cm higher in its arch than the left one, across
      // a 1.6 m track → atan(−0.08 / 1.6) = −2.86°, and a beam keeps both wheels square to it.
      settle(rig, [-0.1, -0.1, -0.1, -0.1], [-0.14, -0.06, -0.14, -0.06]);

      expect(handle.wheelState[0].camber).toBeCloseTo(Math.atan2(-0.08, 1.6), 3);
      expect(handle.wheelState[1].camber).toBeCloseTo(handle.wheelState[0].camber, 6);
    });

    it('flips the lean on a REVERSE axle (mirrored wheel dummies)', () => {
      const straight = carWith('solid');
      const mirrored = carWith('solid', true);

      settle(straight.rig, [-0.1, -0.1, -0.1, -0.1], [-0.14, -0.06, -0.14, -0.06]);
      settle(mirrored.rig, [-0.1, -0.1, -0.1, -0.1], [-0.14, -0.06, -0.14, -0.06]);

      expect(mirrored.handle.wheelState[0].camber).toBeCloseTo(-straight.handle.wheelState[0].camber, 6);
    });

    it('leans an INDEPENDENT axle the same way as a solid one but far less — the two must be distinguishable', () => {
      const solid = carWith('solid');
      const independent = carWith('independent');

      settle(solid.rig, [-0.1, -0.1, -0.1, -0.1], [-0.14, -0.06, -0.14, -0.06]);
      settle(independent.rig, [-0.1, -0.1, -0.1, -0.1], [-0.14, -0.06, -0.14, -0.06]);

      const lean = independent.handle.wheelState[0].camber;
      expect(Math.sign(lean)).toBe(Math.sign(solid.handle.wheelState[0].camber));
      expect(Math.abs(lean)).toBeLessThan(Math.abs(solid.handle.wheelState[0].camber));
      expect(lean).toBeCloseTo(0.44 * (-0.08 / 2), 3); // the documented camber gain, on half the difference
    });

    it('reads the front axle for a front wheel and the rear axle for a rear one', () => {
      const handle = new FakeVehicleHandle(
        [],
        [
          { front: true, radius: 0.4 },
          { front: true, radius: 0.4 },
          { front: false, radius: 0.4 },
          { front: false, radius: 0.4 },
        ],
      );
      const rig = new VehicleRig(handle, {
        axles: { front: { reverse: false, type: 'notilt' }, rear: { reverse: false, type: 'solid' } },
        wheels: [
          { connection: [-0.8, 1.4, -0.3], front: true, radius: 0.4 },
          { connection: [0.8, 1.4, -0.3], front: true, radius: 0.4 },
          { connection: [-0.8, -1.4, -0.3], front: false, radius: 0.4 },
          { connection: [0.8, -1.4, -0.3], front: false, radius: 0.4 },
        ],
      });

      settle(rig, [-0.1, -0.1, -0.1, -0.1], [-0.14, -0.06, -0.14, -0.06]);

      expect(handle.wheelState[0].camber).toBe(0); // frozen front axle
      expect(handle.wheelState[2].camber).toBeCloseTo(Math.atan2(-0.08, 1.6), 3);
    });

    it('smooths later lift changes instead of snapping (raycast jitter must not read as a vibrating wheel)', () => {
      const { handle, rig } = rigWith({ front: false, radius: 1 });
      rig.setLift([-0.1]);
      rig.update(0.016);

      rig.setLift([-0.2]);
      rig.update(0.016); // one 60 Hz step at 25 1/s → 40 % of the way, not all of it

      expect(handle.wheelState[0].lift).toBeGreaterThan(-0.2);
      expect(handle.wheelState[0].lift).toBeLessThan(-0.1);
    });
  });
});
