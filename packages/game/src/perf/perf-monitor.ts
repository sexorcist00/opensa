import type { WebGLRenderer } from 'three';

/** Whole-run aggregate a benchmark capture produces (plan 063 harness). */
export interface PerfCapture {
  avgDrawCalls: number;
  avgMs: number;
  avgTriangles: number;
  fps: number;
  frames: number;
  p95Ms: number;
}

/** Rolling-window frame statistics for the perf HUD (plan 063). */
export interface PerfStats {
  /** Mean frame duration over the window, milliseconds. */
  avgMs: number;
  /** `renderer.info.render.calls` of the last sampled frame. */
  drawCalls: number;
  /** Frames per second derived from `avgMs`. */
  fps: number;
  /** `renderer.info.memory.geometries`. */
  geometries: number;
  /** 95th-percentile frame duration over the window, milliseconds. */
  p95Ms: number;
  /** Compiled shader programs alive. */
  programs: number;
  /** `renderer.info.memory.textures`. */
  textures: number;
  /** `renderer.info.render.triangles` of the last sampled frame. */
  triangles: number;
}

/** HUD stats window, seconds — long enough for a stable p95, short enough to react to toggles. */
const WINDOW_S = 2;

/**
 * Frame-time + `renderer.info` sampler (plan 063). Two independent consumers:
 * - the debug-overlay perf HUD reads {@link stats} over a rolling {@link WINDOW_S} window (`enabled` is set
 *   only while the panel is open — a hidden HUD costs nothing);
 * - the benchmark harness wraps a run in {@link beginCapture}/{@link endCapture} for whole-run aggregates.
 */
export class PerfMonitor {
  /** HUD sampling switch — leave `false` unless something reads {@link stats}. */
  enabled = false;

  private captureDraws = 0;
  private captureFrames: null | number[] = null;
  private captureTris = 0;
  private drawCalls = 0;
  private readonly durations: number[] = [];
  private durationSum = 0;
  private geometries = 0;
  private programs = 0;
  private textures = 0;
  private triangles = 0;

  /** Start collecting every frame into a run aggregate (implicitly samples even when `enabled` is off). */
  beginCapture(): void {
    this.captureFrames = [];
    this.captureDraws = 0;
    this.captureTris = 0;
  }

  /** Stop the capture and return its aggregate; `null` when no frames were collected. */
  endCapture(): null | PerfCapture {
    const frames = this.captureFrames;
    this.captureFrames = null;
    if (!frames || frames.length === 0) {
      return null;
    }
    const avgS = frames.reduce((sum, d) => sum + d, 0) / frames.length;

    return {
      avgDrawCalls: Math.round(this.captureDraws / frames.length),
      avgMs: avgS * 1000,
      avgTriangles: Math.round(this.captureTris / frames.length),
      fps: avgS > 0 ? 1 / avgS : 0,
      frames: frames.length,
      p95Ms: percentile(frames, 95) * 1000,
    };
  }

  /** Sample one frame (call once per render, AFTER `pipeline.render()` so `renderer.info` holds this frame). */
  frame(deltaS: number, renderer: WebGLRenderer): void {
    if ((!this.enabled && !this.captureFrames) || deltaS <= 0) {
      return;
    }
    const info = renderer.info;
    if (this.captureFrames) {
      this.captureFrames.push(deltaS);
      this.captureDraws += info.render.calls;
      this.captureTris += info.render.triangles;
    }
    if (!this.enabled) {
      return;
    }
    this.durations.push(deltaS);
    this.durationSum += deltaS;
    while (this.durationSum > WINDOW_S && this.durations.length > 1) {
      this.durationSum -= this.durations.shift() ?? 0;
    }
    this.drawCalls = info.render.calls;
    this.triangles = info.render.triangles;
    this.programs = info.programs?.length ?? 0;
    this.geometries = info.memory.geometries;
    this.textures = info.memory.textures;
  }

  /** Current rolling-window stats; `null` until at least one frame was sampled. */
  stats(): null | PerfStats {
    if (this.durations.length === 0) {
      return null;
    }
    const avgS = this.durationSum / this.durations.length;

    return {
      avgMs: avgS * 1000,
      drawCalls: this.drawCalls,
      fps: avgS > 0 ? 1 / avgS : 0,
      geometries: this.geometries,
      p95Ms: percentile(this.durations, 95) * 1000,
      programs: this.programs,
      textures: this.textures,
      triangles: this.triangles,
    };
  }
}

/** `p`-th percentile of an UNSORTED sample set (nearest-rank; copies before sorting). */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);

  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}
