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
  /** Reasons this capture may NOT be cited as a before-table. Empty = nothing obviously wrong with it.
   *  The first real capture (2026-08-07) was pasted, read and filed before anyone noticed it had streamed
   *  no cells at all — the numbers describe water over an empty world. A capture that says so itself is
   *  the cheapest possible guard against that. */
  readonly warnings: readonly string[];
  readonly windowMs: number;
  readonly world: {
    readonly cellsTotal: number;
    readonly cellsVisible: number;
    readonly draws: number;
    readonly residencyMb: number;
    readonly triangles: number;
  };
}

/** What `?district=` defaults to. Exported so the reader and the writer cannot drift apart — the check for
 *  "nobody named the district" is a string comparison, and a second copy of it would silently stop matching. */
export const UNNAMED_DISTRICT = 'unnamed — pass ?district=';

/** Frames below which a window is too short to carry a percentile. At the ~24 fps this device gives, 300 is
 *  about twelve seconds — long enough to be past the load and into steady state. */
const MIN_FRAMES = 300;

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
      warnings: warningsFor(this.worldLast.cellsTotal, this.dts.length, context.district),
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
      // The FIRST delta is not a frame time. It is measured against whatever the loop did last — page load,
      // the pak's first fetch, device init — so it enters dtMax and the percentiles as a frame that never
      // happened. The 2026-08-07 capture reported dtMaxMs 41026.5 inside a windowMs of 1590.4, which is the
      // arithmetic tell: a frame longer than the window it was sampled in. The world state is still taken
      // from this call, since it is a reading rather than an interval.
      this.started = performance.now();
      this.worldFrom(stats);

      return;
    }
    this.dts.push(dtMs);
    this.bump('dt', dtMs);
    for (const [key] of TIMED) {
      this.bump(key, stats[key]);
    }
    for (const [name, ms] of spans.byName) {
      this.spanTotals.set(name, (this.spanTotals.get(name) ?? 0) + ms);
    }
    this.worldFrom(stats);
  }

  private bump(key: string, value: number): void {
    this.sums.set(key, (this.sums.get(key) ?? 0) + value);
    this.maxima.set(key, Math.max(this.maxima.get(key) ?? 0, value));
  }

  /** The world figures are a READING of the latest frame, not an interval, so the skipped first sample still
   *  contributes them — a report asked for immediately then still says `cellsTotal: 0` rather than nothing. */
  private worldFrom(stats: EngineStats): void {
    this.worldLast.cellsTotal = stats.cellsTotal;
    this.worldLast.cellsVisible = stats.cellsVisible;
    this.worldLast.draws = stats.drawsRecorded;
    this.worldLast.residencyBytes = stats.residencyBytes;
    this.worldLast.triangles = stats.trianglesRecorded;
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));

  return sorted[index];
}

/** What makes a capture unusable as a before-table, in the order it bites. */
function warningsFor(cellsTotal: number, frames: number, district: string): string[] {
  const warnings: string[] = [];
  if (cellsTotal === 0) {
    warnings.push(
      'VOID: no cells streamed (cellsTotal 0) — these numbers describe an empty world. Wait for the world ' +
        'to arrive before taking a report.',
    );
  }
  if (frames < MIN_FRAMES) {
    warnings.push(`only ${frames} frames sampled — let it settle to at least ${MIN_FRAMES} before citing it`);
  }
  if (district === UNNAMED_DISTRICT) {
    warnings.push('district not named — pass ?district=<name>, 098/1-01 pins one and the row has to say which');
  }

  return warnings;
}
