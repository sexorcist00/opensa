/**
 * Video mode (plan 096/02) — `?video=1&seed=N`, the self-directed showcase runner.
 *
 * A scene picks a seeded route out of the game's own road graph, stages a car on it behind a black overlay,
 * lifts the overlay once the world is streamed AND the frame rate has settled, and hands the wheel to the
 * autopilot for a fragment's worth of real seconds. Then the overlay comes back down and the next scene
 * stages behind it, endlessly, until the tab closes. The user screen-records the canvas and cuts the black
 * gaps out by hand — nothing here captures anything.
 *
 * The sequencer (05) is what turns that into a run: a cycle plays a drive scene in every region of
 * `REGION_CYCLE`, each in that region's own weather and one of the debugger's hours, in a car picked mod-first
 * out of the game's road-car roster. What a cycle contains is a TABLE (`video/presets.ts`), so this file stays
 * about staging; the walk and flythrough kinds are skipped with a notice until 07 gives them scenes.
 *
 * The staging recipe is the phys laps' (`engine-phys-runs.ts`), verbatim and for the same reasons — a
 * teleport's `pendingCells` lies for about a second, and a ground-snapped car is still moving on its springs
 * for two more. Everything outside the fragment happens behind the overlay, so none of it is ever recorded.
 */
import type { StreamStats } from '@opensa/engine';
import type { Route } from '@opensa/game/paths/route-builder';
import type { PathFollowSource } from '@opensa/game/vehicle/path-follow';
import type { TelemetryFrame } from '@opensa/game/vehicle/vehicle-telemetry';
import type { City, CityBox } from '@opensa/game/zones/city';
import type { AssetFileSystem } from '@opensa/renderware';

import { loadRouteGraph } from '@opensa/game/adapters/path-graph';
import { mulberry32, type Random } from '@opensa/game/paths/rng';
import { walkRoute } from '@opensa/game/paths/route-builder';
import { randomNode, type RouteGraph } from '@opensa/game/paths/route-graph';
import { summarisePhysFrames, thinFrames } from '@opensa/game/vehicle/phys-capture';
import { cityAt } from '@opensa/game/zones/city';

import type { VideoCamera } from './camera/engine-camera';
import type { EngineVehicles } from './engine-vehicles';
import type { DirectorState } from './video/director';
import type { ProgramEntry } from './video/presets';
import type { ShiverDiag } from './video/shiver-diag';
import type { Subject } from './video/shots';
import type { StationSupply } from './video/station-supply';

import { modCarSlots, roadCarModels } from '../vehicle-models';
import { nextFrame, until, waitSeconds } from './frame-clock';
import { createDirector, nextStationSlot, planShots, stepDirector } from './video/director';
import { buildProgram, HOUR_SLOTS, pickCar, REGION_CYCLE, sceneSeed, weatherPool } from './video/presets';
import { createShiverDiag, yawOfQuat } from './video/shiver-diag';
import { forwardFromHeading } from './video/shots';
import { createStationSupply } from './video/station-supply';

