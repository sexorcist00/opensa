/**
 * Own-engine game host (plan 074/10 B3, `?engine=opensa`): the game world boots on `@opensa/engine`
 * instead of three-WebGL. REUSED from the game unchanged: the runtime Config (shared factory — behaviour
 * parity by construction), Rapier physics + the character controller system + collision streaming (all
 * pure), keyboard input. REPLACED: rendering (engine cells + streaming driver follow the PLAYER), the
 * camera (follow orbit producing a CameraState), the player body (the B1 ped probe driven by gameplay
 * state). Three and the own engine never share a canvas — this host IS the capability branch.
 */
import type { ReactElement } from 'react';

import { type CameraState, Engine, setupStreaming, type StreamStats } from '@opensa/engine';
import {
  createEngineEnvironmentDriver,
  DEFAULT_DRAW_DISTANCE,
  FOG_RING_MARGIN,
} from '@opensa/game/adapters/engine-environment-driver';
import { GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import { benchRoadCarPlacements } from '@opensa/game/adapters/road-cars';
import { CharacterControllerSystem } from '@opensa/game/character/character-controller.system';
import { Logger } from '@opensa/game/diagnostics/logger';
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
import { cellsWithin } from '@opensa/game/streaming/grid';
import { WeatherTransition } from '@opensa/game/weather/weather-transition';
import { type NamedZone, ZoneNameSystem } from '@opensa/game/zones/zone-name.system';
import { type AssetFileSystem, gxtKeyHash, oceanFrame, parseTxd } from '@opensa/renderware';
import { parseWater } from '@opensa/renderware/parsers/text/water.parser';
import { decodeDxt } from '@opensa/renderware/textures/dxt';
import { addComponent, addEntity } from 'bitecs';
import { useEffect, useRef, useState } from 'react';

import type { GameId } from '../game-config';

import { BENCH_SCENES } from '../bench-scenes';
import { GAME_CONFIG } from '../game-config';
import { setupEngineAnimObjects } from './engine-anim-objects';
import { setupEngineBreakables } from './engine-breakables';
import { setupEngineClutter } from './engine-clutter';
import { loadCoronaSprites, setupEngineParticles } from './engine-particles';
import { loadEnginePlayer } from './engine-player';
import { setupEngineProps } from './engine-props';
import { type EngineVehicles, setupEngineVehicles } from './engine-vehicles';
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
/** A frame slower than this gets its CPU breakdown logged (vsync is 8.3 ms at 120 Hz). */
const SLOW_FRAME_MS = 20;

/** Player capsule (metres, GTA Z-up): the setup-character defaults for a human. */
const CAPSULE_RADIUS = 0.35;
const CAPSULE_HALF_HEIGHT = 0.55;
const EYE_HEIGHT = 0.9; // camera target above the player origin (engine units)
/** Default spawn hour — night, so vehicle lamps and coronas are visible on boot (`?hour=` overrides). */
const NIGHT_HOUR = 22;

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

/**
 * Sky A/B overrides (074/06 row 4 sky v2): `?sky=preetham` = the legacy dome vs the Hosek-Wilkie default;
 * `?clouds=N` = cloud-layer opacity (0 = the naked dome, kills cirrus+cumulus too).
 */
function applySkyOverrides(
  engine: Engine,
  config: ReturnType<typeof createGameRuntimeConfig>,
  params: URLSearchParams,
): void {
  if (params.get('sky') === 'preetham') {
    engine.environment.skyModel = 'preetham';
  }
  const cloudsParam = Number(params.get('clouds') ?? Number.NaN);
  if (Number.isFinite(cloudsParam)) {
    config.graphics.clouds.opacity = cloudsParam;
  }
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
  // `?aces=0` / `?bloom=0|N` — the 074/09 post A/Bs (fold into the live config, so debug stays truthful).
  if (params.get('aces') === '0') {
    config.graphics.toneMapping = false;
  }
  const bloomParam = Number(params.get('bloom') ?? Number.NaN);
  if (Number.isFinite(bloomParam)) {
    config.graphics.bloom.enabled = bloomParam > 0;
    if (bloomParam > 0) {
      config.graphics.bloom.intensity = bloomParam;
    }
  }
  // `?probe=0` — the 074/16 env-probe A/B: keeps reflections on the analytic-sky fallback.
  const probeEnabled = params.get('probe') !== '0';
  // `?probeview=1` — replace the frame with the probe cube panorama (orientation/content debug).
  const probeViewEnabled = params.get('probeview') === '1';
  // Tier knob (074/09): `?scale=0.75` render scale (live). MSAA/bloomq knobs were field-tested and
  // dropped (WebGPU allows sampleCount 1|4 only; bloom levels saved ~0.05 ms).
  const scaleParam = Number(params.get('scale') ?? Number.NaN);
  if (Number.isFinite(scaleParam)) {
    config.graphics.renderScale = scaleParam;
  }
  // Draw distance (074/21 P1): ONE knob → the LOD streaming ring, with the fog cut capped at
  // `drawDistance − FOG_RING_MARGIN` — the outer margin band is always loaded before it leaves the fog,
  // so streaming pops are impossible by construction. `?draw=N` = live A/B (min 400 keeps rings sane).
  const drawParam = Number(params.get('draw') ?? Number.NaN);
  const drawDistance = Number.isFinite(drawParam) ? Math.max(400, drawParam) : DEFAULT_DRAW_DISTANCE;
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
  applySkyOverrides(engine, config, params);
  // SA corona billboards (B6): coronastar for lamps/headlights, coronamoon for the moon. They must exist
  // BEFORE the first cell loads — the frame bind group is baked into every cell bundle.
  await engine.init(canvas, loadCoronaSprites(fs));
  const setup = await setupStreaming(engine, `/${params.get('src') ?? 'pak-map'}`, { lodRadius: drawDistance });
  // Environment drive (074/10 config-API parity): the SHARED config→Environment driver — real timecyc
  // colours when the pak carries them, sun/moon arcs built dynamically from config night.litFade, prod
  // graphics tunables (sky mood, cloud opacity, moon brightness, godrays, fog timecycScale) live on.
  const weather = Number(params.get('weather') ?? 0) || 0;
  // Weather transitions (prod parity): the SAME WeatherTransition class prod's Game runs — one driver,
  // its blend getter eases from→to over config.weatherTransitionSeconds (smoothstep, like prod).
  const weatherTransition = new WeatherTransition(weather);
  const environmentDriver = createEngineEnvironmentDriver(engine.environment, {
    config,
    fogCap: drawDistance - FOG_RING_MARGIN,
    ...(setup.timecyc !== undefined ? { timecyc: { is24h: setup.timecyc24 ?? false, text: setup.timecyc } } : {}),
    weather,
    weatherBlend: () => weatherTransition.blend(),
  });
  // '[' / ']' cycle the weather LIVE (sky v2 field iteration — a URL change costs a whole VFS reboot).
  let liveWeather = weather;
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'BracketLeft' && event.code !== 'BracketRight') {
      return;
    }
    liveWeather = (liveWeather + (event.code === 'BracketRight' ? 1 : 19)) % 20;
    weatherTransition.begin(liveWeather, config.weatherTransitionSeconds);
    // eslint-disable-next-line no-console -- field-iteration feedback (which weather id is on screen)
    console.log(`[engine-host] weather ${liveWeather}`);
  });
  void installWater(engine, fs, setup.water, `/${params.get('src') ?? 'pak-map'}`);

  // Physics + collision streaming (REUSED, pure): the adapter prepares the map defs once, then streams
  // COL cells around the player on the game's own 256-unit grid (independent of the pak's render grid).
  hud.textContent = 'own engine: preparing collision…';
  const adapter = new GtaSaWorldAdapter({
    cellSize: GAME_CELL_SIZE,
    // Procedural clutter (074/19 B7·d): the engine now RENDERS the clutter (instanced), so it collides it too —
    // driven by ONE budget with the render (a per-category density lottery capped at 150/cell, lowest lotteries
    // win). Without the cap the countryside handed Rapier 9 803 static bodies (17 ms/step, 12 fps standing
    // still); the cap keeps the body count in the hundreds. Render and collision share the adapter's memoized
    // scatter, so they can never diverge (that divergence is what cost the 17 ms).
    clutterColliders: true,
    extraIpl: ['truthsfarm'],
    fs,
    procObjLimit: 150,
  });
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
  // 2dfx particles (B6): the pak carries the emitter anchors, this reads effects.fxp + effectsPC.txd and
  // bakes them. Absent-tolerant — a profile without the FX files simply renders no particles.
  const particles = setupEngineParticles(engine, fs);
  // Smashable props (B7·a): the colliders are already tagged with their placement key by the shared adapter.
  // Uproot props (lampposts, meters) fall as real dynamic bodies; the rest shatter into analytic debris.
  const props = setupEngineProps(engine, fs, physics);
  // Animated map objects (B7·b): the converter left their MOVING frames out of the bundle; these are them.
  const animObjects = setupEngineAnimObjects(engine, fs, adapter);
  const breakables = setupEngineBreakables(engine, physics, collision, adapter, fs, props);
  // Procedural clutter (074/19 B7·d): grass/bushes/rocks scattered per cell, rendered instanced. Streamed on
  // the SAME cells + budget as the colliders (adapter memoizes the scatter), so render and collision agree.
  const engineClutter = setupEngineClutter(engine, fs);
  const clutterLoaded = new Set<string>();
  const updateClutter = (): void => {
    const cells = cellsWithin(viewOf(), config.streaming.collisionDrawDistance, adapter.cellSize);
    const desired = new Set(cells.map(([cx, cy]) => `${cx},${cy}`));
    for (const key of clutterLoaded) {
      if (!desired.has(key)) {
        engineClutter.removeCell(key);
        clutterLoaded.delete(key);
      }
    }
    // Bound the per-frame scatter+upload spike — new cells fill in over a few frames (the ring has a margin).
    let budget = 2;
    for (const [cx, cy] of cells) {
      const key = `${cx},${cy}`;
      if (clutterLoaded.has(key)) {
        continue;
      }
      engineClutter.applyCell(key, adapter.cellClutter(cx, cy));
      clutterLoaded.add(key);
      budget -= 1;
      if (budget <= 0) {
        break;
      }
    }
  };
  let debugError: null | string = null;
  /** Last frame's camera eye (engine space) — the lamp coronas need it, one frame stale is invisible. */
  const cameraEye: [number, number, number] = [0, 0, 0];
  const logger = new Logger({ emit: (): undefined => undefined }, { showLogs: false });

  // Vehicles (074/08 B5 step 4): the SAME gameplay systems the three host runs — they speak VehicleHandle
  // now, so the only host-specific piece is the wiring.
  const placePlayer = (position: [number, number, number], moveBody = true): void => {
    if (moveBody) {
      physics.teleport(RigidBody.handle[playerEid], position);
    }
    Transform.x[playerEid] = position[0];
    Transform.y[playerEid] = position[1];
    Transform.z[playerEid] = position[2];
  };
  let vehicles: EngineVehicles | null = null;
  try {
    vehicles = await setupEngineVehicles({
      adapter,
      aimCamera: (azimuth: number): void => {
        yaw = azimuth;
      },
      animator: player,
      config,
      engine,
      // The camera in NATIVE (Z-up) space — the lamp coronas fade by how squarely each lamp faces it.
      eye: (): [number, number, number] => {
        const [ex, ey, ez] = cameraEye;

        return [ex, -ez, ey];
      },
      fs,
      input,
      isNight: (): boolean => engine.environment.dn > 0.35,
      logger,
      physics,
      placePlayer,
      playerCollider: capsule.collider,
      playerController: controllerSystem,
      playerPosition: viewOf,
      viewOf,
    });
  } catch (error) {
    // A car that fails to load must not take the whole world down — walking still works.
    debugError ??= error instanceof Error ? error.message : String(error);
  }

  // Spawn at NIGHT: the headlights, brake lights and lamp coronas (B5 step 5) are the whole point of the
  // vehicle work right now, and a noon spawn hides all three. `?hour=` still overrides — and it accepts 0:
  // the old `|| DEFAULT` fallback treated midnight as "unset" and silently bounced it back to daytime.
  const hourParam = Number(params.get('hour'));
  let hour = Number.isFinite(hourParam) && params.get('hour') !== null ? hourParam : NIGHT_HOUR;
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
  let groundDelta = 0;
  let pedMs = 0;
  /** Per-frame block timers (B7·b field stall): a stall must have a NUMBER, not a theory. */
  let animMs = 0;
  let fixedMs = 0;
  let fixedSteps = 0;
  let controllerMs = 0;
  let physicsMs = 0;
  let collisionMs = 0;
  let vehiclesMs = 0;
  // In-game bench state (074/10 B3 tail): the loop consumes these; the runner below owns them.
  let benchCamera: null | { eye: [number, number, number]; target: [number, number, number] } = null;
  let benchSamples:
    | null
    | { draws: number; frameMs: number; gpuMs: number; postMs: number; probeMs: number; submitMs: number }[] = null;
  let lastStream: null | StreamStats = null;
  const runFixedSteps = (pending: number): number => {
    let steps = 0;
    fixedSteps = 0;
    controllerMs = 0;
    physicsMs = 0;
    while (pending >= FIXED_STEP && steps < MAX_CATCHUP_STEPS) {
      try {
        const controllerStarted = performance.now();
        controllerSystem.fixedUpdate(FIXED_STEP);
        const physicsStarted = performance.now();
        controllerMs += physicsStarted - controllerStarted;
        physicsSystem.fixedUpdate(FIXED_STEP);
        physicsMs += performance.now() - physicsStarted;
        // Enter/exit places the rider and DRIVES here — after the physics step, exactly where prod's Game
        // runs it. Without this the climb-in freezes mid-phase (the whole sequence lives in fixedUpdate).
        vehicles?.fixedUpdate(FIXED_STEP);
        // Contact-force impacts are produced BY the physics step, so drain them here — one step late and a
        // hard hit's forces are already gone.
        breakables.update();
      } catch (error) {
        debugError ??= error instanceof Error ? error.message : String(error);
      }
      pending -= FIXED_STEP;
      steps += 1;
      fixedSteps = steps;
    }

    return pending;
  };
  /**
   * Pose the ped for this frame. On foot: data-driven feet placement (a ground ray from the body CENTRE, own
   * capsule excluded — starting under the capsule slips through thin road shells into basements) plus a
   * heading from planar velocity. RIDING: both rules must be switched OFF. Enter/exit teleports the rider
   * onto the seat every fixed step, so the ground snap would lift the seated pose to `ground − minZ` (about a
   * metre — the driver ends up sitting on the ROOF), and a velocity-derived heading leaves him facing his old
   * walk direction while the car turns under him. The seat IS the pose: no lift, the car's own heading, and
   * zero speed so the scripted CAR_sit clip is not dragged back into locomotion.
   */
  const posePlayer = (
    gta: [number, number, number],
    playerEngine: [number, number, number],
    ridingCar: null | { heading: number },
    dt: number,
  ): void => {
    const vx = Velocity.x[playerEid];
    const vy = Velocity.y[playerEid];
    const speed = Math.hypot(vx, vy);
    if (ridingCar) {
      groundDelta = 0;
      heading = ridingCar.heading;
    } else {
      if (Velocity.grounded[playerEid] === 1) {
        const ground = physics.groundBelow([gta[0], gta[1], gta[2]], 4, RigidBody.handle[playerEid]);
        if (ground !== null) {
          groundDelta = ground - player.minZ - gta[2];
        }
      }
      if (speed > 0.3) {
        heading = Math.atan2(-vx, vy); // hold the last heading while standing
      }
    }
    const render: [number, number, number] = [playerEngine[0], playerEngine[1] + groundDelta, playerEngine[2]];
    player.update(render, heading, ridingCar ? 0 : speed, dt);
  };

  /** A car system throwing must not kill the frame loop — surface it in the HUD and keep walking. */
  const tickVehicles = (delta: number): void => {
    try {
      vehicles?.update(delta);
    } catch (error) {
      debugError ??= error instanceof Error ? error.message : String(error);
    }
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
      const fixedStarted = performance.now();
      accumulator = runFixedSteps(accumulator + dt);
      fixedMs = performance.now() - fixedStarted;
      const collisionStarted = performance.now();
      collision.update();
      updateClutter();
      collisionMs = performance.now() - collisionStarted;
      // Felled props follow their physics bodies (B7·a) — after the step, like every other body-driven visual.
      props.update();
      const animStarted = performance.now();
      animObjects.update(animStarted / 1000, [Transform.x[playerEid], Transform.y[playerEid], Transform.z[playerEid]]);
      animMs = performance.now() - animStarted;
      const vehiclesStarted = performance.now();
      tickVehicles(dt);
      vehiclesMs = performance.now() - vehiclesStarted;
      const previousHour = hour;
      hour = (hour + dt / (config.time.secondsPerGameMinute * 60)) % 24;
      if (hour < previousHour) {
        // A day passed: the moon walks its ~29.5-day cycle, so a week of play changes its face.
        engine.environment.moonPhase = (engine.environment.moonPhase + 1 / 29.5) % 1;
      }
      weatherTransition.tick(dt);
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
    const seatedCar = vehicles?.activeVehicle() ?? null;
    // Pose follows the RIDING car (climb-in included); the camera follows only the SEATED one.
    const ridingCar = vehicles?.ridingVehicle() ?? null;
    const playerEngine = toEngine(gta);
    if (!hostState.paused) {
      const pedStarted = performance.now();
      posePlayer(gta, playerEngine, ridingCar, dt);
      pedMs = performance.now() - pedStarted;
    }

    // Streaming follows the PLAYER (the B3 contract), not the camera.
    const streamStats: StreamStats = setup.driver.update(playerEngine);
    // Emitters follow the streamed cell set; the call self-gates on a signature, so this is not per-frame work.
    particles?.rebuild();
    lastStream = streamStats;

    // While seated the camera trails the CAR (the rider is teleported into the seat every frame — following
    // the ped would judder); on foot it trails the player.
    const focus = seatedCar ? toEngine(seatedCar.position) : playerEngine;
    const target: [number, number, number] = [focus[0], focus[1] + EYE_HEIGHT, focus[2]];
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
    [cameraEye[0], cameraEye[1], cameraEye[2]] = camera.eye;
    engine.probeCenter = probeCenterOf(probeEnabled, focus);
    engine.probeView = probeViewEnabled;
    // Live tier knob (074/09): the config value drives the target size; the engine rebuilds on change.
    engine.renderScale = config.graphics.renderScale;
    const stats = engine.frame(camera);
    // B7·b field stall: the CPU breakdown of the frames that actually hitch — a stall must arrive as a NUMBER,
    // not a theory. Quiet on a healthy frame. (The timings are last frame's; the stall is what matters.)
    if (dt * 1000 > SLOW_FRAME_MS) {
      // eslint-disable-next-line no-console
      console.log(
        `[slow] frame ${(dt * 1000).toFixed(1)} · gpu ${stats.gpuPassMs.toFixed(2)} · post ${stats.gpuPostMs.toFixed(2)} · probe ${stats.gpuProbeMs.toFixed(2)} · submit ${stats.submitMs.toFixed(2)} · ` +
          `fixed ${fixedMs.toFixed(1)} (${fixedSteps} steps: controller ${controllerMs.toFixed(1)} + physics ${physicsMs.toFixed(1)}) · ` +
          `collision ${collisionMs.toFixed(1)} · vehicles ${vehiclesMs.toFixed(1)} · ` +
          `ped ${pedMs.toFixed(2)} · anim ${animMs.toFixed(2)} · draws ${stats.drawsRecorded} · cells ${streamStats.loadedCells} · ` +
          `bodies ${physics.census().bodies} colliders ${physics.census().colliders}`,
      );
    }
    benchSamples?.push({
      draws: stats.drawsRecorded,
      frameMs: dt * 1000,
      gpuMs: stats.gpuPassMs,
      postMs: stats.gpuPostMs,
      probeMs: stats.gpuProbeMs,
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
      `submit  ${stats.submitMs.toFixed(2)} ms · GPU ${stats.gpuPassMs > 0 ? stats.gpuPassMs.toFixed(2) : 'n/a'} ms · post ${stats.gpuPostMs > 0 ? stats.gpuPostMs.toFixed(2) : 'n/a'} ms · probe ${stats.gpuProbeMs > 0 ? stats.gpuProbeMs.toFixed(2) : 'off'} ms · draws ${stats.drawsRecorded}\n` +
      `stream  ${streamStats.loadedCells} cells, ${streamStats.pendingCells} pending · residency ${(stats.residencyBytes / 1048576).toFixed(0)} MB\n` +
      `GTA     ${gta[0].toFixed(1)}, ${gta[1].toFixed(1)}, ${gta[2].toFixed(1)} · ${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}\n` +
      `debug   vel ${Velocity.x[playerEid].toFixed(2)},${Velocity.y[playerEid].toFixed(2)},${Velocity.z[playerEid].toFixed(2)} ` +
      `grounded ${Velocity.grounded[playerEid]} ${seatedCar ? '· SEATED ' : ''}` +
      `move ${JSON.stringify(input.move())} · ped sampler ${pedMs.toFixed(2)} ms · anim ${animMs.toFixed(2)} ms` +
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
      weatherTransition.begin(scene.weather, 0); // instant — bench scenes must not sample mid-blend
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
      const postSamples = samples.filter((sample) => sample.postMs > 0).map((sample) => sample.postMs);
      const probeSamples = samples.filter((sample) => sample.probeMs > 0).map((sample) => sample.probeMs);
      const report = {
        avgDrawCalls: Math.round(avg(samples.map((sample) => sample.draws))),
        avgMs: Number(avgMs.toFixed(3)),
        avgTriangles: 0,
        fps: Number((1000 / Math.max(0.001, avgMs)).toFixed(1)),
        frames: samples.length,
        gpuMs: {
          pass: Number(avg(gpuSamples).toFixed(3)),
          post: Number(avg(postSamples).toFixed(3)),
          probe: Number(avg(probeSamples).toFixed(3)),
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
      // Road cars (074 bench realism): typed cars from vehicles.ide on the path-node road graph around
      // every measured scene, registered LAZILY — the vehicle-lod system streams them exactly like the
      // game's own parked cars, so each scene measures a realistic vehicle load. Shared with the prod
      // three host (canvas-host) so the C1 baseline sweeps the SAME population.
      const placements = benchRoadCarPlacements(
        fs,
        scenes,
        new URLSearchParams(window.location.search).get('benchcar'),
      );
      if (vehicles && placements.length > 0) {
        vehicles.register(placements);
      } else if (scenes.some((scene) => scene.cars !== undefined)) {
        // eslint-disable-next-line no-console -- a silent empty street would read as a false measurement
        console.warn('[bench] road cars SKIPPED: no vehicle system, path graph or car models');
      }
      // eslint-disable-next-line no-console -- bench CLI feedback (the record's context, same protocol)
      console.log(`[bench] road cars registered: ${vehicles ? placements.length : 0}`);
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
      // Vertex = [x, y, z, depth, class] (plan 075: class 0 = sea, 1 = inland) — stride 20.
      const gta = new Float32Array(bin.buffer, bin.byteOffset + 8, vertexCount * 5);
      const indices = new Uint32Array(bin.buffer.slice(bin.byteOffset + 8 + vertexCount * 20), 0, indexCount);
      // GTA Z-up → engine Y-up in place; the shore field + water class ride along untouched.
      const vertices = new Float32Array(vertexCount * 5);
      for (let v = 0; v < vertexCount; v += 1) {
        vertices[v * 5] = gta[v * 5];
        vertices[v * 5 + 1] = gta[v * 5 + 2];
        vertices[v * 5 + 2] = -gta[v * 5 + 1];
        vertices[v * 5 + 3] = gta[v * 5 + 3];
        vertices[v * 5 + 4] = gta[v * 5 + 4];
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
    const base = positions.length / 5;
    // Class from height (plan 075): elevated pools/reservoirs = inland (calm); the flat fallback has no bake.
    const waterClass = quad.vertices[0][2] > 1 ? 1 : 0;
    for (const [x, y, z] of quad.vertices) {
      positions.push(x, z, -y, 120, waterClass); // constant "deep" field — no foam/damping without the bake
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

/**
 * Env-probe centre (074/16 step 2): the FOLLOWED thing — the seated car while driving, the player on foot
 * (nearby parked cars share the same probe, like prod's camera-centred cube). Lifted ~1 unit so the ground
 * plane doesn't split the cube in half at the centre. `?probe=0` keeps the analytic-sky fallback.
 */
function probeCenterOf(enabled: boolean, focus: readonly [number, number, number]): [number, number, number] | null {
  return enabled ? [focus[0], focus[1] + 1.0, focus[2]] : null;
}

/** GTA Z-up point → engine Y-up: (x, y, z) → (x, z, −y). */
function toEngine(gta: readonly [number, number, number]): [number, number, number] {
  return [gta[0], gta[2], -gta[1]];
}
