import type { StreamStats } from '@opensa/engine';
import type { TimecycSource } from '@opensa/renderware';

import { CELL_SIZE } from '@opensa/cell-weld/cell-size';
import { Engine, FrameSpans, frameSpans, pakTraffic, setupStreaming } from '@opensa/engine';
import {
  createEngineEnvironmentDriver,
  type EngineEnvironmentDriver,
} from '@opensa/game/adapters/engine-environment-driver';
import { describeTimecycSource, resolveTimecycSourceAsync } from '@opensa/renderware';

import type { GtaGround } from '../map/coords';
import type { CursorPick, MapPose, MapProjection } from '../map/map-camera';
import type { HistoryStats } from '../ops/history';
/**
 * The dispatch host: boot the engine on a canvas, stream the city, run the frame loop, and translate pointer
 * input into camera steps and selections. Plain DOM and engine — React never enters the loop, it only receives
 * a readout a few times a second and hands the board back in through a getter.
 *
 * What it deliberately does NOT use: the game layer's ECS, physics, peds, vehicles or weather simulation. A
 * dispatch map needs the renderer and the streamer, and nothing else — the one game-layer import is the
 * shared config→Environment driver, so the map is lit exactly as the game lights it.
 */
import type { Operations, Selection } from '../ops/types';

import { Beacons } from '../map/beacons';
import { bindGestures } from '../map/gestures';
import { CAMERA_FAR, groundPoint, MAP_YAW, MapCamera } from '../map/map-camera';
import { SymbologyLayer } from '../map/overlay-2d';
import { ScreenProjector } from '../map/projection';
import { buildDemoCity, DEMO_REACH } from './demo-city';
import { DISTRICTS } from './districts';
import { createErrorLog } from './error-log';
import { type FrameCpuSample, FrameInventory, type InventoryReport, UNNAMED_DISTRICT } from './inventory';
import { DEFAULT_SRC, resolvePakBase } from './pak-source';
import { installWater } from './water';
import { type DistrictLookup, loadDistricts, NO_DISTRICTS } from './zones';

export interface BootOptions {
  readonly canvas: HTMLCanvasElement;
  /** How old each unit's last fix is, ms (201/8-02) — absent for a host with no board, whose markers are
   *  then all drawn as fresh. */
  readonly fixAges?: () => ReadonlyMap<string, number>;
  readonly onClick: (click: MapClick) => void;
  /** Right-click: "put a call here". `district` is what the world calls that point (201/5-03) — resolved
   *  here rather than in the board, because the baked table is the map's, and null when the world has none. */
  readonly onGround: (at: GtaGround, district: null | string) => void;
  readonly onReadout: (readout: DispatchReadout) => void;
  /** Live read of the board — called once a frame, so the loop never holds a stale snapshot. */
  readonly ops: () => Operations;
  readonly overlay: HTMLCanvasElement;
  readonly selection: () => Selection;
  /** The time axis's cost and window (201/8-01) — read only by `?inventory=1`, so it is optional and a host
   *  embedding the map without a board simply does not pass it. */
  readonly trackStats?: () => HistoryStats;
  /** Each unit's current leg as GTA `x, y` pairs (201/8-04) — absent for a host embedding the map with no
   *  board, which then simply draws no trails. */
  readonly trails?: () => ReadonlyMap<string, Float32Array>;
}

export interface DispatchHandle {
  readonly camera: MapCamera;
  dispose(): void;
  /**
   * The 201/1-01 before-table, or null when `?inventory=1` was not set. Reading it does not stop or reset
   * the collection — the window keeps growing, so a later read is a longer sample of the same run.
   */
  inventory(): InventoryReport | null;
  /** Frame a GTA point at a sensible working height — what "locate" does in the panels. */
  locate(at: GtaGround): void;
  setHour(hour: number): void;
  /** Perspective or the plan view (201/7-01). The pose in the readout says which is live. */
  setProjection(projection: MapProjection): void;
  /** Fly to one of the three zoom levels over the point already under the view (201/7-02). */
  setZoomLevel(level: ZoomLevel): void;
}

export interface DispatchReadout {
  readonly buildTime: string;
  readonly cellsTotal: number;
  readonly cellsVisible: number;
  readonly draws: number;
  readonly fps: number;
  readonly hour: number;
  readonly pending: number;
  readonly pose: MapPose;
  readonly residencyMb: number;
}

