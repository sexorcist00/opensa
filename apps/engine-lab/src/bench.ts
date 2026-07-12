/**
 * Bench harness (plan 074/11): deterministic scripted cameras + a warmup/measure loop + a downloadable JSON
 * record. Numbers are comparable across engine versions ONLY because the scene scripts and the collection
 * windows are pinned here — do not tweak them casually (that invalidates the committed series).
 */
import type { CameraState, EngineStats } from '@opensa/engine';

export const BENCH_WARMUP_FRAMES = 120;
export const BENCH_MEASURE_FRAMES = 600;

export type BenchCameraScript = (frame: number, context: BenchContext) => CameraState;

export interface BenchContext {
  aspect: number;
  focus: readonly [number, number, number];
  radius: number;
}

/** Pinned scenes. `orbit` = the M0 baseline; `close` = fill/A2C zoom; `drive` = the streaming stress
 *  (focus translates through the district — pairs with the M1 streaming driver). */
export const BENCH_SCENES: Record<string, BenchCameraScript> = {
  close(frame, { aspect, focus, radius }) {
    // Far → close zoom onto the district centre over the run (fill-rate + alpha inspection distances).
    const t = frame / (BENCH_WARMUP_FRAMES + BENCH_MEASURE_FRAMES);
    const r = radius * (1 - t * 0.96) + 8;
    const angle = 0.8;

    return camera(
      aspect,
      [focus[0] + Math.cos(angle) * r, focus[1] + r * 0.35 + 3, focus[2] + Math.sin(angle) * r],
      focus,
    );
  },
  drive(frame, { aspect, focus, radius }) {
    // Street-height translation across the district at ~drive speed (frame-indexed → deterministic).
    const speed = 0.9; // engine units per frame ≈ 54 u/s at 60 fps
    const x = focus[0] - radius + frame * speed;
    const eye: [number, number, number] = [x, focus[1] + 18, focus[2] + 40];

    return camera(aspect, eye, [x + 60, focus[1] + 4, focus[2] - 20]);
  },
  orbit(frame, { aspect, focus, radius }) {
    const angle = frame * 0.003;

    return camera(
      aspect,
      [focus[0] + Math.cos(angle) * radius, focus[1] + radius * 0.42, focus[2] + Math.sin(angle) * radius],
      focus,
    );
  },
};

export interface BenchRecord {
  date: string;
  draws: { avg: number; max: number };
  env: { adapter: string; dpr: number; height: number; search: string; width: number };
  frameMs: { avg: number; max: number; p50: number; p95: number };
  gpuPassMs: { avg: number; max: number; p95: number };
  heapMb: number;
  measuredFrames: number;
  residencyMb: number;
  scene: string;
  submitMs: { avg: number; max: number; p95: number };
}

/** Collects per-frame samples after warmup; `finish()` computes the record. */
export class BenchCollector {
  get currentFrame(): number {
    return this.frame;
  }
  /** True while more frames are needed. */
  get running(): boolean {
    return this.frame < BENCH_WARMUP_FRAMES + BENCH_MEASURE_FRAMES;
  }
  private readonly draws: number[] = [];
  private frame = 0;
  private readonly frameMs: number[] = [];
  private readonly gpu: number[] = [];

  private lastStats: EngineStats | null = null;

  private readonly submit: number[] = [];

  finish(scene: string, adapter: string, canvas: HTMLCanvasElement): BenchRecord {
    const heap = (performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;

    return {
      date: new Date().toISOString(),
      draws: { avg: avg(this.draws), max: Math.max(0, ...this.draws) },
      env: {
        adapter,
        dpr: window.devicePixelRatio,
        height: canvas.height,
        search: window.location.search,
        width: canvas.width,
      },
      frameMs: {
        avg: avg(this.frameMs),
        max: Math.max(0, ...this.frameMs),
        p50: percentile(this.frameMs, 50),
        p95: percentile(this.frameMs, 95),
      },
      gpuPassMs: { avg: avg(this.gpu), max: Math.max(0, ...this.gpu), p95: percentile(this.gpu, 95) },
      heapMb: Math.round(heap / (1024 * 1024)),
      measuredFrames: this.frameMs.length,
      residencyMb: Math.round((this.lastStats?.residencyBytes ?? 0) / (1024 * 1024)),
      scene,
      submitMs: { avg: avg(this.submit), max: Math.max(0, ...this.submit), p95: percentile(this.submit, 95) },
    };
  }

  sample(frameDtMs: number, stats: EngineStats): void {
    this.frame += 1;
    this.lastStats = stats;
    if (this.frame <= BENCH_WARMUP_FRAMES) {
      return;
    }
    this.frameMs.push(frameDtMs);
    this.submit.push(stats.submitMs);
    this.gpu.push(stats.gpuPassMs);
    this.draws.push(stats.drawsRecorded);
  }
}

/** Trigger a JSON download of the record (the committed-series artifact). */
export function downloadRecord(record: BenchRecord): void {
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `bench-${record.scene}-${record.date.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

export function formatRecord(record: BenchRecord): string {
  const f = record.frameMs;

  return (
    `BENCH ${record.scene} — DONE (${record.measuredFrames} frames)\n` +
    `frame       avg ${f.avg.toFixed(2)} p50 ${f.p50.toFixed(2)} p95 ${f.p95.toFixed(2)} max ${f.max.toFixed(1)} ms\n` +
    `submit CPU  avg ${record.submitMs.avg.toFixed(2)} p95 ${record.submitMs.p95.toFixed(2)} max ${record.submitMs.max.toFixed(2)} ms\n` +
    `GPU pass    avg ${record.gpuPassMs.avg.toFixed(2)} p95 ${record.gpuPassMs.p95.toFixed(2)} max ${record.gpuPassMs.max.toFixed(2)} ms\n` +
    `draws       avg ${record.draws.avg.toFixed(0)} max ${record.draws.max}\n` +
    `residency   ${record.residencyMb} MB · heap ${record.heapMb} MB\n` +
    `JSON downloaded — commit it per the 074/11 ritual`
  );
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function camera(aspect: number, eye: [number, number, number], target: readonly [number, number, number]): CameraState {
  return { aspect, eye, far: 10000, fovYRad: Math.PI / 3, near: 0.5, target, up: [0, 1, 0] };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
