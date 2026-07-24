/**
 * Own-engine game host (plan 074/10 B3, `?engine=opensa`): the game world boots on `@opensa/engine`
 * instead of three-WebGL. REUSED from the game unchanged: the runtime Config (shared factory — behaviour
 * parity by construction), Rapier physics + the character controller system + collision streaming (all
 * pure), keyboard input. REPLACED: rendering (engine cells + streaming driver follow the PLAYER), the
 * camera (follow orbit producing a CameraState), the player body (the B1 ped probe driven by gameplay
 * state). Three and the own engine never share a canvas — this host IS the capability branch.
 */
import type { City } from '@opensa/game';
import type { LookDirectionSource } from '@opensa/game/character/character-controller.system';
import type { PerfStats } from '@opensa/game/perf/perf-monitor';
import type { ReactElement } from 'react';

import {
  type DebugLineSetId,
  Engine,
  type LocalPakSource,
  type PakSource,
  setupStreaming,
  type StreamStats,
} from '@opensa/engine';
import {
  createEngineEnvironmentDriver,
  DEFAULT_DRAW_DISTANCE,
  FOG_RING_MARGIN,
} from '@opensa/game/adapters/engine-environment-driver';
import { GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import { CharacterControllerSystem } from '@opensa/game/character/character-controller.system';
import { Logger } from '@opensa/game/diagnostics/logger';
import { Locomotion, PlayerControlled, RigidBody, Transform, Velocity } from '@opensa/game/ecs/components';
import { createEcsWorld } from '@opensa/game/ecs/world';
import { EventBus } from '@opensa/game/events/event-bus';
import { type GameEvents } from '@opensa/game/events/events.global';
import { CombinedInput, Keyboard, KeyboardSource } from '@opensa/game/input';
import { PhysicsWorld } from '@opensa/game/physics/physics-world';
import { PhysicsSystem } from '@opensa/game/physics/physics.system';
import { initRapier } from '@opensa/game/physics/rapier';
import { CollisionStreamingSystem } from '@opensa/game/streaming/collision-streaming.system';
import { cellsWithin } from '@opensa/game/streaming/grid';
import { WeatherTransition } from '@opensa/game/weather/weather-transition';
import { weatherForCity } from '@opensa/game/weather/weather-zones';
import { type CityBox, isDesertZone } from '@opensa/game/zones/city';
import { CityZoneSystem } from '@opensa/game/zones/city-zone.system';
import { type NamedZone, ZoneNameSystem } from '@opensa/game/zones/zone-name.system';
import { type AssetFileSystem, gxtKeyHash, oceanFrame, parseTxd, WEATHER_NAMES } from '@opensa/renderware';
import { parseWater } from '@opensa/renderware/parsers/text/water.parser';
import { decodeDxt } from '@opensa/renderware/textures/dxt';
import { addComponent, addEntity } from 'bitecs';
import { useEffect, useRef, useState } from 'react';

import type { GameId } from '../game-config';

import { IS_DEV } from '../dev-mode';
import { GAME_CONFIG } from '../game-config';
import { vehicleModelsFromIde } from '../vehicle-models';
import { buildCollisionLines } from './collision-wireframe';
import { ENGINE_DEBUG_CAPABILITIES } from './debug/debug-capabilities';
import { type DebugActions, type DebugGame, DebugOverlay } from './debug/debug-overlay';
import { type MapGame } from './debug/map-inspector';
import { setupEngineAnimObjects } from './engine-anim-objects';
import { setupEngineBreakables } from './engine-breakables';
import {
  CAMERA_FOV_Y,
  createChordWatcher,
  cursorRay,
  flyStep,
  panStep,
  resolveCamera,
  TOP_DOWN_PITCH,
} from './engine-camera';
import { setupEngineClutter } from './engine-clutter';
import { createEngineDebugActions, type EnginePerfSnapshot } from './engine-debug-actions';
import { loadCoronaSprites, setupEngineParticles } from './engine-particles';
import { ledgerBreakdown, type LegSample, setupPerfRuns } from './engine-perf-runs';
import { loadEnginePlayer } from './engine-player';
import { setupEngineProps } from './engine-props';
import { type EngineVehicles, setupEngineVehicles } from './engine-vehicles';
import { createGameRuntimeConfig, GAME_CELL_SIZE } from './game-runtime-config';
import { Hud, type HudGame } from './hud/hud';
import { loadFonts } from './hud/load-fonts';
import { loadCityBoxes, loadGxt, loadInfoZones } from './zone-data';

interface EngineCanvasHostProps {
  fs: AssetFileSystem;
  gameId: GameId;
  onWorldReady?: () => void;
  /** Folder mode: the picked install's world-pak source (opensa/ inside it). null/absent ⇒ HTTP mode, world
   *  from `?src=` or `public/pak-map`. The loading MODE selects the world — folder mode never reads public. */
  pakSource?: LocalPakSource | null;
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
/** Photo-camera movement keys (prod's fly mode: ARROWS move, the WASD player keeps walking). */
const FLY_KEYS = new Set(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'PageDown', 'PageUp']);
/** Photo-camera speed (units/s) — prod's `camera-controller.FLY_SPEED`, so both hosts fly the same. */
const FLY_SPEED = 18;
/** Map-viewer "Top (reset view)" altitude above the player, in engine units — high enough to frame a
 *  250 u section with margin. */
const TOP_DOWN_HEIGHT = 400;
/** Fog distances the map viewer forces — past the camera far plane (10 000), so nothing is ever fogged. */
const NO_FOG_DISTANCE = 100000;

/** Shared mutable flags between React props and the boot closure. */
const hostState = { paused: false };
let booted: null | Promise<void> = null;
/** The HudGame the boot closure builds (module scope — survives StrictMode's dev double-mount). */
let hudGameRef: HudGame | null = null;
/** The F2 debugger's surfaces (074/22), built by the same boot closure. */
let debugRef: null | { actions: DebugActions; buildTime?: string; game: DebugGame; mapGame: MapGame } = null;

export function EngineCanvasHost({
  fs,
  gameId,
  onWorldReady,
  pakSource = null,
  paused = false,
}: EngineCanvasHostProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hudGame, setHudGame] = useState<HudGame | null>(hudGameRef);
  const [debug, setDebug] = useState(debugRef);
  const [locked, setLocked] = useState(false);
  hostState.paused = paused;

  // Mouse capture (pointer lock): the look uses movementX/Y while locked, so the player needs an
  // affordance telling them to click — prod's `sa-capture` button, ported verbatim (074/22 phase 6).
  useEffect(() => {
    const onChange = (): void => setLocked(document.pointerLockElement === canvasRef.current);
    document.addEventListener('pointerlockchange', onChange);

    return (): void => document.removeEventListener('pointerlockchange', onChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    booted ??= boot(canvas, fs, gameId, pakSource, onWorldReady).catch((error: unknown) => {
      // eslint-disable-next-line no-console -- boot failures must surface somewhere visible in dev
      console.error('[engine-host] boot failed', error);
    });
    void booted.then(() => {
      setHudGame(hudGameRef);
      setDebug(debugRef);
    });
  }, [fs, gameId, pakSource, onWorldReady]);

  function capture(): void {
    // Newer browsers return a Promise that can reject (denied / unsupported); swallow it either way.
    void Promise.resolve(canvasRef.current?.requestPointerLock()).catch(() => undefined);
  }

  // No wrapper: like CanvasHost, the canvas fills the shell's `.sa-game` container directly.
  return (
    <>
      <canvas ref={canvasRef} style={{ display: 'block', height: '100%', width: '100%' }} />
      {hudGame && !locked && !paused ? (
        <button className="sa-capture" onClick={capture} type="button">
          Click to play
        </button>
      ) : null}
      {hudGame ? <Hud game={hudGame} /> : null}
      {debug ? (
        <DebugOverlay
          actions={debug.actions}
          buildTime={debug.buildTime}
          capabilities={ENGINE_DEBUG_CAPABILITIES}
          game={debug.game}
          mapGame={debug.mapGame}
          teleports={GAME_CONFIG[gameId].teleports ?? []}
        />
      ) : null}
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
  pakSourceProp: LocalPakSource | null,
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
  // so streaming pops are impossible by construction. Per-game default from GAME_CONFIG (an island TC
  // needs a wider ring than SA's continuous city); `?draw=N` = live A/B (min 400 keeps rings sane).
  const drawParam = Number(params.get('draw') ?? Number.NaN);
  const drawDistance = Number.isFinite(drawParam)
    ? Math.max(400, drawParam)
    : (GAME_CONFIG[gameId].drawDistance ?? DEFAULT_DRAW_DISTANCE);
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
  // The loading MODE selects the world (pak-source fix): folder mode reads the pak from the picked install's
  // opensa-pack/ sibling (086 phase 7; legacy: the nested opensa/ folder); HTTP mode keeps the URL (?src= or
  // public/pak-map). A folder with no pak fails loudly in setupStreaming — it must NEVER fall back to public
  // (that silent fallback made every folder-based measurement read whatever sat in public/, regardless of the pick).
  const pakSource: PakSource = pakSourceProp ?? `/${params.get('src') ?? 'pak-map'}`;
  const setup = await setupStreaming(engine, pakSource, { lodRadius: drawDistance });
  // Environment drive (074/10 config-API parity): the SHARED config→Environment driver — real timecyc
  // colours, sun/moon arcs built dynamically from config night.litFade, prod graphics tunables (sky mood,
  // cloud opacity, moon brightness, godrays, fog timecycScale) live on.
  const weather = Number(params.get('weather') ?? 0) || 0;
  // Weather transitions (prod parity): the SAME WeatherTransition class prod's Game runs — one driver,
  // its blend getter eases from→to over config.weatherTransitionSeconds (smoothstep, like prod).
  const weatherTransition = new WeatherTransition(weather);
  // Timecyc comes from the LIVE game files, with prod's exact preference (timecyc_24h.dat as authored,
  // else vanilla timecyc.dat converted). There is no pak-baked copy to fall back to any more: the manifest
  // rule (opensa-pack 003) forbids carrying data that already exists in the game dir, and that copy is
  // precisely what froze weather/fog at convert time and diverged from prod (2026-07-18 field finding).
  const liveTimecyc24 = fs.getText('data/timecyc_24h.dat');
  const liveTimecyc = liveTimecyc24 ?? fs.getText('data/timecyc.dat');
  const timecycSource = liveTimecyc !== null ? { is24h: liveTimecyc24 !== null, text: liveTimecyc } : undefined;
  const environmentDriver = createEngineEnvironmentDriver(engine.environment, {
    config,
    fogCap: drawDistance - FOG_RING_MARGIN,
    ...(timecycSource ? { timecyc: timecycSource } : {}),
    weather,
    weatherBlend: () => weatherTransition.blend(),
  });
  // '[' / ']' cycle the weather LIVE (sky v2 field iteration — a URL change costs a whole VFS reboot).
  // The transition's `target` IS the live weather id — the bench, the debugger, the regional remap and
  // these keys all go through it, so nothing can drift out of sync with what timecyc actually samples.
  const liveWeather = (): number => weatherTransition.target;
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'BracketLeft' && event.code !== 'BracketRight') {
      return;
    }
    weatherTransition.begin(
      (liveWeather() + (event.code === 'BracketRight' ? 1 : 19)) % 20,
      config.weatherTransitionSeconds,
    );
    // eslint-disable-next-line no-console -- field-iteration feedback (which weather id is on screen)
    console.log(`[engine-host] weather ${liveWeather()}`);
  });
  void installWater(engine, fs, setup.water, pakSource);

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
    // Asset-resolution warnings (opensa-pack 003) — a mod we could not honour, or a name nothing answers.
    // Already once-per-message in the adapter; printing is the host's job.
    // eslint-disable-next-line no-console -- an unhonoured mod or a missing model must be visible
    onAssetWarning: (message): void => console.warn(`[assets] ${message}`),
    // Clutter follows the live per-category debug knobs (0 when disabled) — see the debugger's setProcObj.
    procObjDensityOf: (category): number => {
      const setting = config.graphics.procobj[category];

      return setting.enabled ? setting.density : 0;
    },
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
  addComponent(world, playerEid, Locomotion);
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
  Locomotion.heading[playerEid] = Math.PI; // spawn facing, mirrors the pose fallback below
  Locomotion.state[playerEid] = 0; // LOCOMOTION_GROUNDED
  Locomotion.stateTime[playerEid] = 0;
  Locomotion.fallSpeed[playerEid] = 0;
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
  /** The config distance this zoom last followed — a debugger change (074/22) re-seeds the live zoom. */
  let authoredDistance = config.camera.followDistance;
  let dragging = false;
  /** Map-viewer state (074/22): a click PICKS instead of grabbing the pointer, and the mapper is resident. */
  let mapViewer = false;
  let selectedPlacement: null | number = null;
  let hiddenPlacements = 0;
  /**
   * Pick along a caller-supplied ray. Gameplay passes the camera forward — under pointer lock the crosshair
   * IS the aim. The map viewer has no lock, so it passes {@link cursorRay}: there the cursor is the aim, and
   * a forward-vector pick would select whatever happened to sit at screen centre.
   */
  const pickAlong = (direction: [number, number, number]): void => {
    const hit = engine.cells.pick(cameraEye, direction);
    selectedPlacement = hit?.id ?? null;
    events.emit(
      'select',
      hit
        ? {
            // Engine (x, y, z) back to GTA (x, −z, y): the panel reports the coordinates the map files use.
            modelName: hit.model,
            position: [hit.position[0], -hit.position[2], hit.position[1]],
            txdName: hit.txd,
          }
        : null,
    );
  };
  /** Cursor position in NDC (y up), from a pointer event over the canvas. */
  const ndcOf = (event: PointerEvent | WheelEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();

    return [
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      1 - ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2,
    ];
  };
  /**
   * Map-viewer mouse (the three OrbitControls mapping prod used: LEFT pans, RIGHT rotates).
   *
   * A left press is ambiguous until it ends — it is a PICK if the pointer barely moved, a pan otherwise —
   * so the pick fires on pointer UP under the travel threshold, never on down. Panning a district would
   * otherwise select whatever the drag started on.
   */
  let mapDrag: null | { button: number; moved: number; ndc: [number, number] } = null;
  const PICK_TRAVEL = 0.01;
  canvas.addEventListener('contextmenu', (event) => {
    if (mapViewer) {
      event.preventDefault(); // right-drag orbits; the menu would eat the gesture
    }
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (mapViewer) {
      mapDrag = { button: event.button, moved: 0, ndc: ndcOf(event) };
      canvas.setPointerCapture(event.pointerId);

      return; // in the map viewer a click SELECTS or drags; it must not also grab the pointer
    }
    // The pointer is grabbed ONLY by the "Click to play" button (prod's rule — `canvas-host` has exactly one
    // `requestPointerLock`, in that handler). Locking on any canvas press made the FIRST click anywhere a
    // capture: the map viewer's click-to-select could never fire, because the click that would have selected
    // was spent taking the pointer. Drag-look below covers looking around while unlocked.
    dragging = true;
  });
  window.addEventListener('pointerup', (event) => {
    dragging = false;
    if (mapViewer && mapDrag) {
      if (mapDrag.button === 0 && mapDrag.moved < PICK_TRAVEL) {
        pickAlong(cursorRay(forwardOf(), ndcOf(event), canvas.width / Math.max(1, canvas.height), CAMERA_FOV_Y));
      }
      mapDrag = null;
    }
  });
  window.addEventListener('pointermove', (event) => {
    if (mapViewer) {
      if (!mapDrag) {
        return;
      }
      const ndc = ndcOf(event);
      const delta: [number, number] = [ndc[0] - mapDrag.ndc[0], ndc[1] - mapDrag.ndc[1]];
      mapDrag.moved += Math.hypot(delta[0], delta[1]);
      mapDrag.ndc = ndc;
      if (mapDrag.button === 2) {
        // The viewer may look straight DOWN (that is its resting view), so it gets the full pitch range the
        // basis allows — not the gameplay camera's −1.2 floor.
        yaw -= event.movementX * 0.004;
        pitch = Math.max(TOP_DOWN_PITCH, Math.min(0.9, pitch - event.movementY * 0.004));
      } else if (mapDrag.button === 0 && flyEye) {
        // Pan by the eye's HEIGHT so the gesture covers the same apparent distance at any altitude.
        flyEye = panStep(flyEye, forwardOf(), delta, Math.max(1, flyEye[1]));
      }

      return;
    }
    if (document.pointerLockElement === canvas || dragging) {
      yaw -= event.movementX * 0.004;
      pitch = Math.max(-1.2, Math.min(0.9, pitch - event.movementY * 0.004));
    }
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (mapViewer && flyEye) {
      // Dolly the detached eye along the view — the follow rig's zoom config does not apply to a free eye.
      const [fx, fy, fz] = forwardOf();
      const step = Math.max(1, flyEye[1]) * (event.deltaY > 0 ? -0.12 : 0.12);
      flyEye = [flyEye[0] + fx * step, Math.max(2, flyEye[1] + fy * step), flyEye[2] + fz * step];

      return;
    }
    if (!config.camera.followZoom) {
      return; // wheel zoom is a config toggle (debug → Camera), like prod
    }
    followDistance = Math.max(
      config.camera.followZoomMin,
      Math.min(config.camera.followZoomMax, followDistance * (event.deltaY > 0 ? 1.08 : 0.93)),
    );
  });
  /** Re-read the authored camera distance/zoom bounds (the debugger mutates them live). */
  const syncCameraConfig = (): void => {
    if (config.camera.followDistance !== authoredDistance) {
      authoredDistance = config.camera.followDistance;
      followDistance = authoredDistance;
    }
    followDistance = Math.max(config.camera.followZoomMin, Math.min(config.camera.followZoomMax, followDistance));
  };
  /**
   * Photo camera (074/22 phase 2.7 + 5): a detached free-fly EYE. The player entity is untouched — it keeps
   * standing (or walking under WASD) exactly as prod's fly mode does; only the camera leaves the rig.
   * ARROW keys move it (prod semantics), the mouse look is the shared yaw/pitch.
   */
  let flyEye: [number, number, number] | null = null;
  const flyKeys = new Set<string>();
  /** Enter/leave the photo camera. Entering seeds the eye from the live camera (no jump); the player entity
   *  is untouched either way. The HUD hides itself on the shared `'fly-camera'` event, exactly as in prod. */
  const setFlyMode = (on: boolean): void => {
    flyEye = on ? [cameraEye[0], cameraEye[1], cameraEye[2]] : null;
    flyKeys.clear();
    events.emit('fly-camera', { enabled: on });
  };
  /**
   * The map viewer renders WITHOUT fog (field check, 2026-07-20).
   *
   * The viewer sits {@link TOP_DOWN_HEIGHT} above the district, and the authored fog cut is often far less
   * than that — LA-clear is 800, FOGGY_SF 250. The ground was therefore past the cut and the whole district
   * dissolved into fog colour: at night that reads as an empty brown screen, which is what "the map viewer
   * does not work" looked like. The geometry was there the whole time (a whole-map pin loaded 840 cells and
   * drew 1297 batches into an invisible frame).
   *
   * Fog is a look, and the viewer is an inspection tool — so it is simply switched off here rather than
   * stretched. Re-applied every frame because `environmentDriver.apply` rewrites both distances from timecyc.
   */
  const clearMapViewerFog = (): void => {
    if (!mapViewer) {
      return;
    }
    engine.environment.fogCutDistance = NO_FOG_DISTANCE;
    engine.environment.fogStartDistance = NO_FOG_DISTANCE;
  };
  /**
   * Lift the detached eye straight over the player and aim it down. The pitch stops just short of -PI/2: a
   * perfectly vertical forward vector is degenerate for the look-at basis.
   *
   * This is what ENTERING the map viewer does, not only the "Top" button. `setFlyMode` alone detaches the eye
   * where it already stands, looking where it already looked — indistinguishable from the activation doing
   * nothing at all. The three-based camera controller snapped overhead inside `enterDebug()` for that reason.
   */
  const snapTopDown = (): void => {
    const [ex, ey, ez] = toEngine(viewOf());
    flyEye = [ex, ey + TOP_DOWN_HEIGHT, ez];
    pitch = TOP_DOWN_PITCH;
  };
  const photoChord = createChordWatcher('KeyK', 'KeyM');
  window.addEventListener('keydown', (event) => {
    if (photoChord.down(event.code)) {
      setFlyMode(flyEye === null);
    }
    if (event.key === 'F2' && flyEye) {
      setFlyMode(false); // entering the debugger leaves the photo camera (prod behaviour)
    }
    if (flyEye && FLY_KEYS.has(event.code)) {
      event.preventDefault();
      flyKeys.add(event.code);
    }
  });
  window.addEventListener('keyup', (event) => {
    photoChord.up(event.code);
    flyKeys.delete(event.code);
  });
  const forwardOf = (): [number, number, number] => [
    Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    Math.cos(pitch) * Math.cos(yaw),
  ];
  // The controller only calls camera.getWorldDirection(v) — hand it the follow camera's forward.
  const cameraShim: LookDirectionSource = {
    getWorldDirection: (target) => {
      const [fx, fy, fz] = forwardOf();

      return target.set(fx, fy, fz);
    },
  };

  const controllerSystem = new CharacterControllerSystem(world, physics, input, config, controller, cameraShim);
  const physicsSystem = new PhysicsSystem(world, physics, config);
  const collision = new CollisionStreamingSystem(adapter, physics, viewOf, config);

  const player = loadEnginePlayer(engine, fs, GAME_CONFIG[gameId].mainCharacter, config.movement);
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
  /**
   * "Show collision" (074/22): the collider set around the CAMERA, drawn through the engine's line-list debug
   * pipeline. The three build used a scene-wide `LineSegments`; the engine's `createDebugLines` wants one flat
   * endpoint array, which is what `buildCollisionLines` produces.
   *
   * It follows the camera, not the player — in the map viewer you fly away from the player, and collision you
   * cannot see is not a debug overlay. Rebuilt only when the camera changes CELL, so this is not frame work.
   */
  let collisionLines: DebugLineSetId | null = null;
  let collisionSignature = '';
  let showCollision = false;
  const COLLISION_COLOUR: [number, number, number, number] = [0, 1, 0.4, 1];
  const refreshCollision = async (force = false): Promise<void> => {
    if (!showCollision) {
      return;
    }
    const [gx, gy] = [cameraEye[0], -cameraEye[2]];
    const cells = cellsWithin([gx, gy, 0], config.streaming.collisionDrawDistance, adapter.cellSize);
    const signature = cells.map(([cx, cy]) => `${cx},${cy}`).join(';');
    if (!force && signature === collisionSignature) {
      return;
    }
    collisionSignature = signature;
    const loaded = await Promise.all(cells.map(([cx, cy]) => adapter.loadCellColliders(cx, cy)));
    if (!showCollision) {
      return; // toggled off while awaiting
    }
    const positions = buildCollisionLines(loaded.flat());
    if (collisionLines === null) {
      collisionLines = engine.createDebugLines(positions, COLLISION_COLOUR);
    } else {
      // The buffer is sized at creation, so a bigger set needs a new one rather than a partial upload.
      engine.destroyDebugLines(collisionLines);
      collisionLines = engine.createDebugLines(positions, COLLISION_COLOUR);
    }
  };
  const setShowCollision = (enabled: boolean): void => {
    showCollision = enabled;
    if (!enabled) {
      if (collisionLines !== null) {
        engine.destroyDebugLines(collisionLines);
        collisionLines = null;
      }
      collisionSignature = '';

      return;
    }
    void refreshCollision(true);
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
  // Boot clock: `?hour=` wins, else the game's configured start time (GAME_CONFIG.loadGame.startMinutes —
  // the field the engine host ignored until 2026-07-23; original keeps its 22:00 night default there).
  let hour =
    Number.isFinite(hourParam) && params.get('hour') !== null
      ? hourParam
      : GAME_CONFIG[gameId].loadGame.startMinutes / 60;
  environmentDriver.apply(hour);

  // Prod HUD + district names (074/10 reuse-not-duplicate): the SAME DOM <Hud> component fed through the
  // narrow HudGame surface; the lookup is the game's own ZoneNameSystem over info.zon + american.gxt.
  await loadFonts(config.fonts);
  const events = new EventBus<GameEvents>();
  let zoneName = '';
  const gxt = loadGxt(fs, 'text/american.gxt');
  const infoZones = loadInfoZones(fs, 'data/info.zon');
  const namedZones: NamedZone[] = infoZones.map((zone) => ({ max: zone.max, min: zone.min, name: zone.label }));
  const zoneSystem = new ZoneNameSystem(namedZones, viewOf, (key) => {
    zoneName = (gxt?.get(gxtKeyHash(key)) ?? '').trim();
    events.emit('zone', { name: zoneName });
  });
  // City tracking (plan 035 parity): the SAME CityZoneSystem over map.zon boxes, desert counties first so
  // they win over the coarse Las Venturas box. Feeds the debugger's city label through the shared bus.
  const desertBoxes: CityBox[] = infoZones.flatMap((zone) =>
    isDesertZone(zone.label) ? [{ city: 'DESERT' as const, max: zone.max, min: zone.min }] : [],
  );
  let city: City = 'COUNTRYSIDE';
  const citySystem = new CityZoneSystem([...desertBoxes, ...loadCityBoxes(fs, 'data/map.zon')], viewOf, (next) => {
    city = next;
    events.emit('city', { city: next });
    // SA authors every weather TYPE per region (CLOUDY_LA / CLOUDY_COUNTRYSIDE / …) and each column carries
    // its own fog mood — countryside CLOUDY reaches 1150 u where the LA column stops at 700. Prod adapts the
    // weather when the player CROSSES into another region (canvas-host, plan 035); without it the engine
    // rendered LA's fog mood in the countryside (the "engine draws closer than prod" report, 074/22).
    //
    // KNOWN CONSEQUENCE (2026-07-18): RAINY has no LA/VEGAS column, so LS rain falls back to
    // RAINY_COUNTRYSIDE, whose authored night fog cut is ~330 u (and 1 u at 20:00 in the 24 h table) —
    // bench `ls-rain-night` then renders almost black. That is the authored mood meeting our night fog
    // colour; prod only avoids it because its remap happens to never fire in that bench. Tracked as an
    // open issue rather than papered over here (see plan 21 ledger).
    weatherTransition.begin(
      weatherForCity(WEATHER_NAMES, weatherTransition.target, next),
      config.weatherTransitionSeconds,
    );
  });
  const minutesNow = (): number => Math.floor((((hour % 24) + 24) % 24) * 60);
  let lastMinutes = minutesNow();
  hudGameRef = {
    events,
    getConfig: (): typeof config => config,
    getTime: minutesNow,
    getZone: (): string => zoneName,
  };

  // F2 debugger (074/22 phase 2): the SAME overlay prod runs, over thin host accessors. Graphics rows need
  // no wiring at all — they mutate the shared config the environment driver re-reads every frame.
  const vehicleModels = vehicleModelsFromIde(fs);
  /** Cycle each car's own carcols combos on repeated spawns (prod parity — a re-spawn gives a new colour). */
  const colourCycle = new Map<string, number>();
  debugRef = {
    actions: createEngineDebugActions({
      breakNearest: (position, radius) => breakables.breakNearest(position, radius),
      cameraDistance: () => followDistance,
      city: (): City => city,
      config,
      flipVehicle: () => flipActiveVehicle(physics, vehicles?.activeVehicle() ?? null),
      getHour: () => hour,
      gpuTimings: () =>
        lastStats
          ? [
              ['world', lastStats.gpuPassMs],
              ['post', lastStats.gpuPostMs],
              ['probe', lastStats.gpuProbeMs],
              ['submit', lastStats.submitMs],
            ]
          : [],
      isFlying: () => flyEye !== null,
      missingTextureHighlight: () => missingTexHighlight,
      perfHud: () => perfHud,
      perfLogs: () => perfLogs,
      perfSnapshot: (): EnginePerfSnapshot | null => {
        const stats = lastStats;
        const measured = frameStats(frames, stats);

        return stats && measured
          ? {
              avgMs: measured.avgMs,
              drawDistance,
              draws: stats.drawsRecorded,
              fog: { cut: engine.environment.fogCutDistance, start: engine.environment.fogStartDistance },
              gpu: {
                pass: stats.gpuPassMs,
                post: stats.gpuPostMs,
                probe: stats.gpuProbeMs,
                submit: stats.submitMs,
              },
              p95Ms: measured.p95Ms,
              residency: ledgerBreakdown(engine),
              residencyMb: stats.residencyBytes / 1048576,
              stream: {
                late: lastStream?.lateCreates ?? 0,
                loaded: lastStream?.loadedCells ?? 0,
                pending: lastStream?.pendingCells ?? 0,
              },
              weather: { id: liveWeather(), name: WEATHER_NAMES[liveWeather()] ?? '?' },
            }
          : null;
      },
      perfStats: () => frameStats(frames, lastStats),
      placePlayer,
      playerCoords: viewOf,
      reloadClutter: (): void => {
        adapter.invalidateColliderCache();
        collision.reload();
        for (const key of clutterLoaded) {
          engineClutter.removeCell(key);
        }
        clutterLoaded.clear();
      },
      setDebugNormals: (enabled): void => {
        engine.debugNormals = enabled;
      },
      setFlyMode,
      setHour: (value): void => {
        hour = value;
      },
      setMissingTextureHighlight: (enabled): void => {
        missingTexHighlight = enabled;
        engine.textures.setMissingHighlight(enabled);
      },
      setPerfHud: (enabled): void => {
        perfHud = enabled;
      },
      setPerfLogs: (enabled): void => {
        perfLogs = enabled;
      },
      setWeather: (index): void => weatherTransition.begin(index, config.weatherTransitionSeconds),
      spawn,
      spawnVehicle: async (model): Promise<void> => {
        const combos = await adapter.vehicleColourCombos(model);
        const index = colourCycle.get(model) ?? 0;
        colourCycle.set(model, index + 1);
        const [px, py, pz] = viewOf();
        // In FRONT of the camera, facing the same way. The camera's native forward is (sin yaw, −cos yaw);
        // a heading h points along (−sin h, cos h), so the matching heading is yaw + π.
        const position: [number, number, number] = [px + Math.sin(yaw) * 5, py - Math.cos(yaw) * 5, pz + 1];
        await vehicles?.spawn({
          ...(combos.length > 0 ? { colour: combos[index % combos.length].join(',') } : {}),
          groundSnap: true,
          heading: yaw + Math.PI,
          model,
          position,
        });
      },
      topDownView: (): void => snapTopDown(),
      vehicleModels: () => vehicleModels,
      weather: liveWeather,
    }),
    ...(setup.buildTime !== undefined ? { buildTime: setup.buildTime } : {}),
    game: { events },
    // The Map screen (074/22 phases 7-8). Picking rides the `.oscell` placement mapper (minor 6): a pak
    // converted before it simply yields no hits, which the inspector reports rather than pretending.
    mapGame: {
      cellSize: (): number => setup.cellSize,
      events,
      hideSelectedObject: (): number => {
        if (selectedPlacement !== null && engine.cells.hidePlacement(selectedPlacement) > 0) {
          hiddenPlacements += 1;
          selectedPlacement = null;
          events.emit('select', null); // the object is gone from view — clear the selection panel
        }

        return hiddenPlacements;
      },
      listCells: (): ReturnType<MapGame['listCells']> => setup.driver.listCells(),
      restoreHiddenObjects: (): number => {
        // Hiding degenerates indices in place and has no inverse; a cell RELOAD rebuilds its index buffer
        // straight from the pak, so dropping every loaded cell restores the lot. The pinned set re-streams
        // on the next update, which is the same path entering the viewer already takes.
        setup.driver.unloadAll();
        hiddenPlacements = 0;

        return 0;
      },
      setManualCells: (cells, lod): void => setup.driver.setManualCells(cells, lod),
      setMapViewer: (enabled): void => {
        // The viewer detaches the camera (the existing photo camera) and hands the cell set to the
        // inspector; leaving restores focus-driven streaming. The HUD hides itself on the same event.
        mapViewer = enabled;
        // The mapper + retained index bytes are tens of MB on a full map, so they are viewer-only. This
        // takes effect on the next LOAD — `unloadAll` below is what makes that immediate, in both directions.
        engine.cells.debugPicking = enabled;
        setup.driver.unloadAll();
        setFlyMode(enabled);
        if (enabled) {
          snapTopDown(); // the viewer opens LOOKING at the district, as the three camera controller did
        }
        if (!enabled) {
          setShowCollision(false); // the overlay belongs to the viewer; leaving must not strand it on screen
          setup.driver.setManualCells(null);
          selectedPlacement = null;
          hiddenPlacements = 0;
          events.emit('select', null);
        }
        events.emit('map-viewer', { enabled });
      },
      setShowCollision,
      viewCell: (): [number, number] | null => {
        const [gx, gy] = viewOf();

        return [Math.floor(gx / setup.cellSize), Math.floor(gy / setup.cellSize)];
      },
    },
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
  let benchSamples: LegSample[] | null = null;
  let lastStream: null | StreamStats = null;
  /** Last frame's engine stats — the debugger's Perf screen and the HUD read them. */
  let lastStats: null | ReturnType<Engine['frame']> = null;
  // Developer readouts (074/22 phase 3.3): ON while developing, OFF in a production build; both are
  // toggled live from the debugger's Perf screen.
  let perfHud = IS_DEV;
  let perfLogs = IS_DEV;
  // Missing-texture highlight (plan 085 row B): magenta stand-ins ON while developing, the quiet material
  // colour in a production build; toggled live from the debugger's Map screen. Applying the flag here is
  // early enough — arrays stream in later and paint on load.
  let missingTexHighlight = IS_DEV;
  engine.textures.setMissingHighlight(missingTexHighlight);
  // Soak-mode HUD line (074/10 ③) — progress while running, the verdict when done (the Safari
  // read-off). Carries its own leading newline so the HUD appends it unconditionally.
  let soakStatus = '';
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
   * capsule excluded — starting under the capsule slips through thin road shells into basements) plus the
   * controller-owned rate-limited heading (plan 088/01, `Locomotion.heading`). RIDING: both rules must be
   * switched OFF. Enter/exit teleports the rider onto the seat every fixed step, so the ground snap would
   * lift the seated pose to `ground − minZ` (about a metre — the driver ends up sitting on the ROOF), and a
   * walk-derived heading leaves him facing his old direction while the car turns under him. The seat IS the
   * pose: no lift, the car's own heading (written BACK into Locomotion so dismounting turns from the car's
   * yaw, not a stale walk yaw), and zero speed so the scripted CAR_sit clip is not dragged into locomotion.
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
      Locomotion.heading[playerEid] = heading;
    } else {
      if (Velocity.grounded[playerEid] === 1) {
        const ground = physics.groundBelow([gta[0], gta[1], gta[2]], 4, RigidBody.handle[playerEid]);
        if (ground !== null) {
          groundDelta = ground - player.minZ - gta[2];
        }
      }
      heading = Locomotion.heading[playerEid] ?? heading;
    }
    const render: [number, number, number] = [playerEngine[0], playerEngine[1] + groundDelta, playerEngine[2]];
    // Riding forces the grounded state (0) — the seat pose must never pick a jump/fall clip.
    player.update(
      render,
      heading,
      ridingCar ? 0 : speed,
      dt,
      ridingCar ? 0 : (Locomotion.state[playerEid] ?? 0),
      ridingCar ? 0 : (Locomotion.stateTime[playerEid] ?? 0),
    );
  };

  /** A car system throwing must not kill the frame loop — surface it in the HUD and keep walking. */
  const tickVehicles = (delta: number): void => {
    try {
      vehicles?.update(delta);
    } catch (error) {
      debugError ??= error instanceof Error ? error.message : String(error);
    }
  };
  /** Pausing frees the cursor for the pause menu and drops the photo camera (as F2 and the debugger do). */
  const onPaused = (): void => {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    if (flyEye) {
      setFlyMode(false);
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
      clearMapViewerFog();
      zoneSystem.update();
      citySystem.update();
      if (minutesNow() !== lastMinutes) {
        lastMinutes = minutesNow();
        events.emit('time', { minutes: lastMinutes });
      }
    } else {
      onPaused();
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
    void refreshCollision(); // self-gates on the camera's cell set — a no-op unless the overlay is on and moved
    lastStream = streamStats;

    // While seated the camera trails the CAR (the rider is teleported into the seat every frame — following
    // the ped would judder); on foot it trails the player.
    const focus = seatedCar ? toEngine(seatedCar.position) : playerEngine;
    const target: [number, number, number] = [focus[0], focus[1] + EYE_HEIGHT, focus[2]];
    const [fx, fy, fz] = forwardOf();
    // Photo camera (074/22): a detached eye flying on the ARROW keys, looking where the mouse points.
    if (flyEye) {
      flyEye = flyStep(flyEye, flyKeys, [fx, fy, fz], yaw, FLY_SPEED * dt);
    }
    syncCameraConfig();
    const camera = resolveCamera({
      aspect: canvas.width / Math.max(1, canvas.height),
      bench: benchCamera,
      distance: followDistance,
      flyEye,
      forward: [fx, fy, fz],
      target,
    });
    [cameraEye[0], cameraEye[1], cameraEye[2]] = camera.eye;
    engine.probeCenter = probeCenterOf(probeEnabled, focus);
    engine.probeView = probeViewEnabled;
    // Live tier knob (074/09): the config value drives the target size; the engine rebuilds on change.
    engine.renderScale = config.graphics.renderScale;
    const stats = engine.frame(camera);
    lastStats = stats;
    // B7·b field stall: the CPU breakdown of the frames that actually hitch — a stall must arrive as a NUMBER,
    // not a theory. Quiet on a healthy frame. (The timings are last frame's; the stall is what matters.)
    if (perfLogs && dt * 1000 > SLOW_FRAME_MS) {
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
      triangles: stats.trianglesRecorded,
    });

    if (
      !readySent &&
      ((streamStats.pendingCells === 0 && streamStats.created > 0) || now - bootStarted > WORLD_READY_TIMEOUT_MS)
    ) {
      readySent = true;
      onWorldReady?.();
    }

    // A running soak keeps the HUD up whatever the toggle says — its verdict is READ OFF the HUD.
    const showHud = perfHud || soakStatus !== '';
    if (hud.style.display !== (showHud ? 'block' : 'none')) {
      hud.style.display = showHud ? 'block' : 'none';
    }
    if (!showHud) {
      requestAnimationFrame(loop);

      return; // the HUD string is the only work left this frame — don't build it for a hidden element
    }
    hud.textContent = hudText({
      animMs,
      debugError,
      frames,
      grounded: Velocity.grounded[playerEid],
      gta,
      hour,
      move: input.move(),
      pedMs,
      residency: ledgerBreakdown(engine),
      seated: seatedCar !== null,
      soakStatus,
      stats,
      stream: streamStats,
      velocity: [Velocity.x[playerEid], Velocity.y[playerEid], Velocity.z[playerEid]],
    });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // In-game perf runs (bench `?bench=` + soak `?soak=`) — the runners live in ./engine-perf-runs; this
  // host only wires thin accessors over its loop state (camera override, sampling, teleport, env).
  setupPerfRuns({
    beginSamples: (): void => {
      benchSamples = [];
    },
    engine,
    fs,
    getStream: (): null | StreamStats => lastStream,
    getVehicles: (): EngineVehicles | null => vehicles,
    params,
    setBenchCamera: (camera): void => {
      benchCamera = camera;
    },
    setHour: (value): void => {
      hour = value;
    },
    setSoakStatus: (text): void => {
      soakStatus = `\n${text}`;
    },
    settleTimeoutMs: WORLD_READY_TIMEOUT_MS,
    setWeather: (value): void => {
      weatherTransition.begin(value, 0);
    },
    slowFrameMs: SLOW_FRAME_MS,
    takeSamples: (): LegSample[] => {
      const samples = benchSamples ?? [];
      benchSamples = null;
      benchCamera = null;

      return samples;
    },
    teleportPlayer: (anchor): void => {
      physics.teleport(RigidBody.handle[playerEid], [anchor[0], anchor[1], anchor[2]]);
      Transform.x[playerEid] = anchor[0];
      Transform.y[playerEid] = anchor[1];
      Transform.z[playerEid] = anchor[2];
    },
    toEngine,
  });
}