/** What a click resolved to — the app turns it into a {@link Selection}. */
export type MapClick =
  | {
      readonly at: GtaGround;
      /** The named district the point falls in (201/5-03), or null on a world with no `info.zon`. */
      readonly district: null | string;
      readonly kind: 'world';
      readonly model: string;
      readonly txd: string;
    }
  | { readonly at: GtaGround; readonly kind: 'ground' }
  | { readonly id: string; readonly kind: 'incident' | 'unit' };

/** Opening view: high over central Los Santos, north up, steeply tilted so the city still reads as 3D. */
const OPENING_POSE: MapPose = {
  at: [1700, -1500],
  height: 900,
  pitch: -1.15,
  projection: 'perspective',
  yaw: MAP_YAW,
};
/**
 * What "locate" frames: one render cell of ground around the thing being looked at, which is the block
 * level (see {@link zoomSpan}) and the tightest of the three. A unit or a call is a point, so the question
 * is how much of its surroundings an operator needs to place it, and one cell is the smallest unit of world
 * this pak is built out of.
 */
const LOCATE_SPAN = CELL_SIZE;
/** Readout pushes per second. The loop must not re-render React. */
const READOUT_HZ = 4;
/** A world with nothing to stream — the demo's synthetic grid is resident from the start. */
const IDLE_STREAM: StreamStats = {
  blobMs: 0,
  created: 0,
  evicted: 0,
  lateCreates: 0,
  loadedCells: 0,
  pendingCells: 0,
  uploadMs: 0,
  worstBlobMs: 0,
  worstCreateMs: 0,
};

/** Streaming rings. Wider than the game's, because a map view looks at the city rather than at a street. */
const DEFAULT_HD_RADIUS = 450;
const DEFAULT_LOD_RADIUS = 2200;

/**
 * A world the host can drive, however it was produced. `follow` is called once a frame with the ground point
 * the view sits over and answers how many cells are still in flight — the streamed world moves its rings, the
 * demo world has nothing to move.
 */
interface DispatchWorld {
  /** What the world's places are called (201/5-03) — baked beside the pak, empty on a world that ships no
   *  `info.zon` and on the synthetic demo. */
  districts: DistrictLookup;
  /** Called once a frame with the ground point the view sits over. Returns the ENGINE's own streaming
   *  numbers — blob-handler and upload milliseconds, creates, evictions — which the console used to throw
   *  away, keeping only `pendingCells`. They are the between-frame half no in-loop timer can see. */
  follow: (focus: readonly [number, number, number]) => StreamStats;
  /** Where `data/` sits, for timecyc. Empty when there is no game dir (the demo). */
  gameDir: string;
  /** What the status bar shows as the world's provenance. */
  label: string;
  /** How far from the view's focus this world actually has content — the LOD ring for a streamed world,
   *  its own extent for the demo. The camera derives both of its bounds from it (201/7-02). */
  readonly reach: number;
}

