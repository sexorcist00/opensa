import type { ResidencyView, StreamStats } from '@opensa/engine';
import type { TimecycSource } from '@opensa/renderware';

import { CELL_SIZE } from '@opensa/cell-weld/cell-size';
import { Engine, FrameSpans, frameSpans, pakTraffic, setupStreaming } from '@opensa/engine';
import {
  createEngineEnvironmentDriver,
  type EngineEnvironmentDriver,
} from '@opensa/game/adapters/engine-environment-driver';
import { describeTimecycSource, resolveTimecycSourceAsync } from '@opensa/renderware';

import type { GtaGround } from '../map/coords';
import type { HeldCommand, KeyBindings, PressedCommand } from '../map/keymap';
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
import { engineToGta, gtaToEngine } from '../map/coords';
import { bindGestures } from '../map/gestures';
import { bindKeys, type KeyboardInput } from '../map/keys';
import {
  CAMERA_FAR,
  groundPoint,
  KEY_PAN_PER_SECOND,
  KEY_TILT_PER_SECOND,
  KEY_TURN_PER_SECOND,
  KEY_ZOOM_PER_SECOND,
  MAP_YAW,
  MapCamera,
} from '../map/map-camera';
import { mountMinimap } from '../map/minimap';
import { SymbologyLayer } from '../map/overlay-2d';
import { ScreenProjector } from '../map/projection';
import { drawSketches, type MapTool, type Measurement, SketchStore } from '../map/sketch';
import { readView, type SharedView, viewOfPose } from '../map/view-link';
import { composeImage } from './capture';
import { buildDemoCity, DEMO_EXTENT, DEMO_REACH } from './demo-city';
import { DISTRICTS } from './districts';
import { createErrorLog } from './error-log';
import { type FrameCpuSample, FrameInventory, type InventoryReport, UNNAMED_DISTRICT } from './inventory';
import { DEFAULT_SRC, resolvePakBase } from './pak-source';
import { installWater } from './water';
import { type DistrictLookup, loadDistricts, NO_DISTRICTS, type SearchedPlace } from './zones';

export interface BootOptions {
  readonly canvas: HTMLCanvasElement;
  /** How old each unit's last fix is, ms (201/8-02) — absent for a host with no board, whose markers are
   *  then all drawn as fresh. */
  readonly fixAges?: () => ReadonlyMap<string, number>;
  /** The radar's own canvas (201/7-04). Absent for a host that does not want one — an embedded map, or
   *  plan mode, which draws its own board and has no room for an inset. */
  readonly minimap?: HTMLCanvasElement;
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
   * A PNG of the situation: the world and the symbology drawn over it, composed into one image (201/7-07).
   * `null` when there is no world canvas to read — plan mode answers with its own single canvas instead.
   *
   * Resolves on the NEXT frame rather than immediately, and that is not an implementation detail: the two
   * canvases are only in step at the end of a frame, and a naive `toDataURL` of the WebGPU one alone
   * captures a city with no units on it.
   */
  exportImage(): Promise<Blob | null>;
  /** Ease the heading back to north (201/7-06's compass, and the `n` key). */
  faceNorth(): void;
  /**
   * Put every active unit and call in frame at once (201/7-03). A board with nothing on it is left alone
   * rather than flown to the origin.
   */
  fitBoard(): void;
  /** Ride a unit by id; `null` stops. An id the board does not have is the same as stopping. */
  follow(id: null | string): void;
  /** Fly to a searched place, framing its whole box. */
  goToPlace(place: SearchedPlace): void;
  /**
   * The 201/1-01 before-table, or null when `?inventory=1` was not set. Reading it does not stop or reset
   * the collection — the window keeps growing, so a later read is a longer sample of the same run.
   */
  inventory(): InventoryReport | null;
  /** Frame a GTA point at a sensible working height — what "locate" does in the panels. */
  locate(at: GtaGround): void;
  /** The view as it is right now — what a bookmark stores. */
  pose(): MapPose;
  /** Fly back to a saved view: the rig (tilt, heading, projection) is taken at once, the ground is flown. */
  recallView(pose: MapPose): void;
  /** Places whose name matches, from the world's own baked district table (201/5-03's data). */
  searchPlaces(query: string): readonly SearchedPlace[];
  /** Swap in a rebound key map, live — the sheet rebinds while the console is running. */
  setBindings(bindings: KeyBindings): void;
  setHour(hour: number): void;
  /** Perspective or the plan view (201/7-01). The pose in the readout says which is live. */
  setProjection(projection: MapProjection): void;
  /** What a tap on the map does (201/7-05): select, or add a point to a ruler, cordon or circle. */
  setTool(tool: MapTool): void;
  /** Fly to one of the three zoom levels over the point already under the view (201/7-02). */
  setZoomLevel(level: ZoomLevel): void;
  /** Everything a shared link carries about the world half of the view (201/7-07). */
  sharedView(): SharedView;
  /** Drop every shape this session drew. */
  sketchClear(): void;
  /** Close the shape being drawn. A shape with too few points is left alone rather than half-closed. */
  sketchFinish(): void;
  /** Step back one tap, then one whole shape. */
  sketchUndo(): void;
  /** Tilt by this many radians — the on-screen control's step, the same bound as every other tilt. */
  tiltBy(radians: number): void;
  /** Turn the view by this many radians, eased like the compass rather than snapped. */
  turnBy(radians: number): void;
  /** Zoom by whole steps: positive is in, negative is out, and each one is flown rather than jumped. */
  zoomBySteps(steps: number): void;
}

