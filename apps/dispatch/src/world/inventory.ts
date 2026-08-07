/**
 * The 098/1-01 inventory: what a map view actually costs per frame, measured before anything is cut.
 *
 * Two rules this collector exists to satisfy, both from the plan:
 *
 * - **It cuts nothing and changes nothing.** Its whole output is a before-table. A step that measured and
 *   tuned in one pass would have no baseline left to compare against.
 * - **It states what it could NOT measure.** On a phone there is no `timestamp-query`, so every GPU pass
 *   time is zero — not cheap, *absent*. A report that prints `gpuPassMs 0.0` beside real CPU numbers is a
 *   report that will be read six months later as "the GPU was free", which is the exact failure the mobile
 *   benchmark schema was written to prevent (097/1-02).
 *
 * Frame cost has two halves and both are collected here: the engine's own per-frame stats (submit, GPU
 * passes when the adapter can time them, draws, triangles, residency) and the named spans for work that runs
 * BETWEEN frames (`frameSpans`) — cell collider builds, `.osm` parses, texture uploads. The console never
 * drained those before this mode existed, so anything they cost was invisible to it.
 */

import type { EngineStats, FrameSpanTotals } from '@opensa/engine';

/** One pass or cost centre, averaged over the sampled window. */
export interface InventoryPass {
  /** False when the adapter cannot produce this number at all — the value is then meaningless, not zero. */
  readonly available: boolean;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly name: string;
}

export interface InventoryReport {
  readonly build: string;
  readonly device: unknown;
  readonly district: string;
  readonly frame: {
    readonly dtMaxMs: number;
    readonly dtP50Ms: number;
    readonly dtP95Ms: number;
    readonly fps: number;
  };
  readonly frames: number;
  /** Per-frame cost centres, descending by mean. */
  readonly passes: readonly InventoryPass[];
  /** Between-frame named work, mean ms per sampled frame, descending. Empty means nothing was wrapped. */
  readonly spans: readonly (readonly [string, number])[];
  /** Human-readable reasons a column above is absent on this device. */
  readonly unavailable: readonly string[];
  readonly windowMs: number;
  readonly world: {
    readonly cellsTotal: number;
    readonly cellsVisible: number;
    readonly draws: number;
    readonly residencyMb: number;
    readonly triangles: number;
  };
}

/** The engine timings this collector averages, and whether each needs `timestamp-query` to mean anything. */
const TIMED: readonly (readonly [keyof EngineStats, boolean])[] = [
  ['submitMs', false],
  ['gpuPassMs', true],
  ['gpuPostMs', true],
  ['gpuProbeMs', true],
];

/**
 * Accumulates frames until asked for a report. Deliberately unbounded in time but bounded in memory: only
 * `dt` keeps every sample (it needs percentiles — a mean hides exactly the hitches this is looking for),
 * everything else folds into a running sum and max.
 */
export class FrameInventory {
  get frames(): number {
    return this.dts.length;
  }
  private readonly dts: number[] = [];
  private readonly maxima = new Map<string, number>();
  private readonly spanTotals = new Map<string, number>();
  private started = 0;
  private readonly sums = new Map<string, number>();

  private readonly worldLast = { cellsTotal: 0, cellsVisible: 0, draws: 0, residencyBytes: 0, triangles: 0 };

  report(context: { build: string; device: unknown; district: string; hasTimestamps: boolean }): InventoryReport {
    const sorted = [...this.dts].sort((a, b) => a - b);
    const frames = Math.max(1, this.dts.length);
    const windowMs = this.started === 0 ? 0 : performance.now() - this.started;

    const passes = TIMED.map(([key, needsTimestamps]) => ({
      available: !needsTimestamps || context.hasTimestamps,
      maxMs: this.maxima.get(key) ?? 0,
      meanMs: (this.sums.get(key) ?? 0) / frames,
      name: key,
    })).sort((a, b) => b.meanMs - a.meanMs);

    const unavailable = context.hasTimestamps
      ? []
      : [
          'gpuPassMs, gpuPostMs, gpuProbeMs — this adapter has no timestamp-query, so GPU time is not measurable at all',
        ];

    return {
      build: context.build,
      device: context.device,
      district: context.district,
      frame: {
        dtMaxMs: this.maxima.get('dt') ?? 0,
        dtP50Ms: percentile(sorted, 0.5),
        dtP95Ms: percentile(sorted, 0.95),
        fps: percentile(sorted, 0.5) > 0 ? Math.round(1000 / percentile(sorted, 0.5)) : 0,
      },
      frames: this.dts.length,
      passes,
      spans: [...this.spanTotals.entries()]
        .map(([name, ms]) => [name, ms / frames] as const)
        .sort((a, b) => b[1] - a[1]),
      unavailable,
      windowMs,
      world: {
        cellsTotal: this.worldLast.cellsTotal,
        cellsVisible: this.worldLast.cellsVisible,
        draws: this.worldLast.draws,
        residencyMb: this.worldLast.residencyBytes / (1024 * 1024),
        triangles: this.worldLast.triangles,
      },
    };
  }

  /** One frame. `spans` is the drain of the SAME frame — the loop drains at the top, per plan 091. */
  sample(dtMs: number, stats: EngineStats, spans: FrameSpanTotals): void {
    if (this.started === 0) {
      this.started = performance.now();
    }
    this.dts.push(dtMs);
    this.bump('dt', dtMs);
    for (const [key] of TIMED) {
      this.bump(key, stats[key]);
    }
    for (const [name, ms] of spans.byName) {
      this.spanTotals.set(name, (this.spanTotals.get(name) ?? 0) + ms);
    }
    this.worldLast.cellsTotal = stats.cellsTotal;
    this.worldLast.cellsVisible = stats.cellsVisible;
    this.worldLast.draws = stats.drawsRecorded;
    this.worldLast.residencyBytes = stats.residencyBytes;
    this.worldLast.triangles = stats.trianglesRecorded;
  }

  private bump(key: string, value: number): void {
    this.sums.set(key, (this.sums.get(key) ?? 0) + value);
    this.maxima.set(key, Math.max(this.maxima.get(key) ?? 0, value));
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));

  return sorted[index];
}