export async function bootDispatch(options: BootOptions): Promise<DispatchHandle> {
  const { canvas, overlay } = options;
  const params = dispatchParams();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = (): void => {
    canvas.width = Math.max(2, Math.floor(canvas.clientWidth * dpr));
    canvas.height = Math.max(2, Math.floor(canvas.clientHeight * dpr));
    overlay.width = canvas.width;
    overlay.height = canvas.height;
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  const engine = new Engine();
  await engine.init(canvas);
  // `?scale=` — the same manual knob `apps/web` has, and the only one that moves the `target` category:
  // 36.54 MB of the 2026-08-12 capture's 74.9 MB is scene + bloom targets, which scale with the square of
  // this number. Manual, per the refusal in performance/deferred-optimizations/render-scale-tier.md — the
  // console picks no tier for anybody. The report records it, so a capture says what it was drawn at.
  engine.renderScale = Math.min(1, Math.max(0.5, numberParam(params, 'scale', 1)));
  // Picking must be armed BEFORE the first cell loads — the capability only takes effect on load, and it is
  // what retains the per-placement mapper a click resolves against. It costs memory on a full map (read back
  // as `engine.cells.pickingBytes`, and reported by `?inventory=1`); this app is a map inspector with a
  // dispatch board on top, so it pays that cost by design and says so rather than borrowing a debug switch.
  engine.cells.picking = true;

  // `?demo=1` skips the pak entirely and builds a synthetic block grid, so the console can be driven on a
  // machine with no built game. Everything above the world — camera, beacons, symbology, picking — is the
  // same code path either way; only the geometry's provenance differs.
  const world = params.get('demo') === '1' ? demoWorld(engine) : await streamedWorld(engine, params);
  const environment = await buildEnvironment(engine, world.gameDir, params);
  let hour = numberParam(params, 'hour', 10);
  const applyHour = (next: number): void => {
    hour = next;
    environment.apply(next);
    pushFogOut(engine, params);
  };
  applyHour(hour);

  // Installed before anything else this boot does, because the failures worth catching happen during it.
  const errorLog = createErrorLog();
  const camera = new MapCamera(poseFromQuery(params));
  // The bounds are the world's, not the camera's: how far it may zoom out and how shallow it may tilt both
  // come from how much world there is around the focus (201/7-02).
  camera.setStreamedReach(world.reach);
  const beacons = new Beacons(engine);
  const symbology = new SymbologyLayer();
  const projector = new ScreenProjector();
  const context = overlay.getContext('2d');
  if (!context) {
    throw new Error('overlay canvas has no 2d context');
  }

  /** The symbology block of the report: what the last frame drew, plus how the beacon buffers held up. */
  const symbologyCounts = (): InventoryReport['symbology'] => {
    const ops = options.ops();
    const beaconStats = beacons.stats();

    return {
      beaconCapacity: beaconStats.capacity,
      beaconGrowths: beaconStats.grownSets,
      incidents: ops.incidents.length,
      units: ops.units.length,
      ...symbology.counted(),
    };
  };

  const unbind = bindInput({
    camera,
    canvas,
    districts: world.districts,
    engine,
    onZoomLevel: (level) => camera.flyTo(camera.positionGta(), zoomSpan(level, camera.positionGta(), world)),
    options,
    symbology,
  });
  // 201/1-01. Off unless asked for: draining the span recorder is cheap, but a mode that measures by default
  // is a mode nobody can trust to have measured nothing.
  const inventory = params.get('inventory') === '1' ? new FrameInventory() : null;
  // A SECOND span recorder, deliberately not the shared `frameSpans`. That one is for work between frames,
  // and a span opened inside the loop body would be subtracted from `dt` twice
  // (restrictions/architecture.md). Nobody subtracts this one from anything: it is the CPU-side proxy for a
  // device with no `timestamp-query`, and it only runs when the mode is on.
  const loopCpu = new FrameSpans();
  const time = <T>(name: string, run: () => T): T => (inventory ? loopCpu.measure(name, run) : run());
  let bodyMs = 0;
  const frames: number[] = [];
  let disposed = false;
  let lastReadout = 0;
  let previous = performance.now();

  const loop = (): void => {
    if (disposed) {
      return;
    }
    const now = performance.now();
    const dt = now - previous;
    frames.push(dt);
    previous = now;
    if (frames.length > 60) {
      frames.shift();
    }
    // Drained BEFORE this frame opens a segment of its own, so what comes out is the PREVIOUS body — the
    // work that actually ran inside the `dt` interval about to be reported.
    const cpu: FrameCpuSample = { bodyMs, segments: loopCpu.drain() };

    const ops = options.ops();
    const aspect = canvas.width / Math.max(1, canvas.height);
    // Before the state is read, so the streamer follows where the flight has REACHED this frame rather
    // than where it was last frame.
    camera.advance(dt);
    const state = camera.state(aspect);
    time('board', () => beacons.update(ops, options.selection(), options.trails?.()));
    // Rings follow the ground point the view is over, never the eye: a camera a kilometre up sits outside
    // every ring and would stream nothing at all.
    const stream = time('stream', () => world.follow([state.target[0], state.target[1], state.target[2]]));
    const stats = time('engine-frame', () => engine.frame(state));
    // Drained every frame the mode is on, so a span never carries into the next frame's total. Plan 091's
    // rule: the frame that DRAINS is the frame that paid, because the work ran in the gap before it.
    if (inventory) {
      inventory.sample(dt, stats, frameSpans.drain(), cpu, stream);
    }

    time('overlay-2d', () => {
      projector.update(state, overlay.clientWidth, overlay.clientHeight);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
      symbology.render(
        context,
        projector,
        ops,
        options.selection(),
        { height: overlay.clientHeight, width: overlay.clientWidth },
        options.fixAges?.(),
      );
    });

    if (now - lastReadout > 1000 / READOUT_HZ) {
      lastReadout = now;
      const average = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
      time('readout', () =>
        options.onReadout({
          buildTime: world.label,
          cellsTotal: stats.cellsTotal,
          cellsVisible: stats.cellsVisible,
          draws: stats.drawsRecorded,
          fps: Math.round(1000 / Math.max(1, average)),
          hour,
          pending: stream.pendingCells,
          pose: camera.pose(),
          residencyMb: stats.residencyBytes / (1024 * 1024),
        }),
      );
    }
    bodyMs = performance.now() - now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    camera,
    dispose(): void {
      disposed = true;
      unbind();
      errorLog.dispose();
      beacons.dispose();
    },
    inventory(): InventoryReport | null {
      if (inventory === null) {
        return null;
      }
      const pose = camera.pose();

      return inventory.report({
        build: world.label,
        byCategory: engine.ledger(),
        bytes: { byKind: pakTraffic.report(), requests: pakTraffic.requests, totalBytes: pakTraffic.totalBytes },
        camera: { at: pose.at, height: pose.height, projection: pose.projection },
        device: engine.deviceReport,
        district: params.get('district') ?? UNNAMED_DISTRICT,
        errors: errorLog.entries(),
        hasTimestamps: !engine.deviceReport.missing.includes('timestamp-query'),
        pickingBytes: engine.cells.pickingBytes,
        surface: {
          cssHeight: canvas.clientHeight,
          cssWidth: canvas.clientWidth,
          deviceHeight: canvas.height,
          deviceWidth: canvas.width,
          dpr,
          renderScale: engine.renderScale,
        },
        symbology: symbologyCounts(),
        tracks: options.trackStats?.() ?? null,
      });
    },
    locate(at: GtaGround): void {
      camera.flyTo(at, LOCATE_SPAN);
    },
    setHour: applyHour,
    setProjection(projection: MapProjection): void {
      camera.setProjection(projection);
    },
    setZoomLevel(level: ZoomLevel): void {
      camera.flyTo(camera.positionGta(), zoomSpan(level, camera.positionGta(), world));
    },
  };
}

/**
 * The console's query parameters.
 *
 * Normally the address bar, but a host that does not OWN its URL can set `window.__opensaDispatch` to the
 * same string instead. That is not hypothetical: a page opened from Android's downloads provider
 * (`content://…`) or from a `file://` path has an opaque origin where `history.replaceState` throws, so a
 * wrapper cannot put `?demo=1` in the URL — and the console would default to streaming a build that is not
 * there. Found in the field, on a phone, after the GPU side had finally started working.
 */
export function dispatchParams(): URLSearchParams {
  const override = (window as { __opensaDispatch?: string }).__opensaDispatch;

  return new URLSearchParams(override ?? window.location.search);
}
/**
 * Wire the map's gestures to the camera and to selection. The gesture layer decides WHAT happened (tap, pan,
 * orbit, pinch, long press); this decides what it MEANS: a tap selects, a long press opens a call there.
 */
function bindInput(input: {
  camera: MapCamera;
  canvas: HTMLCanvasElement;
  districts: DistrictLookup;
  engine: Engine;
  onZoomLevel: (level: ZoomLevel) => void;
  options: BootOptions;
  symbology: SymbologyLayer;
}): () => void {
  const { camera, canvas, districts, engine, onZoomLevel, options, symbology } = input;

  /** The world ray under a canvas-relative CSS position. */
  const rayAt = (x: number, y: number): CursorPick => {
    const rect = canvas.getBoundingClientRect();
    const ndc: [number, number] = [(x / rect.width) * 2 - 1, 1 - (y / rect.height) * 2];

    return camera.rayAt(ndc, rect.width / Math.max(1, rect.height));
  };

  const unbindGestures = bindGestures(canvas, {
    dolly: (notch) => camera.dolly(notch),
    longPress: (x, y) => {
      const ground = groundPoint(rayAt(x, y));
      if (ground) {
        options.onGround(ground, districts.nameAt(ground));
      }
    },
    orbit: (dx, dy) => camera.orbit(dx, dy),
    pan: (delta) => camera.pan(delta),
    // Symbology first — the operator aimed at a chip; then whatever the world puts under the cursor.
    tap: (x, y) => {
      const symbol = symbology.hitTest(x, y);
      if (symbol) {
        options.onClick(symbol);

        return;
      }
      const ray = rayAt(x, y);
      const hit = engine.cells.pick(ray.origin, ray.direction);
      options.onClick(
        hit
          ? {
              at: [hit.position[0], -hit.position[2]],
              district: districts.nameAt([hit.position[0], -hit.position[2]]),
              kind: 'world',
              model: hit.model,
              txd: hit.txd,
            }
          : { at: groundPoint(ray) ?? [0, 0], kind: 'ground' },
      );
    },
    zoomBy: (factor) => camera.zoomBy(factor),
  });

  // The zoom-level keys (201/7-02). The console's full key map and its remapping are 7/06's step; these
  // three are the half of THIS step that a level rule is useless without, and they live here rather than in
  // the React tree because the map is not React's and a key must work wherever the focus happens to be.
  const onKeyDown = (event: KeyboardEvent): void => {
    const level = LEVEL_KEYS[event.key];
    if (level === undefined || event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) {
      return;
    }
    event.preventDefault();
    onZoomLevel(level);
  };
  window.addEventListener('keydown', onKeyDown);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    unbindGestures();
  };
}

