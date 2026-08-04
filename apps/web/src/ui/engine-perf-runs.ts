/**
 * In-game perf runs on the own engine (extracted from engine-canvas-host):
 * - bench `?bench=<key|all>` (074/10 B3 → the C1 comparability requirement): SAME scenes + path sampler
 *   as prod's BenchPlugin, SAME `[bench] {json}` report protocol — only the harness is host-specific
 *   (teleport via physics, weather via the shared env driver, camera override, engine stats capture);
 * - soak `?soak=<minutes>` (074/10 pre-flip ③): cycles ALL bench scenes until the deadline and
 *   self-judges stability (./soak owns the loop + verdict). Bench wins when both flags are set.
 */
import { type Engine, type StreamStats } from '@opensa/engine';
import { benchRoadCarPlacements } from '@opensa/game/adapters/road-cars';
import { type BenchScene, samplePath } from '@opensa/game/perf/bench';
import { type AssetFileSystem } from '@opensa/renderware';

import type { EngineVehicles } from './engine-vehicles';

import { BENCH_SCENES } from '../bench-scenes';
import { parseSoakMinutes, runSoak } from './soak';

/** One frame's numbers pushed by the host's render loop while a leg flies. */
export interface LegSample {
  draws: number;
  /** Fixed steps this frame — `vehicleFixedMs` is summed over them, and the budget is PER STEP. */
  fixedSteps: number;
  frameMs: number;
  gpuMs: number;
  /** Raycast vehicles alive in the physics world — the vehicle cost means nothing without the count. */
  liveVehicles: number;
  postMs: number;
  probeMs: number;
  submitMs: number;
  triangles: number;
  /** The vehicle slice of this frame's fixed steps (081/07 §3): raycast controllers + the vehicle
   *  system's fixed update, apart from the solver and from the per-frame visual tick. */
  vehicleFixedMs: number;
}

/** What the runs need from the engine host — thin accessors over its loop state. */
export interface PerfRunsHost {
  /** Start pushing {@link LegSample}s from the render loop. */
  beginSamples(): void;
  engine: Engine;
  fs: AssetFileSystem;
  getStream(): null | StreamStats;
  /** Live accessor — the vehicle system arrives asynchronously after boot. */
  getVehicles(): EngineVehicles | null;
  params: URLSearchParams;
  setBenchCamera(camera: null | { eye: [number, number, number]; target: [number, number, number] }): void;
  setHour(hour: number): void;
  setSoakStatus(text: string): void;
  /** The streaming-settle deadline after a teleport (the host's world-ready timeout). */
  settleTimeoutMs: number;
  /** Instant weather switch — legs must not sample mid-blend. */
  setWeather(weather: number): void;
  slowFrameMs: number;
  /** Stop sampling and take the collected frames. */
  takeSamples(): LegSample[];
  /** Teleport the player (streaming/collision anchor), GTA coords. */
  teleportPlayer(anchor: readonly [number, number, number]): void;
  /** GTA Z-up → engine world space (the camera's frame). */
  toEngine(gta: readonly [number, number, number]): [number, number, number];
}

/** Residency by ledger category, MB (074/21 P3 — the sweep-accumulation diagnosis): non-zero buckets only. */
export function ledgerBreakdown(engine: Engine): string {
  return Object.entries(engine.ledger())
    .filter(([, entry]) => entry.bytes > 0)
    .map(([category, entry]) => `${category} ${(entry.bytes / 1048576).toFixed(0)}`)
    .join(' · ');
}

