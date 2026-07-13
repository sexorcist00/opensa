/**
 * Own-engine game host (plan 074/10 B3, `?engine=opensa`): the game world boots on `@opensa/engine`
 * instead of three-WebGL. REUSED from the game unchanged: the runtime Config (shared factory — behaviour
 * parity by construction), Rapier physics + the character controller system + collision streaming (all
 * pure), keyboard input. REPLACED: rendering (engine cells + streaming driver follow the PLAYER), the
 * camera (follow orbit producing a CameraState), the player body (the B1 ped probe driven by gameplay
 * state). Three and the own engine never share a canvas — this host IS the capability branch.
 */
import type { AssetFileSystem } from '@opensa/renderware';
import type { ReactElement } from 'react';

import { type CameraState, Engine, loadCloudWeather, setupStreaming, type StreamStats } from '@opensa/engine';
import { createEngineEnvironmentDriver } from '@opensa/game/adapters/engine-environment-driver';
import { GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import { CharacterControllerSystem } from '@opensa/game/character/character-controller.system';
import { PlayerControlled, RigidBody, Transform, Velocity } from '@opensa/game/ecs/components';
import { createEcsWorld } from '@opensa/game/ecs/world';
import { CombinedInput, Keyboard, KeyboardSource } from '@opensa/game/input';
import { PhysicsWorld } from '@opensa/game/physics/physics-world';
import { PhysicsSystem } from '@opensa/game/physics/physics.system';
import { initRapier } from '@opensa/game/physics/rapier';
import { CollisionStreamingSystem } from '@opensa/game/streaming/collision-streaming.system';
import { addComponent, addEntity } from 'bitecs';
import { useEffect, useRef } from 'react';

import type { GameId } from '../game-config';

import { GAME_CONFIG } from '../game-config';
import { loadEnginePlayer } from './engine-player';
import { createGameRuntimeConfig, GAME_CELL_SIZE } from './game-runtime-config';

interface EngineCanvasHostProps {
  fs: AssetFileSystem;
  gameId: GameId;
  onWorldReady?: () => void;
  paused?: boolean;
}

const FIXED_STEP = 1 / 60;
const MAX_CATCHUP_STEPS = 5;
const WORLD_READY_TIMEOUT_MS = 12000;
/** Player capsule (metres, GTA Z-up): the setup-character defaults for a human. */
const CAPSULE_RADIUS = 0.35;
const CAPSULE_HALF_HEIGHT = 0.55;
const EYE_HEIGHT = 0.9; // camera target above the player origin (engine units)

/** Shared mutable flags between React props and the boot closure. */
const hostState = { paused: false };
let booted: null | Promise<void> = null;

export function EngineCanvasHost({ fs, gameId, onWorldReady, paused = false }: EngineCanvasHostProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  hostState.paused = paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    booted ??= boot(canvas, fs, gameId, onWorldReady).catch((error: unknown) => {
      // eslint-disable-next-line no-console -- boot failures must surface somewhere visible in dev
      console.error('[engine-host] boot failed', error);
    });
  }, [fs, gameId, onWorldReady]);

  // No wrapper: like CanvasHost, the canvas fills the shell's `.sa-game` container directly.
  return (
    <>
      <canvas ref={canvasRef} style={{ display: 'block', height: '100%', width: '100%' }} />
      <pre
        id="engine-hud"
        style={{
          background: 'rgba(10, 12, 18, 0.72)',
          color: '#9fe8a8',
          font: '12px/1.45 ui-monospace, monospace',
          left: 8,
          margin: 0,
          padding: '8px 10px',
          position: 'fixed',
          top: 8,
          whiteSpace: 'pre',
          zIndex: 10,
        }}
      />
    </>
  );
}