/**
 * Roll the occupied car 180° about its OWN forward axis and lift it 1.5 m (the debugger's "flip vehicle" —
 * prod's implementation, with the quaternion algebra written out so the host keeps its three-free math).
 */
function flipActiveVehicle(physics: PhysicsWorld, active: null | { body: number }): void {
  if (!active) {
    return;
  }
  const { position, quaternion } = physics.readBody(active.body);
  const [qx, qy, qz, qw] = quaternion;
  // Car forward = (0, 1, 0) rotated by q (native Z-up), via q·v·q⁻¹ expanded.
  const fx = 2 * (qx * qy - qw * qz);
  const fy = 1 - 2 * (qx * qx + qz * qz);
  const fz = 2 * (qy * qz + qw * qx);
  // A π turn about a unit axis is the pure quaternion (axis, 0); compose it with the current orientation.
  const length = Math.hypot(fx, fy, fz) || 1;
  const [ax, ay, az] = [fx / length, fy / length, fz / length];
  physics.holdBody(
    active.body,
    [position[0], position[1], position[2] + 1.5],
    [
      ay * qz - az * qy + qw * ax,
      az * qx - ax * qz + qw * ay,
      ax * qy - ay * qx + qw * az,
      -(ax * qx + ay * qy + az * qz),
    ],
  );
}