/** What video mode needs from the engine host — thin accessors over its loop state, like `PhysRunsHost`. */
export interface VideoRunsHost {
  /** The canvas aspect this frame — the framing math needs it, and a resize must reach it live. */
  aspect(): number;
  /** The autopilot installed in the host's `CombinedInput`; the fixed loop advances it. */
  autopilot: PathFollowSource;
  /** The city boxes the region predicate reads (desert first) — a thunk, because they load after boot. */
  cityBoxes(): readonly CityBox[];
  /** The paint combos `carcols` authors for a model (empty when it authors none) — the scene picks one. */
  colourCombos(model: string): Promise<number[][]>;
  /** The game filesystem — the road graph is read from its own `data/paths/nodes*.dat`. */
  fs: AssetFileSystem;
  getStream(): null | StreamStats;
  /** Live accessor — the vehicle system arrives asynchronously after boot. */
  getVehicles(): EngineVehicles | null;
  /** The weather the world is heading for. Read at a scene's end to catch a route that leaked across a city
   *  boundary and let `CityZoneSystem` rewrite the weather mid-shot (D15's tripwire). */
  getWeather(): number;
  /** Ground Z under a GTA point (searching `maxDrop` down), or null — the station survey's ground snap. */
  groundBelow(at: readonly [number, number, number], maxDrop: number): null | number;
  params: URLSearchParams;
  /** Line of sight between two GTA points, one body excluded — the survey and the live tripod check. */
  pathClear(
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    excludeBody?: number,
  ): boolean;
  setHour(hour: number): void;
  /** The streaming-settle deadline after a teleport (the host's world-ready timeout). */
  settleTimeoutMs: number;
  /** Hide every piece of chrome (the shared photo-camera path). Video mode never asks for it back: the run
   *  is endless by design (D2), so the only teardown is closing the tab. */
  setUiHidden(hidden: boolean): void;
  /**
   * Hand the host the frame this shot wants, or null to give it back to the shipped follow rig (the `chase`
   * shot). `cut` DECLARES the discontinuity to the `[cam] jump` watchdog for exactly one frame — an
   * undeclared jump still prints, which is the whole point of declaring the declared ones.
   */
  setVideoCamera(pose: null | VideoCamera, cut: boolean): void;
  /**
   * Install the director's per-frame step, or `null` to take it out again.
   *
   * The host calls it INSIDE its loop, after the car's render pose is written and before the camera snapshot
   * is built, handing over that frame's `dt`. A camera mounted on the car has to be composed from the frame
   * the car is drawn in — stepped from the module's own rAF instead, the pose reaches the screen one frame
   * late and the pairing carries the car's whole travel for that frame.
   */
  setVideoStep(step: ((dt: number) => void) | null): void;
  /** Set the weather INSTANTLY — the 6 s artistic fade must never play inside a fragment. */
  setWeather(index: number): void;
  /** Spawn a scene-owned car (not LOD-registered) and hand back its despawn. */
  spawnCar(
    model: string,
    position: readonly [number, number, number],
    heading: number,
    colour?: string,
  ): Promise<() => void>;
  /** Teleport the player (streaming/collision anchor), GTA coords. */
  teleportPlayer(anchor: readonly [number, number, number]): void;
  /** GTA Z-up → engine Y-up. The director works in ONE space (engine) and converts here, at the boundary. */
  toEngine(gta: readonly [number, number, number]): [number, number, number];
  /** The timecyc weather row names — the region's own weather set is FILTERED out of these (D7). */
  weatherNames: readonly string[];
}

/** What a scene drives when the roster is empty — a game with no readable `vehicles.ide` still gets a try. */
const DEFAULT_CAR = 'admiral';
/** The builder's calm cruise (m/s, D8) — also what a route's length is derived from. */
const CRUISE_SPEED = 12;
/** Road gathered per route, as a multiple of what the longest fragment can drive — margin, never a shortfall. */
const ROUTE_MARGIN = 1.3;
/** Seeded start nodes tried before a scene gives up on the region and takes the next seed. */
const ROUTE_TRIES = 40;
/** How far to the side of the spawn the ped waits (m) — the phys laps' number, inside the 4 m enter range. */
const PED_OFFSET = 2.5;
/** Grace after a teleport before `pendingCells` means anything — it answers for the ring you just left. */
const TELEPORT_NOTICE_SECONDS = 1;
/** After the ring drains: the collision parse behind it is what a spawn actually needs. */
const WARMUP_SECONDS = 2;
/** A ground-snapped car is still moving on its suspension; the overlay stays down through this. */
const SETTLE_SECONDS = 2;
/** How long a spawn keeps retrying while the ground under the spot streams in. */
const SPAWN_RETRY_SECONDS = 15;
/** A seating that has not taken by now is a broken spot, not a slow one. */
const ENTER_TIMEOUT_S = 20;
/** How far from the route start the seated car may be and still be THIS scene's car (m). */
const SPOT_RADIUS = 20;
/** Consecutive frames under {@link STABLE_FRAME_MS} before the overlay lifts — the fps stability gate. */
const STABLE_FRAMES = 30;
/** What counts as a settled frame (ms) — 40 fps, comfortably clear of the cold-teleport spike (plan 091). */
const STABLE_FRAME_MS = 25;
/** How long the gate waits for that before starting anyway (behind a fair warning in the log). */
const STABLE_TIMEOUT_S = 20;
/** Overlay fade (ms) — long enough not to flash, short enough that the user's cut is unambiguous. */
const FADE_MS = 300;
/** The longest frame the director is allowed to integrate (s) — a hitch must not snap the damping. */
const MAX_FRAME_SECONDS = 0.1;
/** Frames spent surveying an OPENING tripod behind the overlay — an open street settles in 2-4 of them. */
const PRIME_FRAMES = 40;
/** Series rate in the printed JSON (Hz). Half the phys laps': this instrument judges a LINE, not a step. */
const SERIES_HZ = 10;
/** Default fragment bounds (real seconds, D1). */
const DEFAULT_FROM = 10;
const DEFAULT_TO = 25;

