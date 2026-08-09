/**
 * The bench settle gate (plan 102). Both negative cases replay the FIELD sequence that put the player under
 * the mesh for a whole sweep: the ring poll answers for the ring around the PREVIOUS anchor (already
 * drained), and nothing anywhere waits for collision. The scene under test is `ocean-horizon` on purpose —
 * it is the one whose anchor was moved onto the sand in 2026-07 to work this same class around
 * (78046648), and the only scene with no road cars, so the game fs is never touched.
 *
 * A race is only nondeterministic in the FIELD: here the frame clock and the collision promise are both
 * held in the test's hand, so "the collision lost the race" is a pinned ordering.
 */
import type { Engine, StreamStats } from '@opensa/engine';
import type { ModelColliders } from '@opensa/game/interfaces/collider.interface';
import type { AssetFileSystem } from '@opensa/renderware';

import { CharacterControllerSystem } from '@opensa/game/character/character-controller.system';
import { Locomotion, PlayerControlled, RigidBody, Transform, Velocity } from '@opensa/game/ecs/components';
import { createEcsWorld } from '@opensa/game/ecs/world';
import { KeyboardSource } from '@opensa/game/input';
import { PhysicsWorld } from '@opensa/game/physics/physics-world';
import { initRapier } from '@opensa/game/physics/rapier';
import { CollisionStreamingSystem } from '@opensa/game/streaming/collision-streaming.system';
import { Matrix4, type Vector3 } from '@opensa/math';
import { addComponent, addEntity } from 'bitecs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LegSample, PerfRunsHost } from './engine-perf-runs';

import { BENCH_SCENES } from '../bench-scenes';
import { setupPerfRuns } from './engine-perf-runs';
import { createGameRuntimeConfig } from './game-runtime-config';

/** The host's own capsule (engine-canvas-host) — the test player must stand exactly as the field one does. */
const CAPSULE_HALF_HEIGHT = 0.55;
const CAPSULE_RADIUS = 0.35;

const FRAME_MS = 1000 / 60;
const STEP = 1 / 60;

/** `WORLD_READY_TIMEOUT_MS` in the host — the settle budget the runs are wired with. */
const SETTLE_TIMEOUT_MS = 12000;

/** The warmup `settleAt` runs after the ring gate, in frames — a leg starts this long after the gate opens. */
const WARMUP_FRAMES = Math.ceil(1500 / FRAME_MS);

const OCEAN = BENCH_SCENES.filter((scene) => scene.key === 'ocean-horizon')[0];

/** Polls after a teleport that still answer for the PREVIOUS anchor's ring — the field's "ring drained (1 frames)". */
const STALE_POLL_FRAMES = 4;
/** Frames after the teleport at which the NEW anchor's ring finishes loading (past the warmup on purpose). */
const RING_DRAINED_FRAME = 260;