/** Widest to tightest, left to right on the row — the order the levels themselves are in. */
const LEVEL_KEYS: Readonly<Record<string, undefined | ZoomLevel>> = { 1: 'city', 2: 'district', 3: 'block' };

/**
 * The three zoom levels an operator jumps between (201/7-02), and where each one's SPAN comes from.
 *
 * None of the three is a number somebody liked: each is a thing the world is actually made of, so the same
 * key means the same thing on a total conversion that has never heard of Los Santos.
 *
 * | Level | The span it frames | Read from |
 * | --- | --- | --- |
 * | `block` | one render cell | `CELL_SIZE` — the grid the pak is welded and streamed on |
 * | `district` | the named district under the view | the baked zone box (`districts.json`, 201/5-03) |
 * | `city` | everything the world has around the focus | the world's own reach: the LOD ring, or the demo's extent |
 *
 * **The fallback is derived too.** A world with no zone table has no district box to frame, so the middle
 * level becomes the geometric mean of the other two — zoom levels are logarithmic by nature, so the midpoint
 * of a zoom range is the geometric one, and a level that is missing should still land between its
 * neighbours rather than on top of one.
 */
export type ZoomLevel = 'block' | 'city' | 'district';

export function zoomSpan(
  level: ZoomLevel,
  at: GtaGround,
  world: { readonly districts: DistrictLookup; readonly reach: number },
): number {
  const city = world.reach * 2;
  if (level === 'city') {
    return city;
  }
  if (level === 'block') {
    return CELL_SIZE;
  }
  const box = world.districts.boxAt(at);

  return box === null ? Math.sqrt(CELL_SIZE * city) : Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]);
}

