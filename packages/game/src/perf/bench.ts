import type { Plugin, PluginContext } from '../plugins/plugin';
import type { PerfCapture, PerfMonitor } from './perf-monitor';

/**
 * Deterministic benchmark harness (plan 063). A scene = a streaming anchor (player teleport), fixed
 * hour/weather, and a camera path flown over a fixed duration while the {@link PerfMonitor} captures.
 * Implemented as a {@link Plugin} because plugins tick AFTER `cameraController.update` — the runner can own
 * the camera each frame without touching the controller.
 */

/** What the runner needs from the game (canvas-host wires the real methods in). */
export interface BenchHost {
  gpuTimings?(): ReadonlyMap<string, number>;
  perf: PerfMonitor;
  setFlyCamera(enabled: boolean): void;
  setTimeMinutes(minutes: number): void;
  setWeather(weather: number): void;
  /** Teleport the player (streaming anchor) and resolve once the world settled around it. */
  teleport(coords: Vec3Tuple): Promise<unknown>;
  /** GTA Z-up scene coords → three world space (the camera's frame). Identity when omitted — scenes and
   *  anchors are authored in GTA coords, the same space `teleport` takes. */
  toWorld?(coords: Vec3Tuple): Vec3Tuple;
}

export interface BenchKeyframe {
  /** World-space point the camera looks at. */
  look: Vec3Tuple;
  /** World-space camera position. */
  pos: Vec3Tuple;
}

export interface BenchReport extends PerfCapture {
  /** EMA GPU pass timings (ms) snapshotted at the end of the run, when the timer is available. */
  gpuMs?: Readonly<Record<string, number>>;
  key: string;
}

export interface BenchScene {
  /** Player teleport target — the streaming/collision anchor the camera path must stay near. */
  anchor: Vec3Tuple;
  /** Timed run length, seconds. */
  durationS: number;
  /** Game hour (fractional ok). */
  hour: number;
  key: string;
  /** Camera keyframes flown start→end over the duration (≥ 2). */
  path: readonly BenchKeyframe[];
  /** Weather index (timecyc weather id). */
  weather: number;
}

export type Vec3Tuple = readonly [number, number, number];

/** Settle margin before sampling starts — lets shader compiles/GPU uploads of the fresh ring drain. */
const WARMUP_S = 1.5;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpVec = (a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

type Phase = 'idle' | 'run' | 'setup' | 'warmup';

export class BenchPlugin implements Plugin {
  readonly name = 'bench';

  private elapsed = 0;
  private readonly host: BenchHost;
  private phase: Phase = 'idle';
  private resolve: ((report: BenchReport) => void) | null = null;
  private scene: BenchScene | null = null;

  constructor(host: BenchHost) {
    this.host = host;
  }

  install(): void {
    // stateless install — the runner only acts once run() was called
  }

  /** Run one scene start→finish; resolves with the report (the caller logs/copies it). */
  async run(scene: BenchScene): Promise<BenchReport> {
    if (this.phase !== 'idle') {
      throw new Error(`bench already running (${this.scene?.key})`);
    }
    this.phase = 'setup'; // claim the runner before the async prologue (update() ignores 'setup')
    this.scene = scene;
    this.host.setTimeMinutes(scene.hour * 60);
    this.host.setWeather(scene.weather);
    await this.host.teleport(scene.anchor);
    this.host.setFlyCamera(true);
    this.elapsed = 0;
    this.phase = 'warmup';

    return new Promise<BenchReport>((resolve) => {
      this.resolve = resolve;
    });
  }

  update(context: PluginContext): void {
    const scene = this.scene;
    if (this.phase === 'idle' || this.phase === 'setup' || !scene) {
      return;
    }
    this.elapsed += context.clock.delta;
    const t = this.phase === 'warmup' ? 0 : Math.min(1, this.elapsed / scene.durationS);
    const pose = samplePath(scene.path, t);
    const pos = this.host.toWorld?.(pose.pos) ?? pose.pos;
    const look = this.host.toWorld?.(pose.look) ?? pose.look;
    context.camera.position.set(...pos);
    context.camera.lookAt(...look);
    if (this.phase === 'warmup' && this.elapsed >= WARMUP_S) {
      this.phase = 'run';
      this.elapsed = 0;
      this.host.perf.beginCapture();

      return;
    }
    if (this.phase === 'run' && t >= 1) {
      this.finish(scene);
    }
  }

  private finish(scene: BenchScene): void {
    const capture = this.host.perf.endCapture();
    this.phase = 'idle';
    this.scene = null;
    this.host.setFlyCamera(false);
    const report: BenchReport = {
      avgDrawCalls: 0,
      avgMs: 0,
      avgTriangles: 0,
      fps: 0,
      frames: 0,
      p95Ms: 0,
      ...capture,
      key: scene.key,
    };
    const gpu = this.host.gpuTimings?.();
    if (gpu && gpu.size > 0) {
      report.gpuMs = Object.fromEntries([...gpu.entries()].map(([label, ms]) => [label, Number(ms.toFixed(3))]));
    }
    this.resolve?.(report);
    this.resolve = null;
  }
}

/** Camera pose at normalized progress `t` ∈ [0, 1] — piecewise-linear over the keyframes. */
export function samplePath(path: readonly BenchKeyframe[], t: number): BenchKeyframe {
  if (path.length === 1) {
    return path[0];
  }
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (path.length - 1);
  const index = Math.min(path.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const from = path[index];
  const to = path[index + 1];

  return { look: lerpVec(from.look, to.look, local), pos: lerpVec(from.pos, to.pos, local) };
}
