/**
 * The 201/1-01 inventory: what a map view actually costs per frame, measured before anything is cut.
 *
 * Two rules this collector exists to satisfy, both from the plan:
 *
 * - **It cuts nothing and changes nothing.** Its whole output is a before-table. A step that measured and
 *   tuned in one pass would have no baseline left to compare against.
 * - **It states what it could NOT measure.** On a phone there is no `timestamp-query`, so every GPU pass
 *   time is zero — not cheap, *absent*. A report that prints `gpuPassMs 0.0` beside real CPU numbers is a
 *   report that will be read six months later as "the GPU was free", which is the exact failure the mobile
 *   benchmark schema was written to prevent (200/1-02).
 *
 * Frame cost has three halves — the third one added after the first real capture, which is the point of it:
 *
 * 1. the engine's own per-frame stats (submit, GPU passes when the adapter can time them, draws, triangles,
 *    residency);
 * 2. the named spans for work that runs BETWEEN frames (`frameSpans`) — cell collider builds, `.osm` parses,
 *    texture uploads. The console never drained those before this mode existed;
 * 3. **the CPU side of the loop body itself.** The 2026-08-07 mobile row came back with `submitMs` at 5.6 %
 *    of a 31.8 ms frame, no `timestamp-query` on the adapter, and empty spans — so 94 % of the frame had no
 *    owner at all. A chain asked to cut what is never read cannot work against that, and the missing number
 *    is not a GPU one: it is how much of the frame the main thread was even running. That is measurable on
 *    any device, which is why it is here rather than waiting for a GPU timer no phone offers.
 *
 * The third half answers one question the mobile row left open and could not settle: **is the frame slow
 * because work is being done, or is it waiting?** A body of 6 ms inside a 32 ms frame says the main thread
 * is idle for 26 of them and the cost is downstream (present, GPU, vsync); a body of 28 ms says the opposite.
 * The two have opposite fixes, and the report now carries the split instead of the argument.
 */

import type { EngineStats, FrameSpanTotals, PakTrafficKind, StreamStats } from '@opensa/engine';

import { DISTRICTS, PINNED_DISTRICT } from './districts';

/** The CPU cost of ONE loop body, measured by the host around its own frame. */
export interface FrameCpuSample {
  /** rAF callback start → end, ms: everything the host's main thread did for that frame. */
  readonly bodyMs: number;
  /** Named segments inside the body. Their sum is ≤ `bodyMs`; the remainder is untimed glue. */
  readonly segments: FrameSpanTotals;
}