/** What the leg-start probe sees the moment sampling begins — the plan-102 report row, taken in the test. */
interface LegStart {
  frame: number;
  grounded?: boolean;
  pendingCells: number;
  playerZ?: number;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('setupPerfRuns settle', () => {
  describe('negative cases', () => {
    it('does not begin a leg while the new anchor’s ring is still pending (the stale poll)', async () => {
      const clock = installFrameClock();
      let teleportFrame = 0;
      let sawPending = false;
      const legStart: LegStart[] = []; // pushed once, by the first beginSamples the sweep makes
      // The ring around the OLD anchor is already drained, so the first polls answer 0 for a ring that has
      // nothing to do with where the player now stands; the driver retargets a few frames later.
      const pendingAt = (frame: number): number => {
        const since = frame - teleportFrame;

        return since <= STALE_POLL_FRAMES || since >= RING_DRAINED_FRAME ? 0 : 81;
      };
      const swept = untilSweepComplete();
      setupPerfRuns({
        ...silentHost(),
        beginSamples: (): void => {
          legStart.push({ frame: clock.frame(), pendingCells: pendingAt(clock.frame()) });
        },
        getStream: (): StreamStats => {
          const pendingCells = pendingAt(clock.frame());
          sawPending ||= pendingCells > 0;

          return streamStats(pendingCells);
        },
        params: new URLSearchParams(`bench=${OCEAN.key}`),
        teleportPlayer: (): void => {
          teleportFrame = clock.frame();
        },
      });

      await swept;

      // The instrument could have printed non-zero: the replayed ring really did report a pending queue.
      expect(sawPending).toBe(true);
      expect(legStart[0]?.pendingCells).toBe(0);
      expect(legStart[0]?.frame ?? 0).toBeGreaterThanOrEqual(teleportFrame + RING_DRAINED_FRAME);
    });

    it('does not begin a leg with the player under the mesh when collision arrives late', async () => {
      const world = await physicalWorld();
      const clock = installFrameClock(() => world.tick());
      const legStart: LegStart[] = []; // pushed once, by the first beginSamples the sweep makes
      const swept = untilSweepComplete();
      setupPerfRuns({
        ...silentHost(),
        beginSamples: (): void => {
          legStart.push({
            frame: clock.frame(),
            grounded: world.grounded(),
            pendingCells: 0,
            playerZ: world.playerZ(),
          });
        },
        // The render ring is drained the whole time — only the GROUND can hold this leg back.
        getStream: (): StreamStats => streamStats(0),
        params: new URLSearchParams(`bench=${OCEAN.key}`),
        // Exactly what the host wires today (engine-canvas-host: perf-runs' own inline teleport).
        teleportPlayer: (anchor): void => {
          world.teleport([anchor[0], anchor[1], anchor[2]]);
        },
      });

      await swept;

      // The colliders under the anchor really did arrive late, and they really did arrive.
      expect(world.groundReleasedAtFrame()).toBeGreaterThan(WARMUP_FRAMES);
      expect(world.groundExists()).toBe(true);
      // The leg-start probe of the fix (plan 102 step 2), taken here: the player stands ON the anchor.
      expect(legStart[0]?.playerZ ?? 0).toBeCloseTo(OCEAN.anchor[2], 1);
      expect(legStart[0]?.grounded).toBe(true);
      world.dispose();
    });
  });

  describe('positive cases', () => {
    it('begins the leg promptly when the ring is drained and the ground is already there', async () => {
      const clock = installFrameClock();
      const legStart: LegStart[] = []; // pushed once, by the first beginSamples the sweep makes
      const swept = untilSweepComplete();
      setupPerfRuns({
        ...silentHost(),
        beginSamples: (): void => {
          legStart.push({ frame: clock.frame(), pendingCells: 0 });
        },
        getStream: (): StreamStats => streamStats(0),
        params: new URLSearchParams(`bench=${OCEAN.key}`),
      });

      await swept;

      // A settle that waits out its whole timeout on a world that is READY is the other way to be wrong.
      expect(legStart[0]?.frame ?? 0).toBeLessThan(SETTLE_TIMEOUT_MS / FRAME_MS);
    });
  });
});

/** A flat slab of collision under an anchor — the cell's ground, as the adapter would hand it over. */
function groundUnder(anchor: readonly [number, number, number]): ModelColliders {
  const top = anchor[2] - (CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS);

  return {
    name: 'test-ground',
    shape: {
      boxes: [
        {
          max: [anchor[0] + 400, anchor[1] + 400, top],
          min: [anchor[0] - 400, anchor[1] - 400, top - 2],
        },
      ],
      indices: new Uint32Array(),
      spheres: [],
      vertices: new Float32Array(),
    },
    transforms: [new Matrix4()],
  };
}

/**
 * The frame clock the runs poll: `performance.now` and `requestAnimationFrame` both advance one fixed frame
 * per callback, so a settle/warmup/leg measured in milliseconds is measured in FRAMES here — deterministic,
 * and a 15 s leg costs no wall time. `onFrame` runs before the callback (the host's simulation step).
 */
function installFrameClock(onFrame?: () => void): { frame: () => number } {
  let frame = 0;
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    frame += 1;
    now += FRAME_MS;
    queueMicrotask(() => {
      onFrame?.();
      callback(now);
    });

    return frame;
  });

  return { frame: (): number => frame };
}