/** The debugger's Perf rows from the host's own numbers (three's renderer.info counters have no twin here —
 *  plan 074/22 phase 3.3 replaces the panel content with the engine ledger). */
function frameStats(frames: readonly number[], stats: null | ReturnType<Engine['frame']>): null | PerfStats {
  if (frames.length === 0) {
    return null;
  }
  const sorted = [...frames].sort((a, b) => a - b);
  const avgMs = frames.reduce((sum, value) => sum + value, 0) / frames.length;

  return {
    avgMs,
    drawCalls: stats?.drawsRecorded ?? 0,
    fps: 1000 / Math.max(avgMs, 0.001),
    geometries: 0,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    programs: 0,
    textures: 0,
    triangles: stats?.trianglesRecorded ?? 0,
  };
}

/** The on-screen HUD text (own engine). Extracted from the frame loop so the loop stays readable — it is one
 *  string build with a dozen conditional fields. Shown while the Perf-screen toggle is on (074/22). */
function hudText(frame: {
  animMs: number;
  debugError: null | string;
  frames: readonly number[];
  grounded: number;
  gta: readonly [number, number, number];
  hour: number;
  move: { x: number; y: number };
  pedMs: number;
  residency: string;
  seated: boolean;
  soakStatus: string;
  stats: ReturnType<Engine['frame']>;
  stream: StreamStats;
  velocity: readonly [number, number, number];
}): string {
  const { gta, stats, stream, velocity } = frame;
  const avg = frame.frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frame.frames.length);
  const ms = (value: number, absent = 'n/a'): string => (value > 0 ? value.toFixed(2) : absent);
  const clock = `${String(Math.floor(frame.hour)).padStart(2, '0')}:${String(Math.floor((frame.hour % 1) * 60)).padStart(2, '0')}`;

  return (
    `OWN ENGINE (074/10 B3) — walk: WASD, run: Shift, jump: Space, click = capture mouse (Esc frees)\n` +
    `        F2 = debugger · K+M = photo camera (ARROWS move, PgUp/PgDn lift, mouse looks)\n` +
    `frame   ${avg.toFixed(2)} ms (${(1000 / Math.max(avg, 0.001)).toFixed(0)} fps)\n` +
    `submit  ${stats.submitMs.toFixed(2)} ms · GPU ${ms(stats.gpuPassMs)} ms · post ${ms(stats.gpuPostMs)} ms · probe ${ms(stats.gpuProbeMs, 'off')} ms · draws ${stats.drawsRecorded}\n` +
    `stream  ${stream.loadedCells} cells, ${stream.pendingCells} pending, late ${stream.lateCreates} · ` +
    `residency ${(stats.residencyBytes / 1048576).toFixed(0)} MB (${frame.residency})\n` +
    `GTA     ${gta[0].toFixed(1)}, ${gta[1].toFixed(1)}, ${gta[2].toFixed(1)} · ${clock}\n` +
    `debug   vel ${velocity[0].toFixed(2)},${velocity[1].toFixed(2)},${velocity[2].toFixed(2)} ` +
    `grounded ${frame.grounded} ${frame.seated ? '· SEATED ' : ''}` +
    `move ${JSON.stringify(frame.move)} · ped sampler ${frame.pedMs.toFixed(2)} ms · anim ${frame.animMs.toFixed(2)} ms` +
    frame.soakStatus +
    (frame.debugError ? `\nFIXED-STEP ERROR: ${frame.debugError}` : '') +
    (hostState.paused ? '\nPAUSED' : '')
  );
}

/** Water (074/06 row 12): prefer the BAKED tessellated mesh (`water.bin` — per-vertex shore field →
 *  displacement/foam/shallow); fall back to the flat runtime build (constant deep field) for paks
 *  converted before the water bake. Textures: particle.txd waterclear256 (ripple) + waterwake (foam). */
async function installWater(
  engine: Engine,
  fs: AssetFileSystem,
  water: undefined | { file: string; indexCount: number; vertexCount: number },
  source: PakSource,
): Promise<void> {
  const ripple = loadWaterTexture(fs, 'waterclear256');
  const foam = loadWaterTexture(fs, 'waterwake');
  if (water) {
    // The baked water.bin rides the SAME source as the pak — the picked folder in folder mode, the URL base
    // otherwise — so the map viewer and the game agree on which world they render.
    const bytes =
      typeof source === 'string'
        ? await fetch(`${source}/${water.file}`).then((response) => (response.ok ? response.arrayBuffer() : null))
        : await source.open(water.file).then((blob) => (blob ? blob.arrayBuffer() : null));
    if (bytes) {
      const bin = new Uint8Array(bytes);
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
