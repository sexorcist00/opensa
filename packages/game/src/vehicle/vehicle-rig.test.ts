import { describe, expect, it } from 'vitest';

import type { VehicleWheelInfo } from './vehicle-handle';

import { FakeVehicleHandle } from './vehicle-handle.fake';
import { VehicleRig } from './vehicle-rig';

/** The rig emits ANGLES through the handle now (B5 step 3) — the renderer turns them into rotations. */
function rigWith(...wheels: VehicleWheelInfo[]): { handle: FakeVehicleHandle; rig: VehicleRig } {
  const handle = new FakeVehicleHandle([], wheels);

  return { handle, rig: new VehicleRig(handle) };
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
  });
});