/** Wire the bench/soak runners when the URL asks for them; a no-op otherwise. */
export function setupPerfRuns(host: PerfRunsHost): void {
  const benchKey = host.params.get('bench');
  const soakMinutes = parseSoakMinutes(host.params.get('soak'));
  if (!benchKey && soakMinutes === 0) {
    return;
  }
  const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const flyAt = (scene: BenchScene, t: number): void => {
    const pose = samplePath(scene.path, t);
    host.setBenchCamera({
      eye: host.toEngine(pose.pos),
      target: host.toEngine(pose.look),
    });
  };
  // Shared leg mechanics (bench + soak): teleport + settle + warmup OUTSIDE the capture, then the timed
  // flight with frame sampling. Bench formats the plan-063 report; soak accumulates stability intervals.
  const settleAt = async (scene: BenchScene): Promise<void> => {
    host.setHour(scene.hour);
    host.setWeather(scene.weather);
    host.teleportPlayer(scene.anchor);
    // Settle: the streaming ring around the anchor must drain before sampling (prod's teleport contract).
    const settleStart = performance.now();
    flyAt(scene, 0);
    while (performance.now() - settleStart < host.settleTimeoutMs) {
      await nextFrame();
      const stream = host.getStream();
      if (stream !== null && stream.pendingCells === 0) {
        break;
      }
    }
    // Warmup (prod WARMUP_S): shader compiles / fresh-ring uploads drain outside the capture.
    const warmupStart = performance.now();
    while (performance.now() - warmupStart < 1500) {
      await nextFrame();
    }
  };
  const flyLeg = async (scene: BenchScene): Promise<{ lateCreates: number; samples: LegSample[] }> => {
    host.beginSamples();
    const lateStart = host.getStream()?.lateCreates ?? 0; // late-create DELTA over the measure window (074/21 P3)
    const runStart = performance.now();
    let t = 0;
    while (t < 1) {
      t = Math.min(1, (performance.now() - runStart) / 1000 / scene.durationS);
      flyAt(scene, t);
      await nextFrame();
    }
    const samples = host.takeSamples();
    host.setBenchCamera(null);

    return { lateCreates: (host.getStream()?.lateCreates ?? 0) - lateStart, samples };
  };
  const runScene = async (scene: BenchScene): Promise<void> => {
    await settleAt(scene);
    const { lateCreates, samples } = await flyLeg(scene);
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
      avgTriangles: Math.round(avg(samples.map((sample) => sample.triangles))),
      fps: Number((1000 / Math.max(0.001, avgMs)).toFixed(1)),
      frames: samples.length,
      gpuMs: {
        pass: Number(avg(gpuSamples).toFixed(3)),
        post: Number(avg(postSamples).toFixed(3)),
        probe: Number(avg(probeSamples).toFixed(3)),
        submit: Number(avg(samples.map((sample) => sample.submitMs)).toFixed(3)),
      },
      key: scene.key,
      // The fog-mask honesty gate (074/21 P3): creates inside the fog cut during the measure window.
      lateCreates,
      p95Ms: Number((sortedMs[Math.floor(sortedMs.length * 0.95)] ?? 0).toFixed(3)),
      // Residency at scene end + its category breakdown — the sweep-accumulation diagnosis (074/21 P3).
      residency: ledgerBreakdown(host.engine),
      // The vehicle slice against 081/07 §3's budget: mean and worst cost of ONE fixed step, beside the
      // car count that produced it. Frames with no fixed step (the loop caught up) carry no vehicle work
      // and would drag the mean toward zero, so they are left out rather than counted as free steps.
      vehicles: vehicleStepCost(samples),
    };
    // eslint-disable-next-line no-console -- the bench deliverable IS this JSON line (plan 063 protocol)
    console.log('[bench]', JSON.stringify(report));
  };
  // Road cars (074 bench realism): typed cars from vehicles.ide on the path-node road graph around
  // every measured scene, registered LAZILY — the vehicle-lod system streams them exactly like the
  // game's own parked cars, so each scene measures a realistic vehicle load. Shared with the prod
  // three host (canvas-host) so the C1 baseline sweeps the SAME population.
  const registerRoadCars = (targetScenes: readonly BenchScene[]): void => {
    const vehicles = host.getVehicles();
    const placements = benchRoadCarPlacements(host.fs, targetScenes, host.params.get('benchcar'));
    if (vehicles && placements.length > 0) {
      vehicles.register(placements);
    } else if (targetScenes.some((scene) => scene.cars !== undefined)) {
      // eslint-disable-next-line no-console -- a silent empty street would read as a false measurement
      console.warn('[bench] road cars SKIPPED: no vehicle system, path graph or car models');
    }
    // eslint-disable-next-line no-console -- bench CLI feedback (the record's context, same protocol)
    console.log(`[bench] road cars registered: ${vehicles ? placements.length : 0}`);
  };
  // Printed ONCE per sweep, because it does not vary by scene: what the adapter offers, what it LACKS, its
  // feature level, and the size the run was taken at. On a phone the missing half is the schema — no
  // `timestamp-query` means the `gpuMs` column below is absent rather than zero, and a reader who cannot
  // see that will compare the row to a desktop one (`docs/benchmarks/readme.md`, mobile schema).
  const reportDevice = (): void => {
    // eslint-disable-next-line no-console -- same `[bench]` protocol; this line IS part of the record
    console.log('[bench] device', JSON.stringify(host.engine.deviceReport));
  };
  if (benchKey) {
    reportDevice();
    const scenes = benchKey === 'all' ? BENCH_SCENES : BENCH_SCENES.filter((scene) => scene.key === benchKey);
    if (scenes.length === 0) {
      // eslint-disable-next-line no-console -- bench CLI feedback, same as prod
      console.warn(`[bench] unknown scene '${benchKey}' — known: all, ${BENCH_SCENES.map((s) => s.key).join(', ')}`);
    }
    void (async (): Promise<void> => {
      registerRoadCars(scenes);
      for (const scene of scenes) {
        await runScene(scene);
      }
      // eslint-disable-next-line no-console -- bench CLI feedback, same as prod
      console.log('[bench] sweep complete');
    })();
  } else {
    void runSoak(
      {
        flyLeg,
        registerRoadCars,
        sample: () => ledgerSample(host.engine, host.getStream()),
        setStatus: (text: string): void => {
          host.setSoakStatus(text);
        },
        settleAt,
      },
      BENCH_SCENES,
      soakMinutes,
      host.slowFrameMs,
    );
  }
}