/** The game's own timecyc when the build ships one, so the map is lit as the game lights it. */
async function buildEnvironment(
  engine: Engine,
  gameDir: string,
  params: URLSearchParams,
): Promise<EngineEnvironmentDriver> {
  const timecyc = await readTimecyc(gameDir);
  // Which of the three names won is otherwise unobservable — a shadowed table fails nothing (104/02).
  // eslint-disable-next-line no-console -- boot report, one line
  console.log(`[timecyc] ${describeTimecycSource(timecyc)}`);

  return createEngineEnvironmentDriver(engine.environment, {
    ...(timecyc ? { timecyc: { text: timecyc.text } } : {}),
    // A map camera hundreds of units up measures radial distances a street-level mood was never authored for.
    fogScale: numberParam(params, 'fogscale', 2.5),
    weather: numberParam(params, 'weather', 0),
  });
}

/** `?demo=1`: a synthetic block grid, resident from the start. */
function demoWorld(engine: Engine): DispatchWorld {
  const draws = buildDemoCity(engine);
  // eslint-disable-next-line no-console -- the boot record: a demo run must never be mistaken for a real one
  console.log(`[dispatch] DEMO world — synthetic blocks, ${draws} recorded draws. No pak, no model names.`);

  // A synthetic block grid is nowhere, so it has no district names and must not pretend to: the console
  // falls back to its landmark table, which is what a demo of stock Los Santos wants anyway.
  return {
    districts: NO_DISTRICTS,
    follow: () => IDLE_STREAM,
    gameDir: '',
    label: 'demo (synthetic)',
    reach: DEMO_REACH,
  };
}

