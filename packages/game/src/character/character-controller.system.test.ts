import { addComponent, addEntity } from 'bitecs';
import { describe, expect, it } from 'vitest';

import type { KeyboardInput } from '../input';
import type { Config } from '../interfaces/config.interface';
import type { CharacterController } from '../physics/physics-world';

import { Locomotion, PlayerControlled, RigidBody, Transform, Velocity } from '../ecs/components';
import { createEcsWorld } from '../ecs/world';
import { KeyboardSource } from '../input';
import { PhysicsWorld } from '../physics/physics-world';
import { initRapier } from '../physics/rapier';
import { CharacterControllerSystem, type LookDirectionSource } from './character-controller.system';

const STEP = 1 / 60;

// A default camera looks down −Z, which maps to GTA +Y → "forward" is +Y (north).
const CAMERA: LookDirectionSource = { getWorldDirection: (target) => target.set(0, 0, -1) };

interface Player {
  controller: CharacterController;
  eid: number;
  physics: PhysicsWorld;
  world: ReturnType<typeof createEcsWorld>;
}

function config(gameState: Config['gameState']): Config {
  return {
    camera: {
      followDistance: 12,
      followHeight: 1.5,
      followLerp: 3,
      followMaxPolar: 1.5,
      followMinPolar: 0.25,
      followPolar: 1.15,
      followZoom: true,
      followZoomMax: 40,
      followZoomMin: 6,
    },
    controls: { back: 'KeyS', forward: 'KeyW', jump: 'Space', left: 'KeyA', right: 'KeyD' },
    fog: { distance: 800, timecycScale: 1 },
    fonts: { hud: { clock: 'SixCaps-Regular', zone: 'SixCaps-Regular' } },
    gameState,
    graphics: {
      bloom: { enabled: true, intensity: 0.7, threshold: 0.7 },
      clouds: { coverage: 0.5, opacity: 0.85, volumetric: false },
      effects: { drawDistance: 150, enabled: true },
      headlights: {
        beamIntensity: 2.2,
        beamRange: 34,
        brakeIntensity: 1.6,
        coronaIntensity: 0.8,
        coronaSize: 0.28,
        intensity: 1,
      },
      lights: { enabled: true, nightEndHour: 6, nightStartHour: 20 },
      moon: { brightness: 1, elevationDeg: 35, size: 150 },
      night: {
        coronaDrawDistance: 120,
        dynamicObjectsFill: { rim: 0.5, strength: 0.35 },
        emissiveBoost: 1.6,
        litFade: { dawnEnd: 7, dawnStart: 6, duskEnd: 21, duskStart: 20 },
        skyGlow: 1,
        skylight: 0.6,
        windowGlow: 1,
      },
      pipeline: 'classic',
      procobj: {
        bushes: { density: 1, drawDistance: 80, enabled: true },
        cacti: { density: 1, drawDistance: 100, enabled: true },
        flowers: { density: 1, drawDistance: 50, enabled: true },
        grass: { density: 1, drawDistance: 50, enabled: true },
        rocks: { density: 1, drawDistance: 80, enabled: true },
        trees: { density: 1, drawDistance: 150, enabled: true },
        underwater: { density: 1, drawDistance: 60, enabled: true },
      },
      renderScale: 1,
      shadows: { distance: 800, enabled: true },
      sky: { density: 0.96, exposure: 0.5, model: 'classic', mood: 0.7, pbrExposure: 0.55, weight: 0.4 },
      ssao: { enabled: true, intensity: 1.5, radius: 0.2 },
      stars: { enabled: true },
      sun: { godrays: true, godraysSize: 30, sunSize: 15 },
      toneMapping: false,
      toneMappingMode: 'aces',
      vehicleReflection: { intensity: 1, preset: 'enhanced' },
      water: {
        darkness: 0.55,
        foam: 1,
        glint: 1.5,
        reflection: 0.6,
        shore: true,
        shoreClarity: 0.55,
        shoreDepth: 6,
        waves: 1,
      },
      worldLight: {
        dayBrightness: 0.85,
        duskBrightness: 0.45,
        lodNightAmbScale: 1.6,
        nightPrelitBrightness: 0.7,
        shadowStrength: 0.55,
        sunDirect: 1,
        sunIndirect: 0.7,
      },
    },
    hud: {
      clock: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 52 },
      zone: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 40 },
    },
    mapViewer: false,
    movement: {
      accel: 20,
      airControl: 0.3,
      deceleration: 25,
      jumpSpeed: 6,
      runSpeed: 26,
      turnRateFullDeg: 240,
      turnRateIdleDeg: 720,
      walkSpeed: 10,
    },
    showCollision: false,
    showLogs: false,
    staticUrl: '',
    streaming: { cellSize: 250, collisionDrawDistance: 150, hdDrawDistance: 300, lodDrawDistance: 1500 },
    time: { secondsPerGameMinute: 3 },
    vehicle: { hdDistance: 80, lodDistance: 250, unloadDistance: 500 },
    weatherTransitionSeconds: 0,
  };
}