/** Where the frame went on the CPU, averaged over the sampled window. */
export interface InventoryCpu {
  readonly bodyMaxMs: number;
  /** Mean ms spent inside the rAF callback. */
  readonly bodyMeanMs: number;
  /** Mean dt − mean body: the part of the frame the main thread was NOT running. Present, GPU backpressure,
   *  vsync wait, other tasks and GC all live in here, and nothing on this device can separate them further —
   *  the number's value is that it says how much room there is to separate. */
  readonly outsideMeanMs: number;
  /** Mean ms per sampled frame, descending. `other` is body time no segment claimed. */
  readonly segmentsMs: readonly (readonly [string, number])[];
  /** Body mean ÷ dt mean, 0..1. */
  readonly shareOfFrame: number;
  /** The WORST body of the window, with its own segment breakdown rather than the window's averages. Two
   *  captures in a row made the worst frame the interesting one, and a mean cannot answer which part of it
   *  grew — 1068 ms of body says nothing about whether it was the render, the overlay or the streamer. */
  readonly worstFrame: { readonly bodyMs: number; readonly segmentsMs: readonly (readonly [string, number])[] };
}

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
  /** What this surface actually READ out of the pak, by entry kind — wire bytes and request counts, live
   *  since boot rather than over the sampled window. The build's `report.json` says what the pak CONTAINS;
   *  the gap between the two is what 201/1 is for, and an entry kind absent from this list is one no frame
   *  of this surface ever asked for. */
  readonly bytes: {
    readonly byKind: readonly PakTrafficKind[];
    readonly requests: number;
    readonly totalBytes: number;
  };
  /** Where the operator was when they took the report — so the capture states its own ground. */
  readonly camera: { readonly at: readonly [number, number]; readonly height: number };
  readonly cpu: InventoryCpu;
  readonly device: unknown;
  readonly district: string;
  /** The page's own errors during the capture (see `error-log.ts`) — a phone has no devtools to read. */
  readonly errors: readonly string[];
  readonly frame: {
    /** dt counts per 2 ms bin, ascending, empty bins omitted. A frame waiting on a 60 Hz vsync piles into
     *  the bins around 16.7 and 33.3; a frame that is simply slow spreads. The two look identical in a p50
     *  and have opposite fixes, which is the whole reason the shape is kept. */
    readonly dtHistogramMs: readonly (readonly [number, number])[];
    readonly dtMaxMs: number;
    readonly dtMeanMs: number;
    readonly dtP50Ms: number;
    readonly dtP95Ms: number;
    readonly fps: number;
  };
  readonly frames: number;
  /** Per-frame cost centres, descending by mean. */
  readonly passes: readonly InventoryPass[];
  /** Between-frame named work, mean ms per sampled frame, descending. Empty means nothing was wrapped. */
  readonly spans: readonly (readonly [string, number])[];
  /** What the streamer did over the window — the engine's own numbers, which the console used to drop. */
  readonly streaming: InventoryStreaming;
  /** What the frame was DRAWN AT. The `target` category below is a cost of resolution and of nothing else —
   *  36.54 MB of the 2026-08-12 capture's 74.9, larger than every texture in the district — and until this
   *  block existed a capture could not be read for it at all: the CSS size, the DPR and the render scale
   *  were sentences somebody wrote by hand afterwards. An A/B must be self-describing (`CLAUDE.md`). */
  readonly surface: {
    readonly cssHeight: number;
    readonly cssWidth: number;
    /** The drawing buffer, device pixels — what the swapchain and the post pass are sized at. */
    readonly deviceHeight: number;
    readonly deviceWidth: number;
    readonly dpr: number;
    /** `?scale=` — the engine's own knob, which shrinks the scene and bloom targets (never the swapchain). */
    readonly renderScale: number;
  };
  /**
   * What the SYMBOLOGY layer was carrying — a reading of the last frame before the report was taken, like
   * `world` below rather than a mean, because the counts are a property of the board and the camera rather
   * than of the interval.
   *
   * The block exists because 201/1-01 measured `overlay-2d` at **2.44 ms, the largest item in the body and
   * more than `engine-frame`'s 2.10** — while drawing NINE units. Read alone that number says nothing: the
   * declared worst case is 150 (201's budget table), and a capture that does not state its symbol count
   * cannot be compared with one taken at a different zoom, let alone at a different load. `?units=` and
   * `?calls=` set the load; this says what arrived on screen.
   */
  readonly symbology: {
    /** Markers the largest beacon set is allocated for. */
    readonly beaconCapacity: number;
    /** Times a beacon set has been GROWN past its allocation since boot. Non-zero is not a fault — it is the
     *  board going past the declared budget and the map still drawing every unit — but it is a number the
     *  budget table wants to hear about. */
    readonly beaconGrowths: number;
    readonly chips: number;
    /** Chips dropped for depth — the only decluttering this layer does today (3/03 owns the real rule). */
    readonly chipsDropped: number;
    readonly incidents: number;
    /** `measureText` calls on that frame. 0 with a warm width cache, whatever the symbol count; one per
     *  label the layer had never drawn before. A capture where this tracks `chips` is one where the cache
     *  is not working. */
    readonly measures: number;
    readonly symbols: number;
    readonly units: number;
  };
  /**
   * What the TIME AXIS is holding (201/8-01) — host bytes, samples, and the window a scrub may ask for.
   * Null when the host passed no board (an embedding with no dispatch state).
   *
   * Kept out of `world.residencyMb` on purpose: that ledger counts GPU bytes and this is JS heap, the same
   * distinction 5/01 drew for `pickingMb`. A capture that adds them together is one that charges a track
   * against a texture budget.
   */
  readonly tracks: {
    readonly bytes: number;
    readonly capacity: number;
    readonly samples: number;
    readonly tracks: number;
    /** Oldest → newest sample time held, ms. */
    readonly window: null | readonly [number, number];
  } | null;
  /** Human-readable reasons a column above is absent on this device. */
  readonly unavailable: readonly string[];
  /** Reasons this capture may NOT be cited as a before-table. Empty = nothing obviously wrong with it.
   *  The first real capture (2026-08-07) was pasted, read and filed before anyone noticed it had streamed
   *  no cells at all — the numbers describe water over an empty world. A capture that says so itself is
   *  the cheapest possible guard against that. */
  readonly warnings: readonly string[];
  readonly windowMs: number;
  readonly world: {
    /** Resident GPU bytes BY CATEGORY, from the engine's own ledger — `texture`, `cellVertex`, `cellIndex`,
     *  `target` (the render targets, a cost of RESOLUTION rather than of content), `uniform`. The 08-09
     *  capture reported 148 MB against a pak whose whole texture ceiling is 99.7, and the 48 MB difference
     *  had no owner; the engine has counted it by category since 074/01 and the console was not asking. */
    readonly byCategoryMb: readonly (readonly [string, number])[];
    readonly cellsTotal: number;
    readonly cellsVisible: number;
    readonly draws: number;
    /** What click-to-inspect is costing, HOST megabytes (`engine.cells.pickingBytes`): the placement mapper
     *  plus the index bytes retained with it. It is NOT part of `residencyMb` — that ledger counts GPU
     *  bytes — and it is here because 201/5-01 asks for this number measured on a real district rather than
     *  estimated. The console arms picking at boot, so a capture always carries the cost of its own best
     *  feature instead of leaving it to be discovered when a budget is blown. */
    readonly pickingMb: number;
    readonly residencyMb: number;
    readonly triangles: number;
  };
}