/** Everything one scene was seeded with — assembled once, so the report can state what it ran. */
interface SceneContext {
  car: string;
  graph: RouteGraph;
  /** Whether {@link car} came from 096/06's mod ledger — the log says so, and the ledger's share is measured. */
  modCar: boolean;
  /** `?at=x,y`: every scene starts at the graph node nearest this point, so a field round can look at the
   *  SAME hard street repeatedly. Null when the sequencer picks freely. */
  pinned: null | readonly [number, number];
  random: Random;
  /** The region this scene plays in (D2's cycle) — the route filter and the weather pool read the same token. */
  region: City;
  scene: number;
  seconds: number;
  /** The RUN's master seed, so a staged-scene line can print the scene's own derived one. */
  seed: number;
  /** Road to gather for this scene (m) — derived from the LONGEST fragment the run may play, not from the
   *  default one: `?to=40` must not hand a 25 s route to a 40 s scene and run out of road on camera. */
  targetLength: number;
}

/** The black DOM element between scenes, and the only thing that owns it (the 094 single-owner rule). */
interface VideoOverlay {
  /** Fade to transparent and resolve once the fade has played out. */
  hide(): Promise<void>;
  /** Instantly black — a scene tears down behind it, never in front of it. */
  show(): void;
}

/** Wire the video runner when the URL asks for it; a no-op otherwise. */
export function setupVideoRuns(host: VideoRunsHost): void {
  const flag = host.params.get('video');
  if (flag === null || flag === '0') {
    return;
  }
  const graph = loadRouteGraph(host.fs);
  if (!graph) {
    // Only `original` ships a path graph; the total conversions have no `data/Paths` at all, so a drive
    // scene cannot exist there. Say so — a silent no-op reads as "video mode is broken".
    log('this game ships no road graph (data/paths/nodes*.dat) — drive scenes need one');

    return;
  }
  const from = Number(host.params.get('from') ?? DEFAULT_FROM) || DEFAULT_FROM;
  const to = Math.max(from, Number(host.params.get('to') ?? DEFAULT_TO) || DEFAULT_TO);
  // A derived seed is still a REPLAYABLE seed — as long as it is printed, which is the whole of D9. Read
  // for PRESENCE, not truthiness: `?seed=0` is a seed like any other and must not fall through to the clock.
  const asked = host.params.get('seed');
  const seed = asked === null || Number.isNaN(Number(asked)) ? Date.now() >>> 0 : Number(asked);
  // `?car=` pins the car for every scene (a field round comparing streets must not also change the subject);
  // absent, each scene picks one — mod cars first (D10).
  const pinnedCar = host.params.get('car');
  const roster = roadCarModels(host.fs);
  const modCars = modCarSlots(host.fs);
  const pinned = parsePin(host.params.get('at'));
  log(
    `seed=${seed} cycle ${REGION_CYCLE.join('→')} fragments ${from}-${to}s · ` +
      `${roster.length} road cars, ${modCars.size} mod slots` +
      (pinnedCar ? ` · car pinned to ${pinnedCar}` : '') +
      (pinned ? ` · pinned at ${pinned[0]},${pinned[1]}` : ''),
  );

  const overlay = createOverlay();
  host.setUiHidden(true);
  // `&diag=1`: one full-rate `[diag]` line per scene, for a field report about camera MOTION (the scene
  // report's 10 Hz series cannot see a per-frame one). Off by default — it is a console line per frame's
  // worth of numbers, not something a showcase run should carry.
  const diag = createShiverDiag(host.params.get('diag') === '1');
  void (async (): Promise<void> => {
    // The program is rebuilt each lap from the lap's own seed, so a long run is not the same eight scenes
    // over and over — and `?seed=` still names every one of them.
    let program: ProgramEntry[] = [];
    for (let scene = 1; ; scene += 1) {
      // Per-scene seed off the master (D9), so scene N is the same scene however the run reached it.
      const random = mulberry32(sceneSeed(seed, scene));
      const at = (scene - 1) % Math.max(1, program.length);
      if (at === 0) {
        program = buildProgram(mulberry32(sceneSeed(seed, -scene)));
      }
      const entry = program[at];
      if (entry.kind !== 'drive') {
        // 07 owns the walk and flythrough scenes. Skipping them SAYS so: a silently shortened cycle reads as
        // a sequencer that lost a region, and no placeholder ever reaches the footage.
        log(`scene ${scene} ${entry.region} ${entry.kind} — not implemented yet (096/07), skipping`);
        continue;
      }
      const car = pinnedCar ?? pickCar(random, roster, modCars) ?? DEFAULT_CAR;
      try {
        await runScene(
          host,
          {
            car,
            graph,
            modCar: modCars.has(car),
            pinned,
            random,
            region: entry.region,
            scene,
            seconds: from + random() * (to - from),
            seed,
            targetLength: to * CRUISE_SPEED * ROUTE_MARGIN,
          },
          overlay,
          diag,
        );
      } catch (error) {
        // A scene that failed must SAY so behind its own overlay; a missing line reads as a scene that played.
        overlay.show();
        log(`scene ${scene} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  })();
}

function createOverlay(): VideoOverlay {
  const style = document.createElement('style');
  style.textContent = `.opensa-video-overlay{position:fixed;inset:0;background:#000;pointer-events:none;z-index:2147483647;opacity:1;transition:opacity ${FADE_MS}ms linear}.opensa-video-overlay.is-clear{opacity:0}`;
  const element = document.createElement('div');
  element.className = 'opensa-video-overlay';
  document.head.append(style);
  document.body.append(element);

  return {
    hide: async (): Promise<void> => {
      element.classList.add('is-clear');
      await waitSeconds(FADE_MS / 1000);
    },
    show: (): void => element.classList.remove('is-clear'),
  };
}

/** GTA heading of a step from `from` to `to` (0 faces +Y, counter-clockwise about +Z). */
function headingOf(from: readonly [number, number, number], to: readonly [number, number, number]): number {
  return Math.atan2(-(to[0] - from[0]), to[1] - from[1]);
}

/**
 * Get the player out of whatever he is in, instantly.
 *
 * NOT the press-and-wait exit the phys laps use: a scene tears down behind the overlay and then despawns its
 * car, so an exit the world is allowed to stall would leave the player seated in a car about to be destroyed
 * (measured: a route ending on a freeway overpass hung the climb-out, and every later scene then read a dead
 * body). The climb-out is never on camera here, so it is not part of what a scene owes.
 */
function leaveCar(host: VideoRunsHost, vehicles: EngineVehicles): void {
  host.autopilot.stop(); // hands off the wheel first, or the car drives away from under the exit
  vehicles.leaveInstantly();
}

/** `?at=x,y` → the point every scene's route starts nearest to, or null when the pair is absent/unreadable. */
function parsePin(value: null | string): null | readonly [number, number] {
  if (value === null) {
    return null;
  }
  const [x, y] = value.split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    log(`ignoring ?at=${value} — expected two numbers, "x,y"`);

    return null;
  }

  return [x, y];
}

// eslint-disable-next-line no-console -- the runner's whole progress protocol is this tag (D12: no on-screen status)
const log = (message: string): void => console.log(`[video] ${message}`);

/** The `p`-th percentile of a sample set (0..1), 0 for an empty one. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * A seeded route inside the region, or null when the region gave none in {@link ROUTE_TRIES} tries.
 *
 * Only a route that reached its TARGET length is accepted: one that stopped early is a fragment that runs
 * out of road on camera, and 096/01 measured 45-69 acceptable routes per region per 200 tries, so this is
 * cheap. The rejects are the builder's business, not the scene's.
 */
function pickRoute(
  graph: RouteGraph,
  random: Random,
  inRegion: (x: number, y: number) => boolean,
  targetLength: number,
  pinned: null | readonly [number, number],
): null | Route {
  // A PINNED start (`?at=x,y`, 096/04) is how a hard case gets looked at deliberately: `video-routes.ts
  // --worst` prints the coordinates of the tightest routes, and this is what takes one of them. The walk is
  // still seeded, so the same pin plus the same seed is the same drive, every time.
  if (pinned) {
    const start = graph.nearest(pinned[0], pinned[1]);
    for (let attempt = 0; start !== undefined && attempt < ROUTE_TRIES; attempt += 1) {
      const route = walkRoute(graph, start, random, { cruiseSpeed: CRUISE_SPEED, inRegion, targetLength });
      if (route && route.stop === 'target') {
        return route;
      }
    }
    // Saying so matters: a field round that quietly drove somewhere else would be measuring the wrong street.
    log(`no route out of the pinned start in ${ROUTE_TRIES} tries — this scene takes a seeded one`);
  }
  for (let attempt = 0; attempt < ROUTE_TRIES; attempt += 1) {
    const start = randomNode(
      graph,
      random,
      (node) => !node.boats && node.links.length > 0 && inRegion(node.position[0], node.position[1]),
    );
    if (start === undefined) {
      return null;
    }
    const route = walkRoute(graph, start, random, { cruiseSpeed: CRUISE_SPEED, inRegion, targetLength });
    if (route && route.stop === 'target') {
      return route;
    }
  }

  return null;
}

/** A weather index from the scene region's own timecyc set (D7), or null when the game authors none for it. */
function pickWeather(weatherNames: readonly string[], region: City, random: Random): null | number {
  const pool = weatherPool(weatherNames, region);
  if (pool.length === 0) {
    return null;
  }

  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/**
 * The fragment itself: hand the director to the host's own loop, then watch for the end of the scene.
 *
 * The pose is NOT stepped from here. A camera mounted on the car has to be composed from the frame the car is
 * drawn in, and only the host's loop is inside that frame ({@link VideoRunsHost.setVideoStep}); this function
 * owns the fragment's clock and its end conditions, nothing per-frame.
 */
async function playFragment(
  host: VideoRunsHost,
  vehicles: EngineVehicles,
  director: DirectorState,
  supply: StationSupply,
  seconds: number,
  diag: ShiverDiag,
): Promise<string> {
  const started = performance.now();
  // A hitch must not teleport the damping: a 400 ms frame would land the eye on its target in one step.
  host.setVideoStep((dt) => poseFrame(host, vehicles, director, supply, Math.min(MAX_FRAME_SECONDS, dt), diag));
  try {
    for (;;) {
      await nextFrame();
      const state = host.autopilot.state();
      if (state !== 'following') {
        return state;
      }
      if (performance.now() - started >= seconds * 1000) {
        return 'ran-out';
      }
    }
  } finally {
    host.setVideoStep(null);
  }
}

/**
 * One rendered frame of the director: pose the shot, hand it to the host, and say nothing when there is no
 * car to film (a despawn mid-teardown) — the last pose then simply stands, which is what a held frame looks
 * like behind the overlay that is already coming down.
 */
function poseFrame(
  host: VideoRunsHost,
  vehicles: EngineVehicles,
  director: DirectorState,
  supply: StationSupply,
  dt: number,
  diag?: ShiverDiag,
): void {
  const car = vehicles.activeVehicle();
  if (!car) {
    return;
  }
  supply.beginFrame();
  const subject: Subject = {
    // The DRAWN position with the GAMEPLAY heading — the pairing the shipped rig already follows a car with
    // (`focus`/`focusHeading` in the host): the heading is at most one fixed step old, which at a cruise yaw
    // rate is a fraction of a degree, while the position must be the interpolated one or the shot judders.
    forward: forwardFromHeading(car.heading),
    halfExtents: car.halfExtents,
    position: host.toEngine([car.renderPosition[0], car.renderPosition[1], car.renderPosition[2]]),
    speed: Math.abs(vehicles.drivenMotion()?.speed ?? 0),
  };
  const frame = stepDirector(director, subject, dt, host.aspect(), supply);
  host.setVideoCamera(frame.pose, frame.cut);
  if (diag?.enabled && frame.pose && frame.screen) {
    diag.record({
      car: subject.position,
      cut: frame.cut,
      eye: frame.pose.eye,
      heading: car.heading,
      renderYaw: yawOfQuat(car.renderOrientation),
      screen: [frame.screen.x, frame.screen.y],
      shot: frame.shot,
      t: performance.now(),
      target: frame.pose.target,
    });
  }
  // The survey runs AFTER the pose, on what is left of the budget: a live sightline is the frame's first
  // claim on it, and a survey is the thing that can always wait one more frame.
  supply.step();
}

/**
 * Give the survey its frames before the fragment starts, for a scene whose FIRST shot is a tripod.
 *
 * Bounded by frames, not by an answer: a survey that finds nothing simply stops asking, and the slot plays
 * its fallback exactly as it would have.
 */
async function primeStations(supply: StationSupply): Promise<void> {
  for (let frame = 0; frame < PRIME_FRAMES; frame += 1) {
    supply.beginFrame();
    if (supply.step() === 0) {
      return;
    }
    await nextFrame();
  }
}

/** One `[video] {json}` line per scene — the phys protocol's twin, plus what only an autopilot can report. */
function report(
  host: VideoRunsHost,
  context: SceneContext,
  route: Route,
  frames: readonly TelemetryFrame[],
  settleMs: number,
  ended: string,
  director: DirectorState,
  supply: StationSupply,
): void {
  const errors = host.autopilot
    .errorSamples()
    .map(Math.abs)
    .sort((a, b) => a - b);
  const capture = {
    car: context.car,
    // Column-named so a reader never has to count positions; WHERE the car was goes at the END of the row,
    // exactly as the `[phys]` protocol has it.
    columns: [
      't',
      'speed',
      'slipAngle',
      'pitch',
      'roll',
      'yawRate',
      'gLong',
      'gLat',
      'gVert',
      'throttle',
      'steer',
      'x',
      'y',
      'z',
    ],
    /** How far off the driven line the autopilot ever was (m) — 02's own acceptance instrument. */
    crossTrack: {
      max: Number((errors[errors.length - 1] ?? 0).toFixed(3)),
      p50: Number(percentile(errors, 0.5).toFixed(3)),
      p95: Number(percentile(errors, 0.95).toFixed(3)),
      samples: errors.length,
    },
    /** Why the fragment ended: it ran its seconds out, arrived, or the car wedged. */
    ended,
    /** Whether the car came from the mod ledger — the ledger's realised share is counted off these. */
    modCar: context.modCar,
    region: context.region,
    route: {
      length: Number(route.length.toFixed(1)),
      maxTurnDeg: Number(route.maxTurnDeg.toFixed(1)),
      minCurveRadius: Number(route.minCurveRadius.toFixed(1)),
      points: route.points.length,
      progress: Number(host.autopilot.progress().toFixed(3)),
      start: route.points[0].position.map((value) => Number(value.toFixed(1))),
    },
    scene: context.scene,
    seconds: Number(context.seconds.toFixed(2)),
    series: thinFrames(frames, SERIES_HZ).map((frame) =>
      [
        frame.t,
        frame.speed,
        frame.slipAngle,
        frame.pitch,
        frame.roll,
        frame.yawRate,
        frame.gLong,
        frame.gLat,
        frame.gVert,
        frame.throttle,
        frame.steer,
        frame.position[0],
        frame.position[1],
        frame.position[2],
      ].map((value) => Number(value.toFixed(4))),
    ),
    seriesHz: SERIES_HZ,
    /** How long the fps stability gate held the overlay down (ms) — the cold-teleport cost, measured. */
    settleMs: Number(settleMs.toFixed(0)),
    /** What the director did (096/03): the dealt list, the cuts it fired, and the acceptance number —
     *  `safe` is the share of DIRECTED frames the car sat inside the safe frame (chase frames are the rig's
     *  framing, so they are not judged here). */
    shots: {
      /** What ended each shot — `scheduled` is its own clock, the rest are the guard (096/04). */
      causes: director.causes,
      cuts: director.cuts,
      judged: director.framesJudged,
      list: director.plan.map((entry) => `${entry.preset.name}:${entry.seconds.toFixed(1)}`),
      panClips: director.panClips,
      safe: Number((director.framesJudged === 0 ? 0 : director.safeFrames / director.framesJudged).toFixed(3)),
    },
    /** The tripod survey (096/04): what it filled, what it rejected, and what it cost per frame. */
    stations: {
      ...supply.ledger(),
      /** Tripod slots that played a car-anchored stand-in because no candidate passed. */
      fallbacks: director.fallbacks,
      predictionErrorMax: Number(supply.ledger().predictionErrorMax.toFixed(1)),
    },
    summary: summarisePhysFrames(frames),
  };
  // eslint-disable-next-line no-console -- the capture deliverable IS this JSON line (the [phys] twin)
  console.log('[video]', JSON.stringify(capture));
}

/** One fragment: stage it black, play it, report it. */
async function runScene(
  host: VideoRunsHost,
  context: SceneContext,
  overlay: VideoOverlay,
  diag: ShiverDiag,
): Promise<void> {
  const vehicles = host.getVehicles();
  if (!vehicles) {
    throw new Error('no vehicle system on this host');
  }
  overlay.show();
  const boxes = host.cityBoxes();
  const inRegion = (x: number, y: number): boolean => cityAt(x, y, boxes) === context.region;
  const route = pickRoute(context.graph, context.random, inRegion, context.targetLength, context.pinned);
  if (!route) {
    throw new Error(`no route inside ${context.region} in ${ROUTE_TRIES} tries`);
  }
  const hour = HOUR_SLOTS[Math.min(HOUR_SLOTS.length - 1, Math.floor(context.random() * HOUR_SLOTS.length))];
  const weather = pickWeather(host.weatherNames, context.region, context.random);
  // One self-describing line per staged scene (the self-describing-capture rule applied to scenes): everything
  // the seed decided, before anything is driven, so a field note names a scene the next run can reproduce.
  log(
    `scene ${context.scene} seed=${sceneSeed(context.seed, context.scene)} region=${context.region} kind=drive ` +
      `car=${context.car}${context.modCar ? '(mod)' : ''} hour=${hour} ` +
      `weather=${weather === null ? 'unchanged' : host.weatherNames[weather]} ` +
      `route=${route.length.toFixed(0)}m corner=${route.minCurveRadius.toFixed(1)}m ${context.seconds.toFixed(1)}s`,
  );

  // On foot BEFORE the teleport, always: a seated rider is re-placed on his seat every fixed step, so
  // teleporting one drags him back into the car he is in (the phys laps lost four runs to exactly this).
  leaveCar(host, vehicles);
  host.setHour(hour);
  if (weather !== null) {
    host.setWeather(weather);
  }
  const start = route.points[0].position;
  const heading = headingOf(start, route.points[1].position);
  // The ped waits to the car's RIGHT of the road heading, so the spawn never lands on top of him.
  const beside: [number, number, number] = [
    start[0] + Math.cos(heading) * PED_OFFSET,
    start[1] + Math.sin(heading) * PED_OFFSET,
    start[2] + 1,
  ];
  host.teleportPlayer(beside);
  // The three-part settle, all of it the phys recipe: the driver needs a moment to even NOTICE the teleport
  // (`pendingCells` still answers for the ring he left), then the ring drains, then the collision behind it.
  await waitSeconds(TELEPORT_NOTICE_SECONDS);
  await until(() => host.getStream()?.pendingCells === 0, host.settleTimeoutMs);
  await waitSeconds(WARMUP_SECONDS);
  // A seeded paint from the car's OWN `carcols` combos: a stock car that appears twice in a run should not be
  // the same colour twice. A model that authors none spawns in its default (the combos list is empty).
  const combos = await host.colourCombos(context.car);
  const colour =
    combos.length === 0
      ? undefined
      : combos[Math.min(combos.length - 1, Math.floor(context.random() * combos.length))].join(',');
  const despawn = await spawnWithRetry(host, context.car, start, heading, colour);
  try {
    host.teleportPlayer(beside); // back beside the spot: the ped may have slid while the car built
    vehicles.seatInstantly();
    // The distance check is what catches a scene that seated the player in a PARKED car standing nearby —
    // `seatInstantly` takes the nearest one in range, and a street corner is where cars are parked.
    const seated = await until(() => seatedAt(vehicles, start), ENTER_TIMEOUT_S * 1000);
    if (!seated) {
      throw new Error(`could not seat the player in the ${context.car} at the route start`);
    }
    await waitSeconds(SETTLE_SECONDS);

    // The fps gate is the last thing before the overlay lifts: the cold-teleport spike (plan 091, ~20 frames
    // of 110-170 ms) is real, unfixed, and the one thing a viewer would notice in the first second of a shot.
    const settleMs = await waitForStableFrames();
    vehicles.telemetry.reset();
    vehicles.telemetry.enabled = true;
    host.autopilot.follow(route);
    const director = createDirector(planShots(context.random, context.seconds));
    // The survey reads the SAME seeded stream as the shot list, so a replay picks the same candidate order.
    const supply = createStationSupply({
      carGta: (): readonly [number, number, number] => vehicles.activeVehicle()?.position ?? start,
      carSpeed: (): number => Math.abs(vehicles.drivenMotion()?.speed ?? 0),
      cursor: (): number => host.autopilot.progress() * (route.points.length - 1),
      excludeBody: (): number | undefined => vehicles.activeVehicle()?.body,
      probes: {
        groundBelow: (at, maxDrop): null | number => host.groundBelow(at, maxDrop),
        pathClear: (from, to, exclude): boolean => host.pathClear(from, to, exclude),
      },
      random: context.random,
      route,
      toEngine: (gta): [number, number, number] => host.toEngine(gta),
      upcoming: () => nextStationSlot(director),
    });
    log(`scene ${context.scene} shots ${director.plan.map((entry) => entry.preset.name).join(' → ')}`);
    // If the scene OPENS on a tripod, its survey happens here — behind the overlay, where casts are free and
    // there is no preceding shot to amortise them over.
    await primeStations(supply);
    // Compose the opening shot BEFORE the overlay lifts. Staged after it, the fragment would open on the
    // chase rig and cut one frame later — a cut INSIDE the footage, which is exactly what the user's manual
    // edit is not supposed to have to find.
    poseFrame(host, vehicles, director, supply, 0, diag);
    await overlay.hide();
    // WHY it ended is read INSIDE the loop, before the stop. Reading it after `stop()` made every early end
    // report `idle`, and a real `stuck` — a scene that started on an 18° hill the car could not climb — hid
    // behind that for a whole headless run.
    const ended = await playFragment(host, vehicles, director, supply, context.seconds, diag);
    overlay.show();
    host.setVideoCamera(null, true); // the rig takes its frame back, and that hand-over is a declared cut
    host.autopilot.stop();
    vehicles.telemetry.enabled = false;
    report(host, context, route, vehicles.telemetry.frames(), settleMs, ended, director, supply);
    diag.dump(context.scene);
    // D15's tripwire: a route is built inside ONE region precisely so `CityZoneSystem` never fires its 6 s
    // weather rewrite on camera. If the target moved anyway, the route leaked across a boundary — say which
    // scene, or a fade nobody expected becomes a mystery in the footage.
    if (weather !== null && host.getWeather() !== weather) {
      log(
        `scene ${context.scene} weather changed mid-scene: ${host.weatherNames[weather]} → ` +
          `${host.weatherNames[host.getWeather()]} — the route left ${context.region}`,
      );
    }
    if (ended !== 'ran-out') {
      log(
        `scene ${context.scene} ended early: ${ended} at ${(host.autopilot.progress() * 100).toFixed(0)}% of the route`,
      );
    }
    leaveCar(host, vehicles);
  } finally {
    despawn(); // the scene owns this car; nothing respawns it and nothing inherits it
  }
}

/** Seated, settled, and in a car standing at THIS scene's route start. */
function seatedAt(vehicles: EngineVehicles, start: readonly [number, number, number]): boolean {
  const car = vehicles.activeVehicle();
  if (car === null || vehicles.isSettling()) {
    return false;
  }

  return Math.hypot(car.position[0] - start[0], car.position[1] - start[1]) < SPOT_RADIUS;
}

/** Spawn the scene's car, retrying while the ground under the spot is still streaming in. */
async function spawnWithRetry(
  host: VideoRunsHost,
  car: string,
  position: readonly [number, number, number],
  heading: number,
  colour?: string,
): Promise<() => void> {
  const deadline = performance.now() + SPAWN_RETRY_SECONDS * 1000;
  for (;;) {
    try {
      return await host.spawnCar(car, position, heading, colour);
    } catch (error) {
      if (performance.now() >= deadline) {
        throw error;
      }
      await waitSeconds(0.5);
    }
  }
}

/**
 * Hold until the frame rate has settled: {@link STABLE_FRAMES} consecutive frames under
 * {@link STABLE_FRAME_MS}. Returns how long that took (ms), which is the number the ledger wants — the
 * cold-teleport spike is unfixed, so what a scene can honestly promise is that it is over before the shot.
 *
 * Measured here rather than through the bench's sampler on purpose: `takeSamples` is the perf runner's leg
 * collector and clearing it would step on a bench run's own state.
 */
async function waitForStableFrames(): Promise<number> {
  const started = performance.now();
  let previous = started;
  let run = 0;
  while (run < STABLE_FRAMES && performance.now() - started < STABLE_TIMEOUT_S * 1000) {
    await nextFrame();
    const now = performance.now();
    run = now - previous < STABLE_FRAME_MS ? run + 1 : 0;
    previous = now;
  }
  const waited = performance.now() - started;
  if (run < STABLE_FRAMES) {
    log(`frame rate never settled in ${STABLE_TIMEOUT_S}s — starting anyway`);
  }

  return waited;
}