/** A real physics world with the host's player capsule and its collision streaming, driven per frame. */
async function physicalWorld(): Promise<{
  dispose: () => void;
  grounded: () => boolean;
  groundExists: () => boolean;
  groundReleasedAtFrame: () => number;
  playerZ: () => number;
  teleport: (position: [number, number, number]) => void;
  tick: () => void;
}> {
  const config = createGameRuntimeConfig();
  const physics = new PhysicsWorld(await initRapier());
  const controller = physics.createCharacterController();
  const spawn: [number, number, number] = [OCEAN.anchor[0], OCEAN.anchor[1], OCEAN.anchor[2]];
  const capsule = physics.createKinematicCapsule(spawn, CAPSULE_RADIUS, CAPSULE_HALF_HEIGHT);

  const ecs = createEcsWorld();
  const player = addEntity(ecs);
  addComponent(ecs, player, Transform);
  addComponent(ecs, player, PlayerControlled);
  addComponent(ecs, player, RigidBody);
  addComponent(ecs, player, Velocity);
  addComponent(ecs, player, Locomotion);
  Transform.x[player] = spawn[0];
  Transform.y[player] = spawn[1];
  Transform.z[player] = spawn[2];
  Velocity.x[player] = 0;
  Velocity.y[player] = 0;
  Velocity.z[player] = 0;
  Velocity.grounded[player] = 0;
  Locomotion.heading[player] = 0;
  Locomotion.state[player] = 0;
  Locomotion.stateTime[player] = 0;
  Locomotion.fallSpeed[player] = 0;
  RigidBody.handle[player] = capsule.body;
  RigidBody.collider[player] = capsule.collider;

  const positionOf = (): [number, number, number] => {
    const [x, y, z] = physics.readBody(capsule.body).position;

    return [x, y, z];
  };
  const controllerSystem = new CharacterControllerSystem(
    ecs,
    physics,
    new KeyboardSource({ isDown: (): boolean => false }, config.controls),
    config,
    controller,
    { getWorldDirection: (target): Vector3 => target.set(0, 0, -1) },
  );
  // The adapter's promise is HELD by the test: the cell's colliders build only once it is released, which is
  // the field race (an async continuation losing to the sweep) turned into an ordering.
  let releaseGround: () => void = vi.fn();
  let groundReleasedAtFrame = 0;
  const ground = new Promise<ModelColliders[]>((resolve) => {
    releaseGround = (): void => resolve([groundUnder(OCEAN.anchor)]);
  });
  const collision = new CollisionStreamingSystem(
    { cellSize: config.streaming.cellSize, loadCellColliders: (): Promise<ModelColliders[]> => ground },
    physics,
    positionOf,
    config,
  );

  let frame = 0;

  return {
    dispose: (): void => physics.dispose(),
    grounded: (): boolean => Velocity.grounded[player] === 1,
    groundExists: (): boolean => physics.groundBelow([spawn[0], spawn[1], OCEAN.anchor[2] + 50], 100) !== null,
    groundReleasedAtFrame: (): number => groundReleasedAtFrame,
    playerZ: (): number => positionOf()[2],
    teleport: (position: [number, number, number]): void => {
      physics.teleport(capsule.body, position);
    },
    tick: (): void => {
      frame += 1;
      // Late by construction: the colliders land well after the warmup a leg starts on.
      if (frame === WARMUP_FRAMES * 2) {
        groundReleasedAtFrame = frame;
        releaseGround();
      }
      collision.update();
      controllerSystem.fixedUpdate(STEP);
      physics.step(STEP);
      const [x, y, z] = positionOf();
      Transform.x[player] = x;
      Transform.y[player] = y;
      Transform.z[player] = z;
    },
  };
}

/** The host accessors a settle test does not care about — every run overrides what it measures. */
function silentHost(): PerfRunsHost {
  return {
    beginSamples: vi.fn(),
    engine: { ledger: (): Record<string, never> => ({}) } as unknown as Engine,
    fs: {} as AssetFileSystem,
    getStream: (): StreamStats => streamStats(0),
    getVehicles: (): null => null,
    params: new URLSearchParams(),
    setBenchCamera: vi.fn(),
    setHour: vi.fn(),
    setSoakStatus: vi.fn(),
    settleTimeoutMs: SETTLE_TIMEOUT_MS,
    setWeather: vi.fn(),
    slowFrameMs: 20,
    takeSamples: (): LegSample[] => [],
    teleportPlayer: vi.fn(),
    toEngine: (gta): [number, number, number] => [gta[0], gta[2], -gta[1]],
  };
}

function streamStats(pendingCells: number): StreamStats {
  return {
    blobMs: 0,
    created: 0,
    evicted: 0,
    lateCreates: 0,
    loadedCells: 81,
    pendingCells,
    uploadMs: 0,
    worstBlobMs: 0,
    worstCreateMs: 0,
  };
}

/** Resolves on the sweep's own last line — the runs are fire-and-forget, so their protocol is the join. */
function untilSweepComplete(): Promise<void> {
  return new Promise<void>((resolve) => {
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]): void => {
      if (parts[0] === '[bench] sweep complete') {
        resolve();
      }
    });
  });
}