/** A kinematic capsule resting on a static ground, plus its ECS entity. */
async function groundedPlayer(): Promise<Player> {
  const physics = new PhysicsWorld(await initRapier());
  physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top at z = 0.5
  const controller = physics.createCharacterController();
  const { body, collider } = physics.createKinematicCapsule([0, 0, 1.4], 0.3, 0.6); // rests on the ground

  const world = createEcsWorld();
  const eid = addEntity(world);
  addComponent(world, eid, PlayerControlled);
  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Velocity);
  addComponent(world, eid, Locomotion);
  RigidBody.handle[eid] = body;
  RigidBody.collider[eid] = collider;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Velocity.z[eid] = 0;
  Velocity.grounded[eid] = 0;
  Locomotion.heading[eid] = 0; // facing +Y (north), where the test camera walks W toward
  physics.step(STEP); // build the query pipeline so the controller sees the ground

  return { controller, eid, physics, world };
}

function keys(...codes: string[]): KeyboardInput {
  const down = new Set(codes);

  return { isDown: (code) => down.has(code) };
}

function run(player: Player, cfg: Config, ...held: string[]): void {
  new CharacterControllerSystem(
    player.world,
    player.physics,
    new KeyboardSource(keys(...held), cfg.controls),
    cfg,
    player.controller,
    CAMERA,
  ).fixedUpdate(STEP);
  player.physics.step(STEP); // mirror the controller → physics step order
}