/** Soak residency snapshot (074/10 ③): ledger totals + the texture bucket + streamed cells. */
function ledgerSample(
  engine: Engine,
  stream: null | StreamStats,
): { cells: number; residencyMb: number; textureMb: number } {
  const ledger = engine.ledger();
  let totalBytes = 0;
  for (const entry of Object.values(ledger)) {
    totalBytes += entry.bytes;
  }

  return {
    cells: stream?.loadedCells ?? 0,
    residencyMb: Math.round(totalBytes / 1048576),
    textureMb: Math.round((ledger.texture?.bytes ?? 0) / 1048576),
  };
}

/**
 * The vehicle slice PER FIXED STEP (081/07 §3's ≤ 0.5 ms budget), from the frames that actually stepped.
 *
 * A frame's `vehicleFixedMs` covers every step it ran, so the per-step cost is the ratio — averaging the
 * frame numbers instead would read a catch-up frame (two steps) as if one step had cost double. `live` is
 * the busiest car count seen, because the budget is stated for eight and a mean would hide the moment it
 * was reached.
 */
function vehicleStepCost(samples: readonly LegSample[]): { live: number; maxMs: number; meanMs: number } {
  const stepped = samples.filter((sample) => sample.fixedSteps > 0);
  if (stepped.length === 0) {
    return { live: 0, maxMs: 0, meanMs: 0 };
  }
  const perStep = stepped.map((sample) => sample.vehicleFixedMs / sample.fixedSteps);

  return {
    live: Math.max(...stepped.map((sample) => sample.liveVehicles)),
    maxMs: Number(Math.max(...perStep).toFixed(3)),
    meanMs: Number((perStep.reduce((sum, value) => sum + value, 0) / perStep.length).toFixed(3)),
  };
}