/** A key pressed into a field is text, not a command — the console has a time slider and checkboxes. */
function isTyping(target: EventTarget | null): boolean {
  const element = target as null | { isContentEditable?: boolean; tagName?: string };

  return (
    element?.isContentEditable === true ||
    element?.tagName === 'INPUT' ||
    element?.tagName === 'SELECT' ||
    element?.tagName === 'TEXTAREA'
  );
}

function numberParam(params: URLSearchParams, name: string, fallback: number): number {
  const raw = Number(params.get(name) ?? Number.NaN);

  return Number.isFinite(raw) ? raw : fallback;
}

/**
 * The opening pose: `?at=` if given, else the point the named `?district=` opens over, else the default.
 *
 * The district step matters more than it looks. A capture is labelled by `?district=` and aimed by `?at=`,
 * and until they came from one table a run could be labelled one district while looking at another — with
 * nothing on screen or in the report saying so.
 */
function poseFromQuery(params: URLSearchParams): MapPose {
  const at = (params.get('at') ?? '').split(',').map(Number);
  const district = DISTRICTS[params.get('district') ?? ''];

  return {
    at: at.length === 2 && at.every(Number.isFinite) ? [at[0], at[1]] : (district?.at ?? OPENING_POSE.at),
    height: numberParam(params, 'h', OPENING_POSE.height),
    pitch: (numberParam(params, 'pitch', (OPENING_POSE.pitch * 180) / Math.PI) * Math.PI) / 180,
    projection: params.get('proj') === 'ortho' ? 'ortho' : OPENING_POSE.projection,
    yaw: (numberParam(params, 'yaw', (OPENING_POSE.yaw * 180) / Math.PI) * Math.PI) / 180,
  };
}

/**
 * Fog is pushed to the far plane, and this is NOT a look preference: the engine culls a cell that lies
 * entirely past `fogCutDistance` (2400 by default), so from the kilometre-high eye a city view needs, every
 * cell would be culled and the map would come back empty. `?fog=1` restores the game's own fog for looking
 * at fog. Re-applied after every hour change, because the environment driver rewrites both distances.
 */
function pushFogOut(engine: Engine, params: URLSearchParams): void {
  if (params.get('fog') === '1') {
    return;
  }
  engine.environment.fogStartDistance = CAMERA_FAR * 0.92;
  engine.environment.fogCutDistance = CAMERA_FAR;
}

async function readTimecyc(gameDir: string): Promise<null | TimecycSource> {
  if (gameDir === '') {
    return null;
  }

  // The candidate order is `TIMECYC_SOURCES` and nowhere else (plan 104/01): a second copy of it here is a
  // console lit by a different table than the game it is a map of, and nothing would say so.
  return resolveTimecycSourceAsync(async (path) => {
    try {
      const response = await fetch(`${gameDir}/${path}`);

      return response.ok ? await response.text() : null;
    } catch {
      // A build served without its `data/` folder simply goes parametric — not an error worth failing on.
      return null;
    }
  });
}

/** The real thing: a built game, streamed from its pak. */
async function streamedWorld(engine: Engine, params: URLSearchParams): Promise<DispatchWorld> {
  const source = await resolvePakBase(params.get('src') ?? DEFAULT_SRC);
  const setup = await setupStreaming(engine, source.base, {
    hdRadius: numberParam(params, 'hd', DEFAULT_HD_RADIUS),
    lodRadius: numberParam(params, 'lod', DEFAULT_LOD_RADIUS),
  });
  await installWater(engine, source.base, setup.water);

  return {
    districts: await loadDistricts(source.base, setup.districts),
    follow: (focus) => setup.driver.update(focus),
    gameDir: source.gameDir,
    label: setup.buildTime ?? 'unknown',
    reach: numberParam(params, 'lod', DEFAULT_LOD_RADIUS),
  };
}