describe('CharacterControllerSystem', () => {
  describe('negative cases', () => {
    it('applies no input while paused', async () => {
      const player = await groundedPlayer();
      Velocity.x[player.eid] = 3;

      run(player, config('pause'), 'KeyW');

      expect(Velocity.x[player.eid]).toBe(3); // untouched
      player.physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('accelerates forward (+Y) toward — but not instantly to — walk speed', async () => {
      const player = await groundedPlayer();

      run(player, config('play'), 'KeyW');

      // one step: ramping up, not yet at walk speed (10), and no sideways drift
      expect(Velocity.y[player.eid]).toBeGreaterThan(0);
      expect(Velocity.y[player.eid]).toBeLessThan(10);
      expect(Velocity.x[player.eid]).toBe(0);
      player.physics.dispose();
    });

    it('reaches the target speed after sustained input', async () => {
      const player = await groundedPlayer();
      for (let i = 0; i < 120; i += 1) {
        run(player, config('play'), 'KeyW');
      }
      expect(Velocity.y[player.eid]).toBeCloseTo(10, 1); // settled at walk speed
      player.physics.dispose();
    });

    it('decelerates toward rest (inertia) when keys are released', async () => {
      const player = await groundedPlayer();
      Velocity.x[player.eid] = 5;
      Velocity.y[player.eid] = 5;

      run(player, config('play')); // no keys held

      // slowing toward 0 but not there in a single step
      expect(Velocity.x[player.eid]).toBeLessThan(5);
      expect(Velocity.x[player.eid]).toBeGreaterThan(0);
      player.physics.dispose();
    });

    it('jumps (+Z velocity) on the jump key when grounded', async () => {
      const player = await groundedPlayer();
      run(player, config('play')); // settle → grounded
      expect(Velocity.grounded[player.eid]).toBe(1);

      run(player, config('play'), 'Space');

      expect(Velocity.z[player.eid]).toBeGreaterThan(0);
      player.physics.dispose();
    });

    it('fly mode lifts off on activation, then climbs on jump at 2x run speed (run animation, never falling)', async () => {
      const player = await groundedPlayer();
      addComponent(player.world, player.eid, Transform);
      const handle = RigidBody.handle[player.eid];
      const z = (): number => player.physics.readBody(handle).position[2];
      const grounded = z();
      const system = systemFor(player, keys('Space')); // Space = jump = up

      system.setFlying(true);
      player.physics.step(STEP); // apply the lift teleport
      expect(system.isFlying()).toBe(true);
      expect(z()).toBeCloseTo(grounded + 4, 1); // immediate lift-off (FLY_INITIAL_LIFT)

      const lifted = z();
      system.fixedUpdate(STEP);
      player.physics.step(STEP);
      expect(z()).toBeCloseTo(lifted + 26 * 2 * STEP, 1); // climbs at runSpeed 26 × 2
      expect(Velocity.grounded[player.eid]).toBe(1); // never the fall clip while flying
      player.physics.dispose();
    });

    it('fly mode hovers (holds its height) when no vertical key is held', async () => {
      const player = await groundedPlayer();
      addComponent(player.world, player.eid, Transform);
      const handle = RigidBody.handle[player.eid];
      const system = systemFor(player, keys()); // nothing held

      system.setFlying(true);
      player.physics.step(STEP);
      const lifted = player.physics.readBody(handle).position[2];
      system.fixedUpdate(STEP);
      player.physics.step(STEP);

      expect(player.physics.readBody(handle).position[2]).toBeCloseTo(lifted, 2); // unchanged → hovering
      player.physics.dispose();
    });

    it('fly mode descends on Control (descend)', async () => {
      const player = await groundedPlayer();
      addComponent(player.world, player.eid, Transform);
      const handle = RigidBody.handle[player.eid];
      const system = systemFor(player, keys('ControlLeft'));

      system.setFlying(true);
      player.physics.step(STEP);
      const lifted = player.physics.readBody(handle).position[2];
      system.fixedUpdate(STEP);
      player.physics.step(STEP);

      expect(player.physics.readBody(handle).position[2]).toBeCloseTo(lifted - 26 * 2 * STEP, 1);
      player.physics.dispose();
    });
  });
});

/** A player whose ECS Transform tracks a chosen planar position (what the scripted run steers by). */
async function placedPlayer(x: number, y: number): Promise<Player> {
  const player = await groundedPlayer();
  addComponent(player.world, player.eid, Transform);
  Transform.x[player.eid] = x;
  Transform.y[player.eid] = y;

  return player;
}

/** A controller bound to a fixed keyboard, for the tests that keep ONE system instance across steps. */
function systemFor(
  player: Player,
  keyboard: KeyboardInput,
  camera: LookDirectionSource = CAMERA,
): CharacterControllerSystem {
  const cfg = config('play');

  return new CharacterControllerSystem(
    player.world,
    player.physics,
    new KeyboardSource(keyboard, cfg.controls),
    cfg,
    player.controller,
    camera,
  );
}

describe('CharacterControllerSystem.setEnabled', () => {
  describe('negative cases', () => {
    it('a disabled controller ignores the keyboard (the player is scripted into a car)', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys('KeyW'));

      system.setEnabled(false);
      system.fixedUpdate(STEP);

      expect(Velocity.y[player.eid]).toBe(0);
      player.physics.dispose();
    });

    it('disabling zeroes stale velocity so it cannot drive facing when control returns', async () => {
      const player = await placedPlayer(0, 0);
      Velocity.x[player.eid] = 7;
      Velocity.y[player.eid] = -4;
      Velocity.z[player.eid] = 2;
      const system = systemFor(player, keys());

      system.setEnabled(false);

      expect([Velocity.x[player.eid], Velocity.y[player.eid], Velocity.z[player.eid]]).toEqual([0, 0, 0]);
      player.physics.dispose();
    });

    it('disabling abandons a scripted path (a cutscene must not resume the old walk)', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys());
      system.runPath([[0, 20, 1.4]]);

      system.setEnabled(false);
      system.setEnabled(true);
      system.fixedUpdate(STEP);

      expect(Velocity.y[player.eid]).toBe(0); // no keys, no path → standing still
      player.physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('re-enabling restores manual control', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys('KeyW'));

      system.setEnabled(false);
      system.setEnabled(true);
      system.fixedUpdate(STEP);

      expect(Velocity.y[player.eid]).toBeGreaterThan(0);
      player.physics.dispose();
    });
  });
});

describe('CharacterControllerSystem.runPath', () => {
  describe('negative cases', () => {
    it('an empty path counts as already arrived (manual control restored)', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys());

      system.runPath([]);

      expect(system.arrived).toBe(true);
      player.physics.dispose();
    });

    it('a fresh path is NOT arrived until it is walked', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys());

      system.runPath([[0, 20, 1.4]]);

      expect(system.arrived).toBe(false);
      player.physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('the scripted run overrides the keyboard — walking BACK still heads to the waypoint', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys('KeyS')); // holding backward the whole time
      system.runPath([[0, 20, 1.4]]);

      system.fixedUpdate(STEP);

      expect(Velocity.y[player.eid]).toBeGreaterThan(0); // toward the waypoint, not away from it
      player.physics.dispose();
    });

    it('reaching the last waypoint stops the player and flags arrival', async () => {
      const player = await placedPlayer(0, 0.3); // already inside the 0.6 m arrive radius
      const system = systemFor(player, keys());
      system.runPath([[0, 0, 1.4]]);

      system.fixedUpdate(STEP);

      expect(system.arrived).toBe(true);
      expect(Velocity.x[player.eid]).toBe(0);
      expect(Velocity.y[player.eid]).toBe(0);
      player.physics.dispose();
    });

    it('a waypoint already reached is skipped and the run continues to the next one', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys());
      // The first point is inside the arrive radius; the second is 20 m along −Y — a 180° reversal,
      // so the heading plant (088/01) pivots in place for a few steps before the walk starts.
      system.runPath([
        [0, 0.3, 1.4],
        [0, -20, 1.4],
      ]);

      for (let i = 0; i < 15; i += 1) {
        system.fixedUpdate(STEP);
      }

      expect(system.arrived).toBe(false); // the path is not finished
      expect(Velocity.y[player.eid]).toBeLessThan(0); // pivoted and heading to the SECOND waypoint
      player.physics.dispose();
    });
  });
});

