import { Matrix4 } from '@opensa/math';
import { describe, expect, it } from 'vitest';

import type { ColliderShape, ModelColliders } from '../interfaces/collider.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { VehicleController } from './physics-world';

import { PhysicsWorld } from './physics-world';
import { initRapier } from './rapier';

const STEP = 1 / 60;

async function makeWorld(): Promise<PhysicsWorld> {
  return new PhysicsWorld(await initRapier());
}

function model(colliderShape: ColliderShape, transforms: Matrix4[]): ModelColliders {
  return { name: 'm', shape: colliderShape, transforms };
}

function shape(partial: Partial<ColliderShape> = {}): ColliderShape {
  return { boxes: [], indices: new Uint32Array(), spheres: [], vertices: new Float32Array(), ...partial };
}

describe('PhysicsWorld', () => {
  describe('positive cases', () => {
    it('drops a dynamic box under gravity until it rests on a static ground', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top surface at z = 0.5
      const box = physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]);

      for (let i = 0; i < 240; i += 1) {
        physics.step(STEP);
      }

      // rests with its centre at ground-top (0.5) + half-height (0.5) = 1.0
      expect(physics.readBody(box).position[2]).toBeCloseTo(1, 1);
      physics.dispose();
    });

    it('reports the body falling before it lands', async () => {
      const physics = await makeWorld();
      const box = physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]); // no ground

      physics.step(STEP);
      const { position } = physics.readBody(box);

      expect(position[2]).toBeLessThan(5);
      expect(position[0]).toBe(0);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.groundBelow', () => {
  describe('negative cases', () => {
    it('returns null when nothing is below within maxDrop', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top at z = 0.5
      physics.step(STEP); // build the query pipeline so the ray sees the ground

      expect(physics.groundBelow([0, 0, 5], 2)).toBeNull(); // ground is 4.5 below, beyond maxDrop 2
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('finds the Z of the ground directly below the position', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top surface at z = 0.5
      physics.step(STEP);

      expect(physics.groundBelow([0, 0, 10], 100)).toBeCloseTo(0.5, 3);
      physics.dispose();
    });

    it('excludeBody skips the caster so a ray can start inside its own capsule (074/10 B3 feet ray)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top surface at z = 0.5
      const capsule = physics.createKinematicCapsule([0, 0, 1.4], 0.35, 0.55); // resting on the ground
      physics.step(STEP);

      // From inside the capsule: without the exclusion the ray reports the capsule itself (its own
      // surface right at the origin); with it, the true ground below.
      expect(physics.groundBelow([0, 0, 1.4], 5)).toBeCloseTo(1.4, 2);
      expect(physics.groundBelow([0, 0, 1.4], 5, capsule.body)).toBeCloseTo(0.5, 3);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.createDynamicVehicle', () => {
  const HALF: [number, number, number] = [1.2, 2.5, 0.7];

  describe('negative cases', () => {
    it('does not crash when the model has no COL (null shape) — falls back to the halfExtents box', async () => {
      const physics = await makeWorld();
      expect(() => physics.createDynamicVehicle([0, 0, 5], 0, null, 1500, [], HALF)).not.toThrow();
      physics.dispose();
    });

    it('does not crash for a shape with no primitives and no vertices', async () => {
      const physics = await makeWorld();
      expect(() => physics.createDynamicVehicle([0, 0, 5], 0, shape(), 1500, [], HALF)).not.toThrow();
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('builds a convex hull from a vertices-only shape and rests it on the ground', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [20, 20, 0.5]); // top surface at z = 0.5
      // eight corners of a 1m cube → a valid convex hull (half-height 0.5)
      const cube = new Float32Array([
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5,
        0.5, 0.5, 0.5, 0.5,
      ]);
      const { body } = physics.createDynamicVehicle([0, 0, 5], 0, shape({ vertices: cube }), 1500, [], HALF);

      for (let i = 0; i < 240; i += 1) {
        physics.step(STEP);
      }

      expect(physics.readBody(body).position[2]).toBeCloseTo(1, 0); // ground-top 0.5 + half-height 0.5
      physics.dispose();
    });
  });
});

describe('PhysicsWorld kinematic character controller', () => {
  describe('positive cases', () => {
    it('lands a kinematic capsule on a static ground and reports grounded', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top surface at z = 0.5
      const controller = physics.createCharacterController();
      const { body, collider } = physics.createKinematicCapsule([0, 0, 3], 0.3, 0.6);

      let grounded = false;
      for (let i = 0; i < 240; i += 1) {
        grounded = physics.moveCharacter(controller, body, collider, [0, 0, -0.05]).grounded;
        physics.step(STEP);
      }

      expect(grounded).toBe(true);
      // centre rests at ground-top (0.5) + capsule half-height (0.6 + radius 0.3) = 1.4
      expect(physics.readBody(body).position[2]).toBeCloseTo(1.4, 1);
      physics.dispose();
    });

    it('slides along a wall instead of penetrating it', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // ground
      physics.createStaticBox([2, 0, 1.5], [0.5, 5, 2]); // wall, front face at x = 1.5
      const controller = physics.createCharacterController();
      const { body, collider } = physics.createKinematicCapsule([0, 0, 1.4], 0.3, 0.6);

      for (let i = 0; i < 120; i += 1) {
        physics.moveCharacter(controller, body, collider, [0.1, 0, -0.02]); // push into the wall
        physics.step(STEP);
      }

      // stopped in front of the wall (front 1.5 − radius 0.3 − offset), never penetrating it
      expect(physics.readBody(body).position[0]).toBeLessThan(1.25);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.createStaticColliders / removeBodies', () => {
  describe('negative cases', () => {
    it('creates no bodies for no models', async () => {
      const physics = await makeWorld();
      expect(physics.createStaticColliders([])).toHaveLength(0);
      physics.dispose();
    });

    it('creates no body for a placement with only degenerate shapes', async () => {
      const physics = await makeWorld();
      expect(physics.createStaticColliders([model(shape(), [new Matrix4()])])).toHaveLength(0);
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('returns one body handle per placement', async () => {
      const physics = await makeWorld();
      const colliderShape = shape({
        boxes: [{ max: [1, 1, 1], min: [-1, -1, -1] }],
        indices: new Uint32Array([0, 1, 2]),
        spheres: [{ center: [0, 0, 0], radius: 1 }],
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      });
      const transforms = [new Matrix4(), new Matrix4().makeTranslation(10, 0, 0)];

      // one body per placement (each carrying trimesh + box + sphere)
      expect(physics.createStaticColliders([model(colliderShape, transforms)])).toHaveLength(2);
      physics.dispose();
    });

    it('removeBodies frees the ground so a resting box falls again', async () => {
      const physics = await makeWorld();
      const ground = model(shape({ boxes: [{ max: [10, 10, 0.5], min: [-10, -10, -0.5] }] }), [new Matrix4()]);
      const handles = physics.createStaticColliders([ground]); // top surface at z = 0.5
      const box = physics.createBox([0, 0, 2], [0.5, 0.5, 0.5]);

      for (let i = 0; i < 180; i += 1) {
        physics.step(STEP);
      }
      expect(physics.readBody(box).position[2]).toBeCloseTo(1, 1); // rests on the ground

      physics.removeBodies(handles);
      for (let i = 0; i < 180; i += 1) {
        physics.step(STEP);
      }
      expect(physics.readBody(box).position[2]).toBeLessThan(0); // ground gone → falls through
      physics.dispose();
    });

    it('hands each breakable placement key back with the body that carries it (plan 045)', async () => {
      const physics = await makeWorld();
      const box = shape({ boxes: [{ max: [1, 1, 1], min: [-1, -1, -1] }] });
      const breakable: ModelColliders = {
        ...model(box, [new Matrix4(), new Matrix4().makeTranslation(5, 0, 0)]),
        instanceKeys: ['bin@0', 'bin@5'],
      };
      const seen: [string, number][] = [];

      const handles = physics.createStaticColliders([breakable], (key, handle) => seen.push([key, handle]));

      // key → handle, in placement order: a smashed prop must be able to drop exactly its own body.
      expect(seen).toEqual([
        ['bin@0', handles[0]],
        ['bin@5', handles[1]],
      ]);
      physics.dispose();
    });

    it('does not report a breakable key for a placement that produced no body', async () => {
      const physics = await makeWorld();
      const degenerate: ModelColliders = { ...model(shape(), [new Matrix4()]), instanceKeys: ['ghost@0'] };
      const seen: string[] = [];

      expect(physics.createStaticColliders([degenerate], (key) => seen.push(key))).toHaveLength(0);
      expect(seen).toEqual([]); // no body was kept, so no key may be registered against one
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.census', () => {
  describe('negative cases', () => {
    it('counts nothing in a fresh world', async () => {
      const physics = await makeWorld();
      expect(physics.census()).toEqual({ bodies: 0, colliders: 0 });
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('counts every body and collider, and drops back after a removal', async () => {
      const physics = await makeWorld();
      const ground = physics.createStaticBox([0, 0, 0], [10, 10, 0.5]);
      physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]);

      expect(physics.census()).toEqual({ bodies: 2, colliders: 2 });

      physics.removeBodies([ground]);

      expect(physics.census()).toEqual({ bodies: 1, colliders: 1 }); // the collider goes with its body
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.createCharacterBody', () => {
  describe('positive cases', () => {
    it('stays upright when shoved off-centre (rotations are locked)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]);
      const body = physics.createCharacterBody([0, 0, 1.5], [0.3, 0.3, 0.9]);

      physics.pushAt(body, [500, 0, 0], [0, 0, 2.4]); // a hard shove high up would topple a free body
      for (let i = 0; i < 120; i += 1) {
        physics.step(STEP);
      }

      expect(physics.readBody(body).quaternion).toEqual([0, 0, 0, 1]);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld velocity helpers', () => {
  describe('positive cases', () => {
    it('reads back the velocity it was given', async () => {
      const physics = await makeWorld();
      const body = physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]);

      physics.setLinvel(body, [1, 2, 3]);

      expect(physics.getLinvel(body)).toEqual([1, 2, 3]);
      physics.dispose();
    });

    it('seedReverse drives the body backwards along its heading, keeping the vertical velocity', async () => {
      const physics = await makeWorld();
      const body = physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]);
      physics.setLinvel(body, [0, 0, -4]);

      physics.seedReverse(body, 0, 3); // heading 0 = facing +Y, so reverse is −Y

      const [x, y, z] = physics.getLinvel(body);
      expect(x).toBeCloseTo(0, 5);
      expect(y).toBeCloseTo(-3, 5);
      expect(z).toBeCloseTo(-4, 5); // gravity component untouched
      physics.dispose();
    });

    it('holdBody pins a moving body at a pose with zero velocity (the player slides in undisturbed)', async () => {
      const physics = await makeWorld();
      const body = physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]);
      physics.setLinvel(body, [10, 10, 10]);

      physics.holdBody(body, [1, 2, 3], [0, 0, 0, 1]);

      expect(physics.getLinvel(body)).toEqual([0, 0, 0]);
      expect(physics.readBody(body).position).toEqual([1, 2, 3]);
      physics.dispose();
    });

    it('teleport also sets the kinematic target so the next step cannot pull the body back', async () => {
      const physics = await makeWorld();
      const { body } = physics.createKinematicCapsule([0, 0, 5], 0.3, 0.6);

      physics.teleport(body, [4, 5, 6]);
      physics.step(STEP);

      expect(physics.readBody(body).position).toEqual([4, 5, 6]);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.isGrounded', () => {
  describe('negative cases', () => {
    it('is false with nothing under the body within half-height + epsilon', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top at z = 0.5
      const box = physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]);
      physics.step(STEP);

      expect(physics.isGrounded(box, 0.5)).toBe(false);
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('is true for a body resting on the ground (and ignores the body own collider)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top at z = 0.5
      const box = physics.createBox([0, 0, 1], [0.5, 0.5, 0.5]); // resting
      physics.step(STEP);

      expect(physics.isGrounded(box, 0.5)).toBe(true);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.overlapsBox', () => {
  describe('negative cases', () => {
    it('is false on an empty spot (the spawn is free)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [1, 1, 1]);
      physics.step(STEP);

      expect(physics.overlapsBox([20, 0, 0], 0, [1.2, 2.5, 0.7])).toBe(false);
      physics.dispose();
    });

    it('is false when the heading rotates the long axis away from an obstacle', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 2.5, 0], [0.5, 0.5, 0.5]); // obstacle 2.5 m along +Y
      physics.step(STEP);

      // Unrotated the 2.5-long half-axis is +Y and reaches it; turned 90° that axis points along X.
      expect(physics.overlapsBox([0, 0, 0], 0, [1.2, 2.5, 0.7])).toBe(true);
      expect(physics.overlapsBox([0, 0, 0], Math.PI / 2, [1.2, 2.5, 0.7])).toBe(false);
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('is true where a body already stands (a car spawned there would be ejected)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [1, 1, 1]);
      physics.step(STEP);

      expect(physics.overlapsBox([0, 0, 0], 0, [1.2, 2.5, 0.7])).toBe(true);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld collider toggles', () => {
  /** Drop a box onto the player's capsule; returns where the box ended up after `mutate`. */
  async function drop(mutate: (physics: PhysicsWorld, collider: number) => void): Promise<number> {
    const physics = await makeWorld();
    const { collider } = physics.createKinematicCapsule([0, 0, 0], 2, 2); // a fat obstacle
    mutate(physics, collider);
    const box = physics.createBox([0, 0, 6], [0.5, 0.5, 0.5]);

    for (let i = 0; i < 240; i += 1) {
      physics.step(STEP);
    }
    const z = physics.readBody(box).position[2];
    physics.dispose();

    return z;
  }

  describe('negative cases', () => {
    // How the seated rider stops shoving his car (`enter-vehicle.system`): a sensor, not a disabled collider.
    it('a sensor collider applies no contact force, so a box falls straight through it', async () => {
      expect(await drop((physics, collider) => physics.setColliderSensor(collider, true))).toBeLessThan(-2);
    });

    it('turning the sensor back off makes it solid again (the player back on foot)', async () => {
      const solidAgain = await drop((physics, collider) => {
        physics.setColliderSensor(collider, true);
        physics.setColliderSensor(collider, false);
      });

      expect(solidAgain).toBeCloseTo(4.5, 1);
    });
  });

  describe('positive cases', () => {
    it('an untouched collider holds the box up (the control for the toggles above)', async () => {
      expect(await drop(() => undefined)).toBeCloseTo(4.5, 1); // capsule top 4 + box half 0.5
    });
  });
});

describe('PhysicsWorld raycast vehicle', () => {
  const HALF: [number, number, number] = [1.2, 2.5, 0.7];
  const WHEELS = [
    // Hubs BELOW the hull bottom (−0.7), so the wheels carry the car instead of the chassis box grinding.
    { connection: [-0.8, 1.4, -0.5] as Vec3, radius: 0.35 },
    { connection: [0.8, 1.4, -0.5] as Vec3, radius: 0.35 },
    { connection: [-0.8, -1.4, -0.5] as Vec3, radius: 0.35 },
    { connection: [0.8, -1.4, -0.5] as Vec3, radius: 0.35 },
  ];
  const FRONT = [{ front: true }, { front: true }, { front: false }, { front: false }];

  /** A ground plane + one car resting on it. */
  async function car(): Promise<{
    body: number;
    controller: VehicleController;
    physics: PhysicsWorld;
  }> {
    const physics = await makeWorld();
    physics.createStaticBox([0, 0, -0.5], [200, 200, 0.5]); // top surface at z = 0
    const chassis = shape({ boxes: [{ max: [1.2, 2.5, 0.7], min: [-1.2, -2.5, -0.7] }] });
    const { body, controller } = physics.createDynamicVehicle([0, 0, 1.2], 0, chassis, 1500, WHEELS, HALF);
    for (let i = 0; i < 120; i += 1) {
      physics.step(STEP);
    }

    return { body, controller, physics };
  }

  describe('negative cases', () => {
    it('a parked car stays put — the parking brake is on from creation', async () => {
      const { body, physics } = await car();
      const start = physics.readBody(body).position;

      for (let i = 0; i < 180; i += 1) {
        physics.step(STEP);
      }

      const now = physics.readBody(body).position;
      expect(Math.hypot(now[0] - start[0], now[1] - start[1])).toBeLessThan(0.1);
      physics.dispose();
    });

    it('stepping after removeVehicle does not panic on the orphaned controller', async () => {
      const { body, controller, physics } = await car();

      physics.removeVehicle(controller); // documented order: controller first, THEN the chassis body
      physics.removeBodies([body]);

      expect(() => physics.step(STEP)).not.toThrow();
      expect(physics.census().bodies).toBe(1); // only the ground is left — no leaked chassis
      physics.dispose();
    });

    it('removeVehicle is safe for a controller that was already removed', async () => {
      const { controller, physics } = await car();
      physics.removeVehicle(controller);

      expect(() => physics.removeVehicle(controller)).not.toThrow();
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('rests on its suspension above the road (the hull does not sink into it)', async () => {
      const { body, physics } = await car();

      expect(physics.readBody(body).position[2]).toBeGreaterThan(0.5);
      physics.dispose();
    });

    it('engine force drives it forward, and parkVehicle brings it back to a stop', async () => {
      const { controller, physics } = await car();

      physics.setVehicleControls(controller, FRONT, 12000, 0, 0);
      for (let i = 0; i < 180; i += 1) {
        physics.step(STEP);
      }
      expect(physics.vehicleSpeed(controller)).toBeGreaterThan(1);

      physics.parkVehicle(controller);
      for (let i = 0; i < 300; i += 1) {
        physics.step(STEP);
      }

      expect(Math.abs(physics.vehicleSpeed(controller))).toBeLessThan(0.5);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld impacts', () => {
  /** Slam a heavy dynamic box into a static wall hard enough to clear the contact-force threshold. */
  async function collide(): Promise<PhysicsWorld> {
    const physics = await makeWorld();
    physics.createStaticBox([0, 0, -0.5], [50, 50, 0.5]);
    const chassis = shape({ boxes: [{ max: [1, 1, 1], min: [-1, -1, -1] }] });
    const { body } = physics.createDynamicVehicle([0, 0, 1.2], 0, chassis, 1500, [], [1, 1, 1]);
    physics.createStaticBox([0, 6, 1], [5, 0.5, 3]); // wall ahead
    physics.setLinvel(body, [0, 15, 0]); // 1500 kg at 15 m/s — well past the 400 N event threshold
    for (let i = 0; i < 120; i += 1) {
      physics.step(STEP);
    }

    return physics;
  }

  describe('negative cases', () => {
    it('drains empty when nothing touched anything', async () => {
      const physics = await makeWorld();
      physics.step(STEP);

      expect(physics.takeImpacts()).toEqual([]);
      expect(physics.takeBreakableImpacts()).toEqual([]);
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('the vehicle-damage and breakable buffers drain INDEPENDENTLY (neither starves the other)', async () => {
      const physics = await collide();

      const damage = physics.takeImpacts();
      const breakable = physics.takeBreakableImpacts();

      expect(damage.length).toBeGreaterThan(0);
      expect(breakable).toEqual(damage); // the same events reached both, in the same order
      expect(physics.takeImpacts()).toEqual([]); // and each drains once
      expect(physics.takeBreakableImpacts()).toEqual([]);
      physics.dispose();
    });

    it('an impact names both bodies and a world-space contact point', async () => {
      const physics = await collide();

      const [impact] = physics.takeImpacts();

      expect(impact.bodyA).not.toBeNull();
      expect(impact.bodyB).not.toBeNull();
      expect(impact.force).toBeGreaterThan(0);
      expect(impact.point).not.toBeNull();
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.createFalling', () => {
  const BOX = { centre: [0, 0, 0] as Vec3, half: [0.2, 0.2, 4] as Vec3 };
  /** Eight corners of a 1 m cube — a hull Rapier accepts. */
  const CUBE = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
    0.5, 0.5, 0.5,
  ]);

  describe('negative cases', () => {
    it('does NOT reach its box fallback for an empty mesh — Rapier hands back an invalid hull desc', async () => {
      const physics = await makeWorld();

      // Pinned as the ACTUAL behaviour: `convexHull` returns a non-null but invalid desc for degenerate
      // input (`addConvexChassis` documents exactly this and guards with try/catch), so `createFalling`'s
      // `?? cuboid(...)` never fires and `createCollider` throws instead of falling back.
      expect(() =>
        physics.createFalling([0, 0, 6], [0, 0, 0, 1], 50, new Float32Array(), {
          centre: [0, 0, 0],
          half: [0.2, 0.2, 0.5],
        }),
      ).toThrow();
      physics.dispose();
    });

    it('a felled prop passes THROUGH a car instead of solving against it (PROP_GROUPS)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, -0.5], [50, 50, 0.5]); // top at z = 0
      const chassis = shape({ boxes: [{ max: [1.2, 2.5, 0.7], min: [-1.2, -2.5, -0.7] }] });
      physics.createDynamicVehicle([0, 0, 0.7], 0, chassis, 1500, [], [1.2, 2.5, 0.7]);
      // Dropped straight onto the car's roof: if it collided with the chassis it would rest at ~1.9.
      const prop = physics.createFalling([0, 0, 5], [0, 0, 0, 1], 50, CUBE, BOX);

      for (let i = 0; i < 300; i += 1) {
        physics.step(STEP);
      }

      expect(physics.readBody(prop).position[2]).toBeCloseTo(0.5, 1); // reached the GROUND, not the roof
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('keeps the placed heading instead of snapping upright the instant it becomes a body', async () => {
      const physics = await makeWorld();
      const tilt: [number, number, number, number] = [Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8)];

      const prop = physics.createFalling([0, 0, 20], tilt, 50, CUBE, BOX);

      const { quaternion } = physics.readBody(prop);
      expect(quaternion[0]).toBeCloseTo(tilt[0], 5);
      expect(quaternion[3]).toBeCloseTo(tilt[3], 5);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.ignoreVehicles', () => {
  /** The player's capsule standing on the ground with a car dropped straight onto it. */
  async function scene(ignore: boolean): Promise<number> {
    const physics = await makeWorld();
    physics.createStaticBox([0, 0, -0.5], [50, 50, 0.5]); // top at z = 0
    const capsule = physics.createKinematicCapsule([0, 0, 0.9], 0.4, 0.5);
    physics.ignoreVehicles(capsule.collider, ignore);
    const chassisShape = shape({ boxes: [{ max: [1.2, 2.5, 0.7], min: [-1.2, -2.5, -0.7] }] });
    const { body } = physics.createDynamicVehicle([0, 0, 5], 0, chassisShape, 1500, [], [1.2, 2.5, 0.7]);

    for (let i = 0; i < 300; i += 1) {
      physics.step(STEP);
    }
    const z = physics.readBody(body).position[2];
    physics.dispose();

    return z;
  }

  describe('negative cases', () => {
    it('while ignoring, the chassis passes through the player and lands on the road', async () => {
      expect(await scene(true)).toBeCloseTo(0.7, 1); // hull half-height above the ground
    });
  });

  describe('positive cases', () => {
    it('by default the chassis solves against the player and comes to rest ON him', async () => {
      expect(await scene(false)).toBeGreaterThan(1.5);
    });
  });
});

describe('PhysicsWorld kinematic character on a car', () => {
  describe('positive cases', () => {
    it('a walking player stands on a parked car roof (vanilla lets you climb on cars)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, -0.5], [50, 50, 0.5]); // top at z = 0
      const chassisShape = shape({ boxes: [{ max: [1.2, 2.5, 0.7], min: [-1.2, -2.5, -0.7] }] });
      physics.createDynamicVehicle([0, 0, 0.7], 0, chassisShape, 1500, [], [1.2, 2.5, 0.7]);
      const controller = physics.createCharacterController();
      const capsule = physics.createKinematicCapsule([0, 0, 3], 0.3, 0.6);

      let grounded = false;
      for (let i = 0; i < 240; i += 1) {
        grounded = physics.moveCharacter(controller, capsule.body, capsule.collider, [0, 0, -0.05]).grounded;
        physics.step(STEP);
      }

      expect(grounded).toBe(true);
      expect(physics.readBody(capsule.body).position[2]).toBeGreaterThan(2); // roof (1.4) + capsule half 0.9
      physics.dispose();
    });
  });
});