/** The streaming work the ENGINE times for itself, kept because the console used to discard it.
 *
 *  `blobMs` is the worker's message handler — decode and `createTexture` — which runs BETWEEN frames where no
 *  in-loop timer can see it; `uploadMs` is the budgeted drain inside `update`. The game shell has read these
 *  since 2026-07-27, when a field report of 20-250 ms frames turned out to be whole-array uploads at 15-85 ms
 *  a call, invisible to every block the host timed. The map profile's first two captures reported a 185 ms
 *  and a 1068 ms body with no owner, which is the same shape of question. */
export interface InventoryStreaming {
  readonly blobMeanMs: number;
  /** Cells created SINCE THE PAGE BOOTED, not over the sampled window — the driver keeps this as a running
   *  total and the collector reads it. The collector starts with the page, so the two are the same span in
   *  practice, and boot's own creates are inside it by design. */
  readonly cellsCreated: number;
  readonly cellsEvicted: number;
  /** Creates whose cell was already inside the fog cut — each one a visible pop. Since boot, like
   *  {@link cellsCreated}. */
  readonly lateCreates: number;
  readonly uploadMeanMs: number;
  /** The single most expensive worker-handler call in the window: one huge upload and a pile-up of small
   *  ones are different problems, and only this tells them apart. */
  readonly worstBlobMs: number;
  readonly worstCreateMs: number;
}

/** What `?district=` defaults to. Exported so the reader and the writer cannot drift apart — the check for
 *  "nobody named the district" is a string comparison, and a second copy of it would silently stop matching. */
export const UNNAMED_DISTRICT = 'unnamed — pass ?district=';

/** Frames below which a window is too short to carry a percentile. At the ~24 fps this device gives, 300 is
 *  about twelve seconds — long enough to be past the load and into steady state. */
const MIN_FRAMES = 300;

/** dt histogram bin width, ms. Half a 60 Hz vsync interval: fine enough that 16.7 and 33.3 land in
 *  different bins from anything either side of them, coarse enough that the JSON stays readable. */
