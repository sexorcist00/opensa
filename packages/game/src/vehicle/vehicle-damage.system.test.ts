import { beforeEach, describe, expect, it } from 'vitest';

import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { Impact, PhysicsWorld } from '../physics/physics-world';

import { Logger } from '../diagnostics/logger';
import { VehicleDamageSystem } from './vehicle-damage.system';
import { FakeVehicleHandle } from './vehicle-handle.fake';

const SILENT_LOGGER = new Logger({ emit: (): undefined => undefined }, { showLogs: false });
const STRONG = 300000; // STRONG_HIT
const CAR_BODY = 7;

/** A fake physics world: a queued impact list (drained by takeImpacts) and an identity car body. */
function fakePhysics(): { impacts: Impact[]; world: PhysicsWorld } {
  const impacts: Impact[] = [];
  const world = {
    readBody: (): { position: Vec3; quaternion: [number, number, number, number] } => ({
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1], // identity → world point == car-local point
    }),
    takeImpacts: (): Impact[] => impacts.splice(0, impacts.length),
  } as unknown as PhysicsWorld;

  return { impacts, world };
}

function impact(force: number, point: null | Vec3): Impact {
  return { bodyA: CAR_BODY, bodyB: null, force, point };
}

describe('VehicleDamageSystem', () => {
  let physics: { impacts: Impact[]; world: PhysicsWorld };
  let system: VehicleDamageSystem;
  let handle: FakeVehicleHandle;

  beforeEach(() => {
    physics = fakePhysics();
    system = new VehicleDamageSystem(physics.world, SILENT_LOGGER);
    handle = new FakeVehicleHandle([
      { name: 'bonnet', position: [0, 2, 0] }, // front
      { name: 'boot', position: [0, -2, 0] }, // rear
    ]);
    system.add({ body: CAR_BODY, handle });
  });

  describe('negative cases', () => {
    it('ignores a weak impact (below the strong-hit threshold)', () => {
      physics.impacts.push(impact(STRONG - 1, [0, 2, 0]));
      system.update(0.016);
      expect(handle.damaged.size).toBe(0);
    });

    it('ignores an impact with no contact point', () => {
      physics.impacts.push(impact(STRONG * 2, null));
      system.update(0.016);
      expect(handle.damaged.size).toBe(0);
    });

    it('ignores an impact on a body it does not own', () => {
      physics.impacts.push({ bodyA: 999, bodyB: 998, force: STRONG * 2, point: [0, 2, 0] });
      system.update(0.016);
      expect(handle.damaged.size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('deforms the part nearest the hit (swaps ok→dam)', () => {
      physics.impacts.push(impact(STRONG, [0, 2, 0])); // at the bonnet
      system.update(0.016);
      expect(handle.damaged.has('bonnet')).toBe(true);
      expect(handle.damaged.has('boot')).toBe(false); // the rear panel is untouched
    });

    it('detaches an already-damaged part on a second strong hit', () => {
      physics.impacts.push(impact(STRONG, [0, 2, 0]));
      system.update(0.016); // deform
      physics.impacts.push(impact(STRONG, [0, 2, 0]));
      system.update(0.016); // detach

      expect(handle.detached.has('bonnet')).toBe(true);
      // It falls as WORLD-space data now: the system poses it through the handle every frame.
      expect(handle.poses.get('bonnet')).toBeDefined();
    });

    it('changes a part state at most once per frame (deform XOR detach)', () => {
      // Two strong hits on the bonnet in one update: it should deform, not deform AND detach.
      physics.impacts.push(impact(STRONG, [0, 2, 0]), impact(STRONG, [0, 2, 0]));
      system.update(0.016);

      expect(handle.damaged.has('bonnet')).toBe(true);
      expect(handle.detached.has('bonnet')).toBe(false);
    });

    it('a detached part falls (gravity pulls its pose down) and is removed once its time expires', () => {
      physics.impacts.push(impact(STRONG, [0, 2, 0]));
      system.update(0.016); // deform
      physics.impacts.push(impact(STRONG, [0, 2, 0]));
      system.update(0.016); // detach → starts falling (TTL 1.5s)
      system.update(0.5);
      const falling = handle.poses.get('bonnet');
      expect(falling?.position[2]).toBeLessThan(0); // gravity beat the initial upward knock

      system.update(2); // past FALL_TTL

      expect(handle.removed.has('bonnet')).toBe(true);
      expect(handle.detached.has('bonnet')).toBe(false);
    });
  });
});