async function boot(
  canvas: HTMLCanvasElement,
  fs: AssetFileSystem,
  gameId: GameId,
  onWorldReady?: () => void,
): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const hud = document.getElementById('engine-hud') as HTMLPreElement;
  const config = createGameRuntimeConfig();
  const spawn = GAME_CONFIG[gameId].playerSpawn;
  hud.textContent = 'own engine: initializing…';

  const dpr = window.devicePixelRatio;
  const resize = (): void => {
    // The shell mounts the game hidden during warmup — guard against a 0-sized layout pass.
    canvas.width = Math.max(2, Math.floor(canvas.clientWidth * dpr));
    canvas.height = Math.max(2, Math.floor(canvas.clientHeight * dpr));
  };
  resize();
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(canvas);

  const engine = new Engine();
  await engine.init(canvas);
  const setup = await setupStreaming(engine, `/${params.get('src') ?? 'pak-map'}`);
  // Environment drive (074/10 config-API parity): the SHARED config→Environment driver — real timecyc
  // colours when the pak carries them, sun/moon arcs built dynamically from config night.litFade, prod
  // graphics tunables (sky mood, cloud opacity, moon brightness, godrays, fog timecycScale) live on.
  const weather = Number(params.get('weather') ?? 0) || 0;
  const environmentDriver = createEngineEnvironmentDriver(engine.environment, {
    config,
    ...(setup.timecyc !== undefined ? { timecyc: { is24h: setup.timecyc24 ?? false, text: setup.timecyc } } : {}),
    weather,
  });
  // Cloud dome layer (074/06 row 15): pick the ?weather dome when the pak carries clouds.
  if (setup.clouds) {
    void loadCloudWeather(engine, `/${params.get('src') ?? 'pak-map'}`, setup.clouds, weather);
  }

  // Physics + collision streaming (REUSED, pure): the adapter prepares the map defs once, then streams
  // COL cells around the player on the game's own 256-unit grid (independent of the pak's render grid).
  hud.textContent = 'own engine: preparing collision…';
  const adapter = new GtaSaWorldAdapter({ cellSize: GAME_CELL_SIZE, extraIpl: ['truthsfarm'], fs });
  await adapter.prepare();
  const physics = new PhysicsWorld(await initRapier());
  const controller = physics.createCharacterController();
  const capsule = physics.createKinematicCapsule(spawn, CAPSULE_RADIUS, CAPSULE_HALF_HEIGHT);

  // ECS player entity (mirrors setup-character minus the three mesh — the ped probe renders the body).
  const world = createEcsWorld();
  const playerEid = addEntity(world);
  addComponent(world, playerEid, Transform);
  addComponent(world, playerEid, PlayerControlled);
  addComponent(world, playerEid, RigidBody);
  addComponent(world, playerEid, Velocity);
  Transform.x[playerEid] = spawn[0];
  Transform.y[playerEid] = spawn[1];
  Transform.z[playerEid] = spawn[2];
  Transform.qx[playerEid] = 0;
  Transform.qy[playerEid] = 0;
  Transform.qz[playerEid] = 0;
  Transform.qw[playerEid] = 1;
  // bitECS stores are plain arrays — EVERY field must be written or the controller math reads undefined
  // and poisons the whole move chain with NaN (the setup-character parity this host mirrors).
  Velocity.x[playerEid] = 0;
  Velocity.y[playerEid] = 0;
  Velocity.z[playerEid] = 0;
  Velocity.grounded[playerEid] = 0;
  RigidBody.handle[playerEid] = capsule.body;
  RigidBody.collider[playerEid] = capsule.collider;
  const viewOf = (): [number, number, number] => [
    Transform.x[playerEid],
    Transform.y[playerEid],
    Transform.z[playerEid],
  ];

  // Input (REUSED): keyboard for movement; the camera look is host-owned (drag), like the game's pointer.
  const keyboard = new Keyboard();
  keyboard.start();
  const input = new CombinedInput([new KeyboardSource(keyboard, config.controls)]);

  // Follow camera (host-owned, engine space): drag = orbit, wheel = zoom; the controller sees its forward
  // through a camera shim (the only three-shaped seam in CharacterControllerSystem).
  let yaw = Math.PI;
  let pitch = -0.25;
  let followDistance = config.camera.followDistance;
  let dragging = false;
  canvas.addEventListener('pointerdown', () => (dragging = true));
  window.addEventListener('pointerup', () => (dragging = false));
  window.addEventListener('pointermove', (event) => {
    if (dragging) {
      yaw -= event.movementX * 0.004;
      pitch = Math.max(-1.2, Math.min(0.9, pitch - event.movementY * 0.004));
    }
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    followDistance = Math.max(
      config.camera.followZoomMin,
      Math.min(config.camera.followZoomMax, followDistance * (event.deltaY > 0 ? 1.08 : 0.93)),
    );
  });
  const forwardOf = (): [number, number, number] => [
    Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    Math.cos(pitch) * Math.cos(yaw),
  ];
  // The controller only calls camera.getWorldDirection(v) — hand it the follow camera's forward.
  const cameraShim = {
    getWorldDirection: (target: { set(x: number, y: number, z: number): unknown }) => {
      const [fx, fy, fz] = forwardOf();
      target.set(fx, fy, fz);

      return target;
    },
  } as unknown as ConstructorParameters<typeof CharacterControllerSystem>[5];

  const controllerSystem = new CharacterControllerSystem(world, physics, input, config, controller, cameraShim);
  const physicsSystem = new PhysicsSystem(world, physics, config);
  const collision = new CollisionStreamingSystem(adapter, physics, viewOf, config);

  const player = await loadEnginePlayer(engine);

  let hour = Number(params.get('hour') ?? 10) || 10;
  environmentDriver.apply(hour);

  let previous = performance.now();
  let accumulator = 0;
  let readySent = false;
  let debugError: null | string = null;
  let groundDelta = 0;
  let pedMs = 0;
  const runFixedSteps = (pending: number): number => {
    let steps = 0;
    while (pending >= FIXED_STEP && steps < MAX_CATCHUP_STEPS) {
      try {
        controllerSystem.fixedUpdate(FIXED_STEP);
        physicsSystem.fixedUpdate(FIXED_STEP);
      } catch (error) {
        debugError ??= error instanceof Error ? error.message : String(error);
      }
      pending -= FIXED_STEP;
      steps += 1;
    }

    return pending;
  };
  const bootStarted = performance.now();
  let heading = Math.PI;
  const frames: number[] = [];

  const loop = (): void => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - previous) / 1000);
    previous = now;
    frames.push(dt * 1000);
    if (frames.length > 120) {
      frames.shift();
    }

    if (!hostState.paused) {
      accumulator = runFixedSteps(accumulator + dt);
      collision.update();
      hour = (hour + dt / (config.time.secondsPerGameMinute * 60)) % 24;
      environmentDriver.apply(hour);
    }

    const gta = viewOf();
    // Data-driven feet placement (no per-model constants): a physics ray from just BELOW the capsule
    // bottom finds the actual ground; the render origin sits so the model's posed feet (fixture minZ)
    // touch it. The last delta holds while airborne (jumps keep visual continuity).
    if (Velocity.grounded[playerEid] === 1) {
      // From the body CENTRE, own capsule excluded — starting under the capsule skips thin road shells
      // (the ray then hits basements metres below and buries the model; field lesson).
      const ground = physics.groundBelow([gta[0], gta[1], gta[2]], 4, RigidBody.handle[playerEid]);
      if (ground !== null) {
        groundDelta = ground - player.minZ - gta[2];
      }
    }
    const playerEngine = toEngine(gta);
    const playerRender: [number, number, number] = [playerEngine[0], playerEngine[1] + groundDelta, playerEngine[2]];
    // Heading from planar velocity (GTA vx, vy); hold the last one while standing.
    const vx = Velocity.x[playerEid];
    const vy = Velocity.y[playerEid];
    const speed = Math.hypot(vx, vy);
    if (speed > 0.3) {
      heading = Math.atan2(-vx, vy);
    }
    if (!hostState.paused) {
      const pedStarted = performance.now();
      player.update(playerRender, heading, speed, dt);
      pedMs = performance.now() - pedStarted;
    }

    // Streaming follows the PLAYER (the B3 contract), not the camera.
    const streamStats: StreamStats = setup.driver.update(playerEngine);

    const target: [number, number, number] = [playerEngine[0], playerEngine[1] + EYE_HEIGHT, playerEngine[2]];
    const [fx, fy, fz] = forwardOf();
    const camera: CameraState = {
      aspect: canvas.width / Math.max(1, canvas.height),
      eye: [target[0] - fx * followDistance, target[1] - fy * followDistance, target[2] - fz * followDistance],
      far: 10000,
      fovYRad: Math.PI / 3,
      near: 0.5,
      target,
      up: [0, 1, 0],
    };
    const stats = engine.frame(camera);

    if (
      !readySent &&
      ((streamStats.pendingCells === 0 && streamStats.created > 0) || now - bootStarted > WORLD_READY_TIMEOUT_MS)
    ) {
      readySent = true;
      onWorldReady?.();
    }

    const frameAvg = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
    hud.textContent =
      `OWN ENGINE (074/10 B3) — walk: WASD, run: Shift, jump: Space, drag = look\n` +
      `frame   ${frameAvg.toFixed(2)} ms (${(1000 / Math.max(frameAvg, 0.001)).toFixed(0)} fps)\n` +
      `submit  ${stats.submitMs.toFixed(2)} ms · GPU ${stats.gpuPassMs > 0 ? stats.gpuPassMs.toFixed(2) : 'n/a'} ms · draws ${stats.drawsRecorded}\n` +
      `stream  ${streamStats.loadedCells} cells, ${streamStats.pendingCells} pending · residency ${(stats.residencyBytes / 1048576).toFixed(0)} MB\n` +
      `GTA     ${gta[0].toFixed(1)}, ${gta[1].toFixed(1)}, ${gta[2].toFixed(1)} · ${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}\n` +
      `debug   vel ${vx.toFixed(2)},${vy.toFixed(2)},${Velocity.z[playerEid].toFixed(2)} grounded ${Velocity.grounded[playerEid]} ` +
      `move ${JSON.stringify(input.move())} · ped sampler ${pedMs.toFixed(2)} ms` +
      (debugError ? `\nFIXED-STEP ERROR: ${debugError}` : '') +
      (hostState.paused ? '\nPAUSED' : '');
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** GTA Z-up point → engine Y-up: (x, y, z) → (x, z, −y). */
function toEngine(gta: readonly [number, number, number]): [number, number, number] {
  return [gta[0], gta[2], -gta[1]];
}