describe('CharacterControllerSystem camera-relative movement', () => {
  describe('negative cases', () => {
    it('a camera looking straight down picks a stable axis instead of freezing the player', async () => {
      const straightDown: LookDirectionSource = { getWorldDirection: (target) => target.set(0, -1, 0) };
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys('KeyW'), straightDown);

      system.fixedUpdate(STEP);

      // The projected forward is degenerate, so the fallback +Y axis carries the move.
      expect(Velocity.y[player.eid]).toBeGreaterThan(0);
      expect(Number.isFinite(Velocity.x[player.eid])).toBe(true);
      player.physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('strafing right is perpendicular to the camera forward', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys('KeyD')); // camera forward = GTA +Y → right = +X

      system.fixedUpdate(STEP);

      expect(Velocity.x[player.eid]).toBeGreaterThan(0);
      expect(Velocity.y[player.eid]).toBeCloseTo(0, 6);
      player.physics.dispose();
    });
  });
});

describe('CharacterControllerSystem heading (plan 088/01)', () => {
  describe('negative cases', () => {
    it('standing still holds the heading (no input never turns the model)', async () => {
      const player = await groundedPlayer();
      Locomotion.heading[player.eid] = 1;

      run(player, config('play')); // no keys

      expect(Locomotion.heading[player.eid]).toBe(1);
      player.physics.dispose();
    });

    it('a reversal holds the old heading while the speed is still high (plant, not pirouette)', async () => {
      const player = await groundedPlayer();
      run(player, config('play')); // settle → grounded
      Locomotion.heading[player.eid] = 0; // facing +Y
      Velocity.y[player.eid] = 10; // at walk speed

      run(player, config('play'), 'KeyS'); // intent = −Y, 180° behind

      expect(Locomotion.heading[player.eid]).toBe(0); // facing held
      // and the plant DECELERATES on the old heading instead of accelerating backward
      expect(Velocity.y[player.eid]).toBeLessThan(10);
      expect(Velocity.y[player.eid]).toBeGreaterThan(0);
      player.physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('turns toward the intent at the rate — not instantly', async () => {
      const player = await groundedPlayer();
      run(player, config('play')); // settle → grounded
      Locomotion.heading[player.eid] = 0;

      run(player, config('play'), 'KeyD'); // strafe right → intent yaw −π/2, only 90° away

      // One step at the near-idle rate (720°/s) turns 12°, nowhere near the full quarter.
      expect(Locomotion.heading[player.eid]).toBeCloseTo(-(720 / 60) * (Math.PI / 180), 2);
      expect(Locomotion.heading[player.eid]).toBeGreaterThan(-Math.PI / 2);
      player.physics.dispose();
    });

    it('settles on the intent after sustained input', async () => {
      const player = await groundedPlayer();
      Locomotion.heading[player.eid] = 0;
      for (let i = 0; i < 90; i += 1) {
        run(player, config('play'), 'KeyD');
      }
      expect(Locomotion.heading[player.eid]).toBeCloseTo(-Math.PI / 2, 2);
      expect(Velocity.x[player.eid]).toBeCloseTo(10, 1); // strafe carries at walk speed
      player.physics.dispose();
    });

    it('a reversal about-faces once the plant has bled the speed off', async () => {
      const player = await groundedPlayer();
      run(player, config('play')); // settle → grounded
      Locomotion.heading[player.eid] = 0;
      Velocity.y[player.eid] = 10;

      for (let i = 0; i < 200; i += 1) {
        run(player, config('play'), 'KeyS');
      }

      expect(Math.abs(Locomotion.heading[player.eid])).toBeCloseTo(Math.PI, 2); // faced about
      expect(Velocity.y[player.eid]).toBeCloseTo(-10, 1); // and walking the other way
      player.physics.dispose();
    });

    it('fly mode turns instantly from its velocity (debug mode skips the rate)', async () => {
      const player = await groundedPlayer();
      addComponent(player.world, player.eid, Transform);
      Locomotion.heading[player.eid] = 2;
      const system = systemFor(player, keys('KeyW')); // fly forward = +Y → yaw 0

      system.setFlying(true);
      player.physics.step(STEP);
      system.fixedUpdate(STEP);

      expect(Locomotion.heading[player.eid]).toBeCloseTo(0, 6);
      player.physics.dispose();
    });
  });
});
