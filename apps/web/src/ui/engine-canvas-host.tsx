/**
 * Own-engine game host (plan 074/10 B3, `?engine=opensa`): the game world boots on `@opensa/engine`
 * instead of three-WebGL. REUSED from the game unchanged: the runtime Config (shared factory — behaviour
 * parity by construction), Rapier physics + the character controller system + collision streaming (all
 * pure), keyboard input. REPLACED: rendering (engine cells + streaming driver follow the PLAYER), the
 * camera (follow orbit producing a CameraState), the player body (the B1 ped probe driven by gameplay
 * state). Three and the own engine never share a canvas — this host IS the capability branch.
 */
import type { ReactElement } from 'react';

import { type CameraState, Engine, loadCloudWeather, setupStreaming, type StreamStats } from '@opensa/engine';
import { createEngineEnvironmentDriver } from '@opensa/game/adapters/engine-environment-driver';
import { GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import { CharacterControllerSystem } from '@opensa/game/character/character-controller.system';
import { PlayerControlled, RigidBody, Transform, Velocity } from '@opensa/game/ecs/components';
import { createEcsWorld } from '@opensa/game/ecs/world';
import { EventBus } from '@opensa/game/events/event-bus';
import { type GameEvents } from '@opensa/game/events/events.global';
import { CombinedInput, Keyboard, KeyboardSource } from '@opensa/game/input';
import { type BenchScene, samplePath } from '@opensa/game/perf/bench';
import { PhysicsWorld } from '@opensa/game/physics/physics-world';
import { PhysicsSystem } from '@opensa/game/physics/physics.system';
import { initRapier } from '@opensa/game/physics/rapier';
import { CollisionStreamingSystem } from '@opensa/game/streaming/collision-streaming.system';
import { type NamedZone, ZoneNameSystem } from '@opensa/game/zones/zone-name.system';
import { type AssetFileSystem, gxtKeyHash, oceanFrame, parseTxd } from '@opensa/renderware';
import { parseWater } from '@opensa/renderware/parsers/text/water.parser';
import { decodeDxt } from '@opensa/renderware/textures/dxt';
import { addComponent, addEntity } from 'bitecs';
import { useEffect, useRef, useState } from 'react';

import type { GameId } from '../game-config';

import { BENCH_SCENES } from '../bench-scenes';
import { GAME_CONFIG } from '../game-config';
import { loadEnginePlayer } from './engine-player';
import { createGameRuntimeConfig, GAME_CELL_SIZE } from './game-runtime-config';
import { Hud, type HudGame } from './hud/hud';
import { loadFonts } from './hud/load-fonts';
import { loadGxt, loadInfoZones } from './zone-data';

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
/** The HudGame the boot closure builds (module scope — survives StrictMode's dev double-mount). */
let hudGameRef: HudGame | null = null;

export function EngineCanvasHost({ fs, gameId, onWorldReady, paused = false }: EngineCanvasHostProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hudGame, setHudGame] = useState<HudGame | null>(hudGameRef);
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
    void booted.then(() => setHudGame(hudGameRef));
  }, [fs, gameId, onWorldReady]);

  // No wrapper: like CanvasHost, the canvas fills the shell's `.sa-game` container directly.
  return (
    <>
      <canvas ref={canvasRef} style={{ display: 'block', height: '100%', width: '100%' }} />
      {hudGame ? <Hud game={hudGame} /> : null}
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
  // `?spawn=x,y,z` (GTA coords) overrides the config spawn — field checks at arbitrary spots
  // (e.g. Santa Maria Beach for the water: `?spawn=342,-1803,4.8`).
  const spawnParam = (params.get('spawn') ?? '').split(',').map(Number);
  const spawn: [number, number, number] =
    spawnParam.length === 3 && spawnParam.every(Number.isFinite)
      ? [spawnParam[0], spawnParam[1], spawnParam[2]]
      : [...GAME_CONFIG[gameId].playerSpawn];
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
  const driverFor = (weatherId: number): ReturnType<typeof createEngineEnvironmentDriver> =>
    createEngineEnvironmentDriver(engine.environment, {
      config,
      ...(setup.timecyc !== undefined ? { timecyc: { is24h: setup.timecyc24 ?? false, text: setup.timecyc } } : {}),
      weather: weatherId,
    });
  let environmentDriver = driverFor(weather);
  // Cloud dome layer (074/06 row 15): pick the ?weather dome when the pak carries clouds.
  if (setup.clouds) {
    void loadCloudWeather(engine, `/${params.get('src') ?? 'pak-map'}`, setup.clouds, weather);
  }
  void installWater(engine, fs, setup.water, `/${params.get('src') ?? 'pak-map'}`);

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

  // Follow camera (host-owned, engine space): click = mouse capture (prod behaviour — the look uses
  // movementX/Y continuously while pointer-locked, Esc releases), drag-orbit stays as the unlocked
  // fallback; wheel = zoom. The controller sees its forward through a camera shim (the only three-shaped
  // seam in CharacterControllerSystem).
  let yaw = Math.PI;
  let pitch = -0.25;
  let followDistance = config.camera.followDistance;
  let dragging = false;
  canvas.addEventListener('pointerdown', () => {
    if (!document.pointerLockElement) {
      void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
    }
    dragging = true;
  });
  window.addEventListener('pointerup', () => (dragging = false));
  window.addEventListener('pointermove', (event) => {
    if (document.pointerLockElement === canvas || dragging) {
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

  // Prod HUD + district names (074/10 reuse-not-duplicate): the SAME DOM <Hud> component fed through the
  // narrow HudGame surface; the lookup is the game's own ZoneNameSystem over info.zon + american.gxt.
  await loadFonts(config.fonts);
  const events = new EventBus<GameEvents>();
  let zoneName = '';
  const gxt = loadGxt(fs, 'text/american.gxt');
  const namedZones: NamedZone[] = loadInfoZones(fs, 'data/info.zon').map((zone) => ({
    max: zone.max,
    min: zone.min,
    name: zone.label,
  }));
  const zoneSystem = new ZoneNameSystem(namedZones, viewOf, (key) => {
    zoneName = (gxt?.get(gxtKeyHash(key)) ?? '').trim();
    events.emit('zone', { name: zoneName });
  });
  const minutesNow = (): number => Math.floor((((hour % 24) + 24) % 24) * 60);
  let lastMinutes = minutesNow();
  hudGameRef = {
    events,
    getConfig: (): typeof config => config,
    getTime: minutesNow,
    getZone: (): string => zoneName,
  };

  let previous = performance.now();
  let accumulator = 0;
  let readySent = false;
  let debugError: null | string = null;
  let groundDelta = 0;
  let pedMs = 0;
  // In-game bench state (074/10 B3 tail): the loop consumes these; the runner below owns them.
  let benchCamera: null | { eye: [number, number, number]; target: [number, number, number] } = null;
  let benchSamples: null | { draws: number; frameMs: number; gpuMs: number; submitMs: number }[] = null;
  let lastStream: null | StreamStats = null;
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
      zoneSystem.update();
      if (minutesNow() !== lastMinutes) {
        lastMinutes = minutesNow();
        events.emit('time', { minutes: lastMinutes });
      }
    } else if (document.pointerLockElement) {
      document.exitPointerLock(); // free the cursor for the pause menu (prod behaviour)
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
    lastStream = streamStats;

    const target: [number, number, number] = [playerEngine[0], playerEngine[1] + EYE_HEIGHT, playerEngine[2]];
    const [fx, fy, fz] = forwardOf();
    // A running bench owns the camera (the prod BenchPlugin contract — deterministic path, player parked).
    const camera: CameraState = {
      aspect: canvas.width / Math.max(1, canvas.height),
      eye: benchCamera
        ? benchCamera.eye
        : [target[0] - fx * followDistance, target[1] - fy * followDistance, target[2] - fz * followDistance],
      far: 10000,
      fovYRad: Math.PI / 3,
      near: 0.5,
      target: benchCamera ? benchCamera.target : target,
      up: [0, 1, 0],
    };
    const stats = engine.frame(camera);
    benchSamples?.push({
      draws: stats.drawsRecorded,
      frameMs: dt * 1000,
      gpuMs: stats.gpuPassMs,
      submitMs: stats.submitMs,
    });

    if (
      !readySent &&
      ((streamStats.pendingCells === 0 && streamStats.created > 0) || now - bootStarted > WORLD_READY_TIMEOUT_MS)
    ) {
      readySent = true;
      onWorldReady?.();
    }

    const frameAvg = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
    hud.textContent =
      `OWN ENGINE (074/10 B3) — walk: WASD, run: Shift, jump: Space, click = capture mouse (Esc frees)\n` +
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

  // In-game benches (074/10 B3 last tail → the C1 comparability requirement): SAME scenes + path sampler
  // as prod's BenchPlugin, SAME `[bench] {json}` report protocol — only the harness is host-specific
  // (teleport via physics, weather via the shared env driver, camera override, engine stats capture).
  const benchKey = params.get('bench');
  if (benchKey) {
    const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const flyAt = (scene: BenchScene, t: number): void => {
      const pose = samplePath(scene.path, t);
      benchCamera = {
        eye: toEngine(pose.pos),
        target: toEngine(pose.look),
      };
    };
    const runScene = async (scene: BenchScene): Promise<void> => {
      hour = scene.hour;
      environmentDriver = driverFor(scene.weather);
      if (setup.clouds) {
        await loadCloudWeather(engine, `/${params.get('src') ?? 'pak-map'}`, setup.clouds, scene.weather);
      }
      physics.teleport(RigidBody.handle[playerEid], [scene.anchor[0], scene.anchor[1], scene.anchor[2]]);
      Transform.x[playerEid] = scene.anchor[0];
      Transform.y[playerEid] = scene.anchor[1];
      Transform.z[playerEid] = scene.anchor[2];
      // Settle: the streaming ring around the anchor must drain before sampling (prod's teleport contract).
      const settleStart = performance.now();
      flyAt(scene, 0);
      while (performance.now() - settleStart < WORLD_READY_TIMEOUT_MS) {
        await nextFrame();
        if (lastStream !== null && lastStream.pendingCells === 0) {
          break;
        }
      }
      // Warmup (prod WARMUP_S): shader compiles / fresh-ring uploads drain outside the capture.
      const warmupStart = performance.now();
      while (performance.now() - warmupStart < 1500) {
        await nextFrame();
      }
      benchSamples = [];
      const runStart = performance.now();
      let t = 0;
      while (t < 1) {
        t = Math.min(1, (performance.now() - runStart) / 1000 / scene.durationS);
        flyAt(scene, t);
        await nextFrame();
      }
      const samples = benchSamples;
      benchSamples = null;
      benchCamera = null;
      const avg = (values: readonly number[]): number =>
        values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      const sortedMs = samples.map((sample) => sample.frameMs).sort((a, b) => a - b);
      const avgMs = avg(sortedMs);
      const gpuSamples = samples.filter((sample) => sample.gpuMs > 0).map((sample) => sample.gpuMs);
      const report = {
        avgDrawCalls: Math.round(avg(samples.map((sample) => sample.draws))),
        avgMs: Number(avgMs.toFixed(3)),
        avgTriangles: 0,
        fps: Number((1000 / Math.max(0.001, avgMs)).toFixed(1)),
        frames: samples.length,
        gpuMs: {
          pass: Number(avg(gpuSamples).toFixed(3)),
          submit: Number(avg(samples.map((sample) => sample.submitMs)).toFixed(3)),
        },
        key: scene.key,
        p95Ms: Number((sortedMs[Math.floor(sortedMs.length * 0.95)] ?? 0).toFixed(3)),
      };
      // eslint-disable-next-line no-console -- the bench deliverable IS this JSON line (plan 063 protocol)
      console.log('[bench]', JSON.stringify(report));
    };
    const scenes = benchKey === 'all' ? BENCH_SCENES : BENCH_SCENES.filter((scene) => scene.key === benchKey);
    if (scenes.length === 0) {
      // eslint-disable-next-line no-console -- bench CLI feedback, same as prod
      console.warn(`[bench] unknown scene '${benchKey}' — known: all, ${BENCH_SCENES.map((s) => s.key).join(', ')}`);
    }
    void (async (): Promise<void> => {
      for (const scene of scenes) {
        await runScene(scene);
      }
      // eslint-disable-next-line no-console -- bench CLI feedback, same as prod
      console.log('[bench] sweep complete');
    })();
  }
}

/** Water (074/06 row 12): prefer the BAKED tessellated mesh (`water.bin` — per-vertex shore field →
 *  displacement/foam/shallow); fall back to the flat runtime build (constant deep field) for paks
 *  converted before the water bake. Textures: particle.txd waterclear256 (ripple) + waterwake (foam). */
async function installWater(
  engine: Engine,
  fs: AssetFileSystem,
  water: undefined | { file: string; indexCount: number; vertexCount: number },
  baseUrl: string,
): Promise<void> {
  const ripple = loadWaterTexture(fs, 'waterclear256');
  const foam = loadWaterTexture(fs, 'waterwake');
  if (water) {
    const response = await fetch(`${baseUrl}/${water.file}`);
    if (response.ok) {
      const bin = new Uint8Array(await response.arrayBuffer());
      const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
      const vertexCount = view.getUint32(0, true);
      const indexCount = view.getUint32(4, true);
      const gta = new Float32Array(bin.buffer, bin.byteOffset + 8, vertexCount * 4);
      const indices = new Uint32Array(bin.buffer.slice(bin.byteOffset + 8 + vertexCount * 16), 0, indexCount);
      // GTA Z-up → engine Y-up in place; the shore field rides along untouched.
      const vertices = new Float32Array(vertexCount * 4);
      for (let v = 0; v < vertexCount; v += 1) {
        vertices[v * 4] = gta[v * 4];
        vertices[v * 4 + 1] = gta[v * 4 + 2];
        vertices[v * 4 + 2] = -gta[v * 4 + 1];
        vertices[v * 4 + 3] = gta[v * 4 + 3];
      }
      engine.setWater(vertices, indices, ripple, foam);

      return;
    }
  }
  const text = fs.getText('data/water.dat');
  if (text === null) {
    return;
  }
  const quads = parseWater(text);
  const positions: number[] = [];
  const indices: number[] = [];
  for (const quad of [...quads, ...oceanFrame(quads, 6000, 0)]) {
    const base = positions.length / 4;
    for (const [x, y, z] of quad.vertices) {
      positions.push(x, z, -y, 120); // constant "deep" shore field — no foam/damping without the bake
    }
    if (quad.vertices.length >= 4) {
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    } else {
      indices.push(base, base + 1, base + 2);
    }
  }
  engine.setWater(new Float32Array(positions), new Uint32Array(indices), ripple, foam);
}

/** Decode one particle.txd texture to RGBA (null when the archive/texture is absent). */
function loadWaterTexture(
  fs: AssetFileSystem,
  name: string,
): null | { height: number; rgba: Uint8Array; width: number } {
  const buffer = fs.get('models/particle.txd');
  if (!buffer) {
    return null;
  }
  for (const texture of parseTxd(buffer).textures) {
    if (texture.name.toLowerCase() === name) {
      const base = texture.mipmaps[0];
      const rgba =
        texture.format === 'rgba8888'
          ? new Uint8Array(base.data)
          : decodeDxt(texture.format, base.data, base.width, base.height);

      return { height: base.height, rgba, width: base.width };
    }
  }

  return null;
}

/** GTA Z-up point → engine Y-up: (x, y, z) → (x, z, −y). */
function toEngine(gta: readonly [number, number, number]): [number, number, number] {
  return [gta[0], gta[2], -gta[1]];
}