const BIN_MS = 2;
/** Everything at or above this lands in one tail bin — a 300 ms hitch must not open 150 empty bins. */
const BIN_TAIL_MS = 100;

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
  private readonly bins = new Map<number, number>();
  private readonly cpuTotals = new Map<string, number>();
  private readonly dts: number[] = [];
  private readonly maxima = new Map<string, number>();
  private readonly spanTotals = new Map<string, number>();
  private started = 0;
  private readonly stream = {
    blobMs: 0,
    created: 0,
    evicted: 0,
    lateCreates: 0,
    uploadMs: 0,
    worstBlobMs: 0,
    worstCreateMs: 0,
  };
  private readonly sums = new Map<string, number>();
  private readonly worldLast = { cellsTotal: 0, cellsVisible: 0, draws: 0, residencyBytes: 0, triangles: 0 };

  /** The worst body seen, kept WITH its own segments — the mean cannot say which part of it grew. */
  private worst: { bodyMs: number; segmentsMs: readonly (readonly [string, number])[] } = { bodyMs: 0, segmentsMs: [] };

  report(context: {
    build: string;
    /** `engine.ledger()` — resident bytes and counts per category. */
    byCategory: Readonly<Record<string, { bytes: number; count: number }>>;
    bytes: { byKind: readonly PakTrafficKind[]; requests: number; totalBytes: number };
    camera: { at: readonly [number, number]; height: number };
    device: unknown;
    district: string;
    errors: readonly string[];
    hasTimestamps: boolean;
    /** `engine.cells.pickingBytes` — the host cost of the placement mapper the console picks against. */
    pickingBytes: number;
    surface: InventoryReport['surface'];
    symbology: InventoryReport['symbology'];
    tracks: InventoryReport['tracks'];
  }): InventoryReport {
    const sorted = [...this.dts].sort((a, b) => a - b);
    const frames = Math.max(1, this.dts.length);
    const windowMs = this.started === 0 ? 0 : performance.now() - this.started;
    const dtMeanMs = (this.sums.get('dt') ?? 0) / frames;
    const bodyMeanMs = (this.sums.get('cpu-body') ?? 0) / frames;

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
      bytes: context.bytes,
      camera: { at: context.camera.at, height: context.camera.height },
      cpu: {
        bodyMaxMs: this.maxima.get('cpu-body') ?? 0,
        bodyMeanMs,
        outsideMeanMs: Math.max(0, dtMeanMs - bodyMeanMs),
        segmentsMs: this.cpuSegments(frames, bodyMeanMs),
        shareOfFrame: dtMeanMs > 0 ? bodyMeanMs / dtMeanMs : 0,
        worstFrame: this.worst,
      },
      device: context.device,
      district: context.district,
      errors: context.errors,
      frame: {
        dtHistogramMs: [...this.bins.entries()].sort((a, b) => a[0] - b[0]),
        dtMaxMs: this.maxima.get('dt') ?? 0,
        dtMeanMs,
        dtP50Ms: percentile(sorted, 0.5),
        dtP95Ms: percentile(sorted, 0.95),
        fps: percentile(sorted, 0.5) > 0 ? Math.round(1000 / percentile(sorted, 0.5)) : 0,
      },
      frames: this.dts.length,
      passes,
      spans: [...this.spanTotals.entries()]
        .map(([name, ms]) => [name, ms / frames] as const)
        .sort((a, b) => b[1] - a[1]),
      streaming: {
        blobMeanMs: this.stream.blobMs / frames,
        cellsCreated: this.stream.created,
        cellsEvicted: this.stream.evicted,
        lateCreates: this.stream.lateCreates,
        uploadMeanMs: this.stream.uploadMs / frames,
        worstBlobMs: this.stream.worstBlobMs,
        worstCreateMs: this.stream.worstCreateMs,
      },
      surface: context.surface,
      symbology: context.symbology,
      tracks: context.tracks,
      unavailable,
      warnings: warningsFor({
        bodyMeanMs,
        cellsTotal: this.worldLast.cellsTotal,
        district: context.district,
        frames: this.dts.length,
      }),
      windowMs,
      world: {
        byCategoryMb: Object.entries(context.byCategory)
          .filter(([, entry]) => entry.bytes > 0)
          .map(([category, entry]) => [category, entry.bytes / (1024 * 1024)] as const)
          .sort((a, b) => b[1] - a[1]),
        cellsTotal: this.worldLast.cellsTotal,
        cellsVisible: this.worldLast.cellsVisible,
        draws: this.worldLast.draws,
        pickingMb: context.pickingBytes / (1024 * 1024),
        residencyMb: this.worldLast.residencyBytes / (1024 * 1024),
        triangles: this.worldLast.triangles,
      },
    };
  }

  /**
   * One frame.
   *
   * `spans` is the drain of the SAME frame — the loop drains at the top, per plan 091. `cpu` is the
   * PREVIOUS loop body, and that is arithmetic rather than taste: `dt` runs from one rAF start to the next,
   * so the body that ran inside the interval being reported is the one before it. Paired that way the body
   * can never exceed the frame it is a share of.
   */
  sample(dtMs: number, stats: EngineStats, spans: FrameSpanTotals, cpu: FrameCpuSample, stream: StreamStats): void {
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
    const bin = dtMs >= BIN_TAIL_MS ? BIN_TAIL_MS : Math.floor(dtMs / BIN_MS) * BIN_MS;
    this.bins.set(bin, (this.bins.get(bin) ?? 0) + 1);
    this.bump('cpu-body', cpu.bodyMs);
    for (const [name, ms] of cpu.segments.byName) {
      this.cpuTotals.set(name, (this.cpuTotals.get(name) ?? 0) + ms);
    }
    if (cpu.bodyMs > this.worst.bodyMs) {
      this.worst = { bodyMs: cpu.bodyMs, segmentsMs: cpu.segments.byName };
    }
    // Only HALF the streamer's numbers are per-update. `blobMs` is reset every update and `uploadMs` is
    // assigned every update, so those two sum like the spans do; `created`, `evicted` and `lateCreates` are
    // RUNNING TOTALS the driver never resets, so they are READ. Summing them added the whole history to
    // every later frame — the 2026-08-12 capture reported 2454 creates against 4 resident cells and 0
    // evictions, which is 4 creates counted once per frame for the rest of a 685-frame window.
    // The two worsts are kept rather than averaged: one 85 ms upload and twenty 4 ms ones are different
    // problems, and both are running maxima, so a max over the samples is the same number either way.
    this.stream.blobMs += stream.blobMs;
    this.stream.uploadMs += stream.uploadMs;
    this.stream.created = stream.created;
    this.stream.evicted = stream.evicted;
    this.stream.lateCreates = stream.lateCreates;
    this.stream.worstBlobMs = Math.max(this.stream.worstBlobMs, stream.worstBlobMs);
    this.stream.worstCreateMs = Math.max(this.stream.worstCreateMs, stream.worstCreateMs);
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

  /** The named segments plus `other` — the body time nobody claimed. Without that row the breakdown looks
   *  complete while summing to less than the body, which is the same lie as printing an absent GPU as zero. */
  private cpuSegments(frames: number, bodyMeanMs: number): readonly (readonly [string, number])[] {
    const segments = [...this.cpuTotals.entries()].map(([name, ms]) => [name, ms / frames] as const);
    const claimed = segments.reduce((sum, [, ms]) => sum + ms, 0);

    return [...segments, ['other', Math.max(0, bodyMeanMs - claimed)] as const].sort((a, b) => b[1] - a[1]);
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
function warningsFor(capture: { bodyMeanMs: number; cellsTotal: number; district: string; frames: number }): string[] {
  const { bodyMeanMs, cellsTotal, district, frames } = capture;
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
    warnings.push('district not named — pass ?district=<name>, 201/1-01 pins one and the row has to say which');
  } else if (district !== PINNED_DISTRICT) {
    // The 2026-08-07 row said this in a paragraph somebody had to write by hand AFTER the capture was filed.
    // A capture that says it itself is the difference between a caught mistake and a session of archaeology.
    const known = district in DISTRICTS ? '' : ' (and it is not a district this build knows at all)';
    warnings.push(
      `taken on '${district}'${known}, not on '${PINNED_DISTRICT}' which 201/1-01 pinned — a valid ` +
        "measurement of that ground, and NOT part of this chain's before/after series",
    );
  }
  if (frames > 0 && bodyMeanMs === 0) {
    warnings.push(
      'the host did not time its loop body, so the CPU/outside split is meaningless here — read shareOfFrame ' +
        'as absent, never as "the CPU was free"',
    );
  }

  return warnings;
}