export interface DispatchReadout {
  readonly buildTime: string;
  readonly cellsTotal: number;
  readonly cellsVisible: number;
  readonly draws: number;
  /** Whether the view is riding a unit (201/7-03) — the chrome shows it, and it is state rather than an
   *  event because the UI mounts after the boot that started it. */
  readonly following: boolean;
  readonly fps: number;
  readonly hour: number;
  /** What the sketch in progress (or the last one finished) measures — null until one is drawn (201/7-05). */
  readonly measurement: Measurement | null;
  /** Labels the decluttering could not place this frame (201/3-03). The operator is told rather than left
   *  to believe the map is complete — the SYMBOLS are all there, only the names are missing. */
  readonly namesHidden: number;
  readonly pending: number;
  readonly pose: MapPose;
  readonly residencyMb: number;
  /** What a tap on the map currently does. `none` is selection, the console's normal behaviour. */
  readonly tool: MapTool;
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

/**
 * What one press of the on-screen zoom control changes the framed span by. Halving and doubling is what a
 * map's `+`/`−` has meant since the first tile server, and it is one notch of the three zoom LEVELS' own
 * spacing rather than a number picked to feel right.
 */
const ZOOM_STEP = 2;
/** Streaming rings. Wider than the game's, because a map view looks at the city rather than at a street. */
const DEFAULT_HD_RADIUS = 450;
const DEFAULT_LOD_RADIUS = 2200;

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

/**
 * A world the host can drive, however it was produced. `follow` is called once a frame with the ground point
 * the view sits over and answers how many cells are still in flight — the streamed world moves its rings, the
 * demo world has nothing to move.
 */
interface DispatchWorld {
  /** What the world's places are called (201/5-03) — baked beside the pak, empty on a world that ships no
   *  `info.zon` and on the synthetic demo. */
  districts: DistrictLookup;
  /** Where the world IS and how big it is, GTA — the radar's scale (201/7-04). Taken from the pak's own
   *  cell extent, so a district-sized pak gets a district-sized dial rather than an empty San Andreas. */
  readonly extent: { readonly centre: GtaGround; readonly radius: number };
  /** Called once a frame with the ground point the view sits over, and with the view that is about to be
   *  drawn (201/1-05 — residency is decided against the frustum this frame culls with). Returns the
   *  ENGINE's own streaming numbers — blob-handler and upload milliseconds, creates, evictions — which the
   *  console used to throw away, keeping only `pendingCells`. They are the between-frame half no in-loop
   *  timer can see. */
  follow: (focus: readonly [number, number, number], view: ResidencyView) => StreamStats;
  /** Where `data/` sits, for timecyc. Empty when there is no game dir (the demo). */
  gameDir: string;
  /** What the status bar shows as the world's provenance. */
  label: string;
  /** How far from the view's focus this world actually has content — the LOD ring for a streamed world,
   *  its own extent for the demo. The camera derives both of its bounds from it (201/7-02). */
  readonly reach: number;
}

/**
 * One frame of whatever movement keys are held (201/7-06). Rates come from the camera, and every one of
 * them is a rate rather than a step: a key held for twice as long moves twice as far, at any frame rate.
 *
 * Opposite keys held together cancel, which is what a sum does and what an operator expects — the
 * alternative (last key wins) makes a mistyped combination feel like a stuck map.
 */
export function applyHeldKeys(camera: MapCamera, keyboard: KeyboardInput, dtMs: number): void {
  const seconds = Math.max(0, dtMs) / 1000;
  const axis = (positive: HeldCommand, negative: HeldCommand): number =>
    (keyboard.held(positive) ? 1 : 0) - (keyboard.held(negative) ? 1 : 0);

  const east = axis('panEast', 'panWest');
  const north = axis('panNorth', 'panSouth');
  if (east !== 0 || north !== 0) {
    // The two are normalised together, so a diagonal is not faster than a straight line.
    const length = Math.hypot(east, north);
    const step = (KEY_PAN_PER_SECOND * seconds) / length;
    camera.panBySpan(east * step, north * step);
  }
  const turn = axis('rotateRight', 'rotateLeft');
  if (turn !== 0) {
    camera.turnBy(turn * KEY_TURN_PER_SECOND * seconds);
  }
  const tilt = axis('tiltUp', 'tiltDown');
  if (tilt !== 0) {
    camera.tiltBy(tilt * KEY_TILT_PER_SECOND * seconds);
  }
  const zoom = axis('zoomOut', 'zoomIn');
  if (zoom !== 0) {
    camera.zoomBy(KEY_ZOOM_PER_SECOND ** (zoom * seconds));
  }
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
  const sketch = new SketchStore();
  // A click on the radar is "look over there", not "zoom in on that": the flight keeps the operator's
  // current span, so an overview stays an overview and a street view stays a street view.
  const radar =
    options.minimap === undefined
      ? null
      : mountMinimap(
          options.minimap,
          { boxes: world.districts.boxes, centre: world.extent.centre, radius: world.extent.radius },
          (at) => camera.flyTo(at),
          dpr,
        );
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

  /** Every point an operator is working right now: units on duty and calls that are still open. */
  const boardPoints = (): readonly GtaGround[] => {
    const ops = options.ops();

    return [
      ...ops.units.map((unit) => unit.at),
      ...ops.incidents.filter((incident) => incident.status !== 'closed').map((incident) => incident.at),
    ];
  };
  /** Ride the selected unit, or stop if already riding — one function, so the key and the button agree. */
  const followSelected = (): void => {
    const selection = options.selection();
    camera.follow(
      camera.following() || selection?.kind !== 'unit'
        ? null
        : () => options.ops().units.find((unit) => unit.id === selection.id)?.at ?? null,
    );
  };

  const gestures = bindInput({ camera, canvas, districts: world.districts, engine, options, sketch, symbology });
  const zoomLevel = (level: ZoomLevel): void =>
    camera.flyTo(camera.positionGta(), zoomSpan(level, camera.positionGta(), world));
  /** The keyboard is bound to the WINDOW, not the canvas: the map is not React's, and a key has to work
   *  wherever the operator's focus happens to be — except in a field, which `bindKeys` guards. */
  const keyboard = bindKeys(window, (command) =>
    runCommand(command, { camera, fit: () => camera.fitBounds(boardPoints()), followSelected, options, zoomLevel }),
  );
  const unbind = (): void => {
    keyboard.unbind();
    gestures();
  };
  // 201/1-01. Off unless asked for: draining the span recorder is cheap, but a mode that measures by default
  // is a mode nobody can trust to have measured nothing.
  const inventory = params.get('inventory') === '1' ? new FrameInventory() : null;
  // A SECOND span recorder, deliberately not the shared `frameSpans`. That one is for work between frames,
  // and a span opened inside the loop body would be subtracted from `dt` twice
  // (restrictions/architecture.md). Nobody subtracts this one from anything: it is the CPU-side proxy for a
  // device with no `timestamp-query`, and it only runs when the mode is on.
  const loopCpu = new FrameSpans();
  const time = <T>(name: string, run: () => T): T => (inventory ? loopCpu.measure(name, run) : run());
  /**
   * A capture waiting for the end of a frame (201/7-07). The two canvases are only in step there: the
   * WebGPU one holds a frame's world until the next one starts, and the overlay holds the symbology drawn
   * for THAT world. Reading either at an arbitrary moment gives a city with no units, or units over a
   * city that has moved.
   */
  let pendingCapture: ((image: Blob | null) => void) | null = null;
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
    // Before the state is read, so the streamer follows where the held keys and the flight have taken the
    // view THIS frame rather than where it was last frame.
    applyHeldKeys(camera, keyboard, dt);
    camera.advance(dt);
    const state = camera.state(aspect);
    time('board', () => beacons.update(ops, options.selection(), options.trails?.()));
    // Rings follow the ground point the view is over, never the eye: a camera a kilometre up sits outside
    // every ring and would stream nothing at all. The view goes with it, so what the frame will draw is what
    // the streamer fetches — judged at the DRAWING buffer's height, which is where a DPR of 3 lives.
    const stream = time('stream', () =>
      world.follow([state.target[0], state.target[1], state.target[2]], { camera: state, pixelHeight: canvas.height }),
    );
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
      // Over the symbols: an operator's own mark is the last thing drawn, so nothing hides it (201/7-05).
      drawSketches(context, (at) => projector.project(gtaToEngine(at)), sketch);
    });
    // The radar is drawn LAST and only when something on it moved (201/7-04) — it is an inset over a map
    // that is already correct, and a repaint every frame is what chain 4 would have to undo.
    radar?.draw(ops, options.selection(), camera, aspect);

    if (pendingCapture !== null) {
      const resolve = pendingCapture;
      pendingCapture = null;
      void composeImage(canvas, overlay, {
        build: world.label,
        district: districtLabel(params, world, camera),
        pose: camera.pose(),
      }).then(resolve);
    }

    if (now - lastReadout > 1000 / READOUT_HZ) {
      lastReadout = now;
      const average = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
      time('readout', () =>
        options.onReadout({
          buildTime: world.label,
          cellsTotal: stats.cellsTotal,
          cellsVisible: stats.cellsVisible,
          draws: stats.drawsRecorded,
          following: camera.following(),
          fps: Math.round(1000 / Math.max(1, average)),
          hour,
          measurement: sketch.measurement(),
          namesHidden: symbology.counted().chipsDropped,
          pending: stream.pendingCells,
          pose: camera.pose(),
          residencyMb: stats.residencyBytes / (1024 * 1024),
          tool: sketch.tool(),
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
      // A capture waiting for a frame that will never come would leave its caller waiting forever; the
      // export says "no image" instead, which is a thing the operator can act on.
      pendingCapture?.(null);
      pendingCapture = null;
      unbind();
      errorLog.dispose();
      beacons.dispose();
      radar?.dispose();
    },
    exportImage(): Promise<Blob | null> {
      return new Promise((resolve) => {
        pendingCapture = resolve;
      });
    },
    faceNorth(): void {
      camera.turnTo(MAP_YAW);
    },
    fitBoard(): void {
      camera.fitBounds(boardPoints());
    },
    follow(id: null | string): void {
      camera.follow(id === null ? null : () => options.ops().units.find((unit) => unit.id === id)?.at ?? null);
    },
    goToPlace(place: SearchedPlace): void {
      camera.fitBounds([place.min, place.max]);
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
    pose: () => camera.pose(),
    recallView(pose: MapPose): void {
      camera.flyToPose(pose);
    },
    searchPlaces: (query) => world.districts.search(query),
    setBindings(next: KeyBindings): void {
      keyboard.setBindings(next);
    },
    setHour: applyHour,
    setProjection(projection: MapProjection): void {
      camera.setProjection(projection);
    },
    setTool(tool: MapTool): void {
      sketch.setTool(tool);
    },
    setZoomLevel(level: ZoomLevel): void {
      camera.flyTo(camera.positionGta(), zoomSpan(level, camera.positionGta(), world));
    },
    sharedView: (): SharedView => ({
      ...viewOfPose(camera.pose()),
      hour,
      ...(params.get('src') === null ? {} : { src: params.get('src') ?? '' }),
      ...(params.get('district') === null ? {} : { district: params.get('district') ?? '' }),
    }),
    sketchClear(): void {
      sketch.clear();
    },
    sketchFinish(): void {
      sketch.finish();
    },
    sketchUndo(): void {
      sketch.undo();
    },
    tiltBy(radians: number): void {
      camera.tiltBy(radians);
    },
    turnBy(radians: number): void {
      camera.turnTo(camera.pose().yaw + radians);
    },
    zoomBySteps(steps: number): void {
      camera.flyTo(camera.positionGta(), camera.span() * ZOOM_STEP ** -steps);
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
/** What a pressed key does. One switch, so the sheet, the buttons and the keyboard cannot drift apart. */
export function runCommand(
  command: PressedCommand,
  host: {
    camera: MapCamera;
    fit: () => void;
    followSelected: () => void;
    options: BootOptions;
    zoomLevel: (level: ZoomLevel) => void;
  },
): void {
  switch (command) {
    case 'fitBoard':
      host.fit();
      break;
    case 'followSelected':
      host.followSelected();
      break;
    case 'levelBlock':
      host.zoomLevel('block');
      break;
    case 'levelCity':
      host.zoomLevel('city');
      break;
    case 'levelDistrict':
      host.zoomLevel('district');
      break;
    case 'nextCall':
      stepCall(host, 1);
      break;
    case 'north':
      host.camera.turnTo(MAP_YAW);
      break;
    case 'previousCall':
      stepCall(host, -1);
      break;
    case 'stopFollowing':
      // Only when it is riding something: Escape belongs to the selection everywhere else, and a key that
      // silently eats an operator's Escape is worse than one that does nothing.
      if (host.camera.following()) {
        host.camera.follow(null);
      }
      break;
    case 'toggleHelp':
      // The sheet is React's, and it listens for the same key — nothing to do here, and saying so is
      // cheaper than a comment somewhere else explaining a missing case.
      break;
  }
}

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

/**
 * Wire the map's gestures to the camera and to selection. The gesture layer decides WHAT happened (tap, pan,
 * orbit, pinch, long press); this decides what it MEANS: a tap selects, a long press opens a call there.
 */
function bindInput(input: {
  camera: MapCamera;
  canvas: HTMLCanvasElement;
  districts: DistrictLookup;
  engine: Engine;
  options: BootOptions;
  sketch: SketchStore;
  symbology: SymbologyLayer;
}): () => void {
  const { camera, canvas, districts, engine, options, sketch, symbology } = input;

  /** The world ray under a canvas-relative CSS position. */
  const rayAt = (x: number, y: number): CursorPick => {
    const rect = canvas.getBoundingClientRect();
    const ndc: [number, number] = [(x / rect.width) * 2 - 1, 1 - (y / rect.height) * 2];

    return camera.rayAt(ndc, rect.width / Math.max(1, rect.height));
  };

  return bindGestures(canvas, {
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
      // A tool takes the tap whole: while one is armed the map draws instead of selecting, which is what
      // makes a cordon possible to place over a unit without picking the unit up (201/7-05).
      if (sketch.tool() !== 'none') {
        const ground = groundPoint(rayAt(x, y));
        if (ground) {
          sketch.addPoint(ground);
        }

        return;
      }
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
    extent: DEMO_EXTENT,
    follow: () => IDLE_STREAM,
    gameDir: '',
    label: 'demo (synthetic)',
    reach: DEMO_REACH,
  };
}

/**
 * What the export's stamp calls this place: the world's own name for the point under the view, else the
 * district the run was opened with, else nothing at all. Never a landmark table of our own — a total
 * conversion's places are its own (201/5-03).
 */
function districtLabel(params: URLSearchParams, world: DispatchWorld, camera: MapCamera): string {
  return world.districts.nameAt(camera.positionGta()) ?? params.get('district') ?? '';
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
  // One reader for the link's own names (201/7-07), so a URL this console WRITES is one it opens.
  const view = readView(params);
  const district = DISTRICTS[params.get('district') ?? ''];

  return {
    at: view.at ?? district?.at ?? OPENING_POSE.at,
    height: view.height ?? OPENING_POSE.height,
    pitch: view.pitch ?? OPENING_POSE.pitch,
    projection: view.projection ?? OPENING_POSE.projection,
    yaw: view.yaw ?? OPENING_POSE.yaw,
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

/**
 * Walk the open calls in the order the queue shows them, selecting and flying to each. The step is taken
 * from the CURRENT selection, so an operator working a call and pressing "next" gets the one after it
 * rather than the one after wherever they last looked.
 */
function stepCall(
  host: { camera: MapCamera; options: BootOptions; zoomLevel: (level: ZoomLevel) => void },
  step: number,
): void {
  const open = host.options.ops().incidents.filter((incident) => incident.status !== 'closed');
  if (open.length === 0) {
    return;
  }
  const selection = host.options.selection();
  const current = selection?.kind === 'incident' ? open.findIndex((incident) => incident.id === selection.id) : -1;
  const next = open[(((current + step) % open.length) + open.length) % open.length];
  host.options.onClick({ id: next.id, kind: 'incident' });
  host.camera.flyTo(next.at, LOCATE_SPAN);
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
    extent: { centre: engineToGta(setup.center), radius: setup.radius },
    follow: (focus, view) => setup.driver.update(focus, view),
    gameDir: source.gameDir,
    label: setup.buildTime ?? 'unknown',
    reach: numberParam(params, 'lod', DEFAULT_LOD_RADIUS),
  };
}
