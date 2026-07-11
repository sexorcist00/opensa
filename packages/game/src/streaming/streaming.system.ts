import type { Object3D } from 'three';

import type { System } from '../core/system';
import type { Config } from '../interfaces/config.interface';
import type { Vec3, WorldAdapter } from '../interfaces/world-adapter.interface';
import type { CellCoord } from './grid';

import { CellFader } from './fade';
import { cellDistanceSq, cellOf, cellsWithin } from './grid';

/** Renderer-side hooks (plan 060 Phases 4 + round 3), injected by the host — absent in headless tests. */
export interface GpuHooks {
  /** WebGPU (docs/concepts/webgpu-migration): pipelines compile NATIVELY on an object's first draw, so an atomic
   *  cell appearance stacks dozens of native compiles into one frame — the camera-move freeze (profiled as
   *  System-dominated 100 ms+ tasks). >0 spreads the appearance to this many objects per frame, amortizing the
   *  compiles. Unset/0 = the plan-060 atomic appearance (WebGL). */
  appearPerFrame?: number;
  /** WebGPU spike: a fresh per-cell container (a `BundleGroup`) — a cell's objects go inside it so the renderer
   *  records the cell's draws once and replays them (docs/concepts/webgpu-migration). Absent → objects add to root. */
  cellContainer?(): Object3D;
  /** Compile shader programs + upload textures for a built batch (renderer.compileAsync). */
  precompile?(objects: readonly Object3D[]): Promise<void>;
  /** Force the first-draw geometry uploads of a slice, invisibly (1×1 scissored render). */
  warmUp?(objects: readonly Object3D[]): void;
}

interface ManualSelection {
  cells: CellCoord[];
  lod: boolean;
}

/** What the streaming system needs from the world adapter. */
type StreamAdapter = Pick<WorldAdapter, 'cellSize' | 'loadCell'>;

/** Hysteresis dead-band as a fraction of the cell size: a cell keeps its current detail level until
 *  the view moves this much past the ring boundary, so straddling it doesn't flip-flop LOD↔HD. */
const HYSTERESIS = 0.25;

/** Velocity lookahead (plan 060 Phase 1): prefetch keys around `view + v̂·min(speed·T, cellSize)` so a
 *  first-visit cell builds BEFORE the boundary is crossed and the swap is a cache hit. */
const LOOKAHEAD_SECONDS = 3;

/** Per-frame TIME budget for invisible GPU warming (plan 060, round 4): a fixed 24-obj slice just moved
 *  the ~40–58 ms upload stall from the appearance frame into the warm frame. Warming is invisible, so
 *  spreading it thinner is free — warm object-by-object and stop once the frame spent this much. */
const WARM_BUDGET_MS = 3;

/** Hard cap on objects warmed per frame — keeps warm pacing deterministic when uploads are instant
 *  (headless tests, cached resources) and bounds the per-object render-call overhead. */
const WARM_PER_FRAME = 24;

/** Warm frames that cost more than this get logged (plan 060 measurement). */
const WARM_LOG_MS = 8;

/** WebGPU chunked bundle wrap: objects per small BundleGroup — each record's full per-object update pass stays
 *  a few ms (Phase-1a: record cost scales with the bundle's own draw count, not the world). */
const WRAP_CHUNK = 64;

/**
 * Streams map cells in/out of the streaming root as the view moves. Two modes:
 * - **stream** (default): cells within `hdDrawDistance` render HD, cells within
 *   `lodDrawDistance` (beyond the HD ring) render LOD — the sectioned grid.
 * - **manual** (debug): renders only the cells set via {@link setManualCells} at
 *   one detail level. Active while `config.mapViewer` is on and a selection is set.
 *
 * **Seamless LOD↔HD swap:** the two detail levels of a cell are separate keys
 * (`cx,cy,hd` / `cx,cy,lod`). When a cell changes level the OLD level is kept
 * rendering until the NEW one has loaded and been added (the load handler then
 * removes the old in the same step) — so there's never an empty frame, and the
 * new level appears at full opacity (no fade). Only genuinely new cells fade in.
 * A {@link HYSTERESIS} dead-band stops the level flip-flopping at the boundary.
 *
 * Cells are loaded asynchronously via the adapter (which caches them) and added
 * under the streaming root (Z-up; the root applies the −90°X).
 */
export class StreamingSystem implements System {
  readonly name = 'streaming';

  private readonly adapter: StreamAdapter;
  private readonly config: Readonly<Config>;
  /** WebGPU: the per-cell `BundleGroup`s a cell's objects live in (chunked — several small bundles per cell so
   *  each record stays cheap); removal drops the groups, not each object. */
  private readonly containers = new Map<string, Object3D[]>();
  private current = new Set<string>();
  private readonly fader = new CellFader();
  private readonly gpu: GpuHooks;
  /** Built cells whose meshes are still being added under the frame budget (plan 060 Phase 2). */
  private readonly ingesting = new Map<string, { added: number; objects: Object3D[]; wrapped: number }>();
  private lastView: null | Vec3 = null;
  private readonly loaded = new Map<string, Object3D[]>();
  private readonly loading = new Set<string>();
  private manual: ManualSelection | null = null;
  /** Keys added last frame — their NEXT frame delta is the GPU-upload hump (plan 060 Phase 0). */
  private postAddWatch: null | string = null;
  private readonly root: Object3D;
  private velocity: Vec3 = [0, 0, 0];
  /** The current view ring's keys (no lookahead) — the readiness set for {@link settled} (plan 061). */
  private viewKeys = new Set<string>();
  private readonly viewOf: () => Vec3;

  constructor(
    adapter: StreamAdapter,
    root: Object3D,
    viewOf: () => Vec3,
    config: Readonly<Config>,
    gpu: GpuHooks = {},
  ) {
    this.adapter = adapter;
    this.root = root;
    this.viewOf = viewOf;
    this.config = config;
    this.gpu = gpu;
  }

  /** How much of the view ring is on screen — for a loading veil (plan 061). */
  progress(): { loaded: number; total: number } {
    let loaded = 0;
    for (const key of this.viewKeys) {
      if (this.loaded.has(key)) {
        loaded += 1;
      }
    }

    return { loaded, total: this.viewKeys.size };
  }

  /** Debug: render an explicit set of cells at one detail level (null resumes streaming). */
  setManualCells(cells: CellCoord[] | null, lod = false): void {
    this.manual = cells ? { cells, lod } : null;
  }

  /**
   * Whether the CURRENT VIEW ring is fully on screen (plan 061): every view-ring key loaded (built +
   * warmed + atomically added), none still loading/ingesting. Lookahead prefetch keys are ignored —
   * though while MOVING, an in-flight prefetch cell can be adopted into the view ring by the hysteresis
   * margin and briefly unsettle it; the freeze use case has zero velocity, so this never affects it.
   * Meaningless (always true) in manual/map-viewer mode — the debug view never gates readiness.
   */
  settled(): boolean {
    if (this.config.mapViewer && this.manual) {
      return true;
    }
    if (this.viewKeys.size === 0) {
      return false; // no update ran yet — the world cannot be ready
    }
    for (const key of this.viewKeys) {
      if (!this.loaded.has(key)) {
        return false;
      }
    }

    return true;
  }

  update(delta = 0): void {
    if (this.postAddWatch !== null) {
      // Phase 0: the frame AFTER a cell entered the scene carries its GPU upload + shader compile.
      if (delta > 0.03) {
        // eslint-disable-next-line no-console -- plan 060 Phase 0 measurement: GPU-upload hump attribution
        console.log(`[stream] post-add frame ${(delta * 1000).toFixed(0)}ms (${this.postAddWatch})`);
      }
      this.postAddWatch = null;
    }
    this.trackVelocity(delta);
    this.fader.update(delta);
    this.drainIngest();
    this.current = this.desiredKeys();
    // Load desired-but-missing cells (async; the handler queues them for the budgeted ingest).
    for (const key of this.current) {
      if (!this.loaded.has(key) && !this.loading.has(key) && !this.ingesting.has(key)) {
        this.load(key);
      }
    }
    // Remove cells that left the view — but keep an old detail level while its same-cell replacement
    // is still loading or ingesting, so the swap never leaves a hole.
    const pendingCells = new Set([...this.loading, ...this.ingesting.keys()].map(cellOfKey));
    for (const [key, objects] of this.loaded) {
      if (this.current.has(key) || pendingCells.has(cellOfKey(key))) {
        continue;
      }
      this.remove(key, objects);
    }
  }

  /** The grid cell the current view is in (for the debug section inspector). */
  viewCell(): CellCoord {
    return cellOf(this.viewOf(), this.adapter.cellSize);
  }

  /** WebGPU budgeted appearance: add up to `budget` of the batch's remaining objects; returns how many appeared.
   *  Culling is disabled AT APPEARANCE: a culled object defers its first-draw pipeline compile until the camera
   *  turns onto it — a compile-storm lag spike exactly when looking around. Paying the compile now, under the
   *  budget, keeps frames deterministic (the wrap into a static bundle needs culling off anyway). */
  private appearSlice(batch: { added: number; objects: Object3D[] }, budget: number): number {
    let appeared = 0;
    while (batch.added < batch.objects.length && appeared < budget) {
      const object = batch.objects[batch.added];
      object.traverse((child) => (child.frustumCulled = false));
      this.root.add(object);
      batch.added += 1;
      appeared += 1;
    }

    return appeared;
  }

  /** Atomic appearance: the whole cell enters the scene in one step — into a per-cell BundleGroup (record-once)
   *  under WebGPU bundles, else straight to the root. */
  private attachCell(key: string, objects: readonly Object3D[]): void {
    const container = this.gpu.cellContainer?.();
    if (!container) {
      objects.forEach((object) => this.root.add(object));

      return;
    }
    container.frustumCulled = false;
    objects.forEach((object) => {
      // A static BundleGroup bakes frustum culling at RECORD time — a child culled when the bundle records
      // stays absent forever. Disable per-child culling so every cell object is recorded + replayed. Streaming
      // already bounds the loaded set to the view ring, so drawing all loaded cells is acceptable.
      object.traverse((child) => (child.frustumCulled = false));
      container.add(object);
    });
    this.root.add(container);
    // Force the bundle to (re)record now that the cell's objects are in it — a BundleGroup added to an
    // already-live scene otherwise may never record its draws (three records what's present up front).
    (container as unknown as { needsUpdate: boolean }).needsUpdate = true;
    this.containers.set(key, [container]);
  }

  private desiredKeys(): Set<string> {
    if (this.config.mapViewer && this.manual) {
      return new Set(this.manual.cells.map(([cx, cy]) => streamKey(cx, cy, this.manual!.lod)));
    }

    return this.streamKeys();
  }

  /** Rounds 2–4: GPU-warm queued cells invisibly (object-by-object under a per-frame time budget, so a
   *  heavy upload ends the frame's warming instead of stacking with the next one), then add each cell
   *  ATOMICALLY once fully warm — uploads never land on the appearance frame, and nothing assembles
   *  piece-by-piece on screen. */
  private drainIngest(): void {
    if (this.ingesting.size === 0) {
      return;
    }
    const start = performance.now();
    let count = WARM_PER_FRAME;
    let warmed = 0;
    let appearedThisFrame = 0; // WebGPU budgeted appearance — one budget across all ingesting cells
    const overBudget = (): boolean => count <= 0 || performance.now() - start >= WARM_BUDGET_MS;
    const spend = (): boolean => {
      count -= 1;
      warmed += 1;

      return overBudget();
    };
    for (const [key, batch] of this.ingesting) {
      if (this.gpu.warmUp && !this.warmBatch(batch, spend)) {
        this.logWarm(start, warmed);

        return; // budget spent — continue this cell next frame (at least one object always warms per frame)
      }
      // WebGPU budgeted appearance: add at most `appearPerFrame` objects per frame so their first-draw pipeline
      // compiles amortize across frames instead of freezing one. The cell's `added` counter carries progress
      // (the warm loop is skipped under WebGPU, so the counter is free); the swap finalizes only when complete —
      // the old detail level keeps rendering meanwhile (`ingesting` blocks its removal), so no hole appears.
      // With per-cell bundles the appeared objects are then WRAPPED into small BundleGroups in CHUNKS (one
      // chunk per frame): a bundle record runs full per-object updates in its record frame, so wrapping a big
      // cell as ONE bundle would re-create the ~100 ms post-add hitch — many small records amortize instead
      // (Phase-1a: record cost scales with the bundle's own draw count).
      // Behind the initial streaming veil everything is hidden — appear atomically there (the budget would
      // throttle the initial fill of thousands of objects to minutes); budget only during live play.
      const budgeted = (this.gpu.appearPerFrame ?? 0) > 0 && !this.gpu.warmUp && this.config.gameState !== 'streaming';
      if (budgeted) {
        appearedThisFrame += this.appearSlice(batch, (this.gpu.appearPerFrame ?? 0) - appearedThisFrame);
        const complete = batch.added === batch.objects.length;
        if (this.gpu.cellContainer) {
          this.wrapChunk(key, batch, complete);
          if (!complete || batch.wrapped < batch.objects.length) {
            return; // keep appearing/wrapping next frame
          }
        } else if (!complete) {
          return; // budget spent — continue this cell next frame
        }
      } else {
        this.attachCell(key, batch.objects);
      }
      this.ingesting.delete(key);
      this.finishSwap(key, batch.objects);
      if (overBudget()) {
        break;
      }
    }
    this.logWarm(start, warmed);
  }

  /** The seamless-swap tail: mark loaded, drop the other detail level, fade genuinely new cells. */
  private finishSwap(key: string, objects: Object3D[]): void {
    this.loaded.set(key, objects);
    this.postAddWatch = key;
    const otherKey = otherLevelKey(key);
    const otherObjects = this.loaded.get(otherKey);
    if (otherObjects) {
      this.remove(otherKey, otherObjects); // old level drops only now → no empty frame
    } else if (!this.config.mapViewer && this.config.gameState !== 'streaming' && !this.gpu.cellContainer) {
      // Genuinely new cell: fade in (swaps never fade). Behind the streaming veil (plan 061) cells appear
      // at full opacity instead — the reveal shows a finished world, not a mass fade-in.
      // WebGPU bundles: skip the fade — a static BundleGroup bakes the opacity at record time, so a cell
      // recorded mid-fade (opacity 0) would stay invisible forever. Cells just appear at full opacity.
      this.fader.start(key, objects);
    }
  }

  /** Collect stream keys around one centre. With `into` set, only cells it hasn't claimed are added. */
  private keysAround(view: Vec3, into: null | Set<string>): Set<string> {
    const size = this.adapter.cellSize;
    const { hdDrawDistance, lodDrawDistance } = this.config.streaming;
    const margin = size * HYSTERESIS;
    const keys = into ?? new Set<string>();
    const claimed = into ? new Set([...into].map(cellOfKey)) : null;

    for (const [cx, cy] of cellsWithin(view, lodDrawDistance + margin, size)) {
      if (claimed?.has(`${cx},${cy}`)) {
        continue; // the view pass owns this cell's level — lookahead never flips it
      }
      const distSq = cellDistanceSq(view, cx, cy, size);
      const hdKey = streamKey(cx, cy, false);
      const lodKey = streamKey(cx, cy, true);
      const hdSticky = this.loaded.has(hdKey) || this.loading.has(hdKey);
      const anySticky = hdSticky || this.loaded.has(lodKey) || this.loading.has(lodKey);
      // Already-HD cells hold HD a margin past the ring; already-loaded cells hold LOD a margin past it.
      const hdReach = hdDrawDistance + (hdSticky ? margin : 0);
      const lodReach = lodDrawDistance + (anySticky ? margin : 0);
      if (distSq <= hdReach * hdReach) {
        keys.add(hdKey);
      } else if (distSq <= lodReach * lodReach) {
        keys.add(lodKey);
      }
    }

    return keys;
  }

  private load(key: string): void {
    this.loading.add(key);
    const [cx, cy, kind] = key.split(',');
    void this.adapter
      .loadCell({ cx: Number(cx), cy: Number(cy), lod: kind === 'lod' })
      .then(async (objects) => {
        // Phase 4: compile shaders + upload textures OFF the appearance frame (no-op without the hook).
        await this.gpu.precompile?.(objects);

        return objects;
      })
      .then((objects) => {
        this.loading.delete(key);
        if (!this.current.has(key) || this.loaded.has(key) || this.ingesting.has(key)) {
          return; // no longer wanted, or already loaded/ingesting
        }
        // Queue for the budgeted ingest (Phase 2); the swap finalizes when the whole batch is in.
        this.ingesting.set(key, { added: 0, objects: [...objects], wrapped: 0 });
      })
      .catch(() => this.loading.delete(key));
  }

  private logWarm(start: number, warmed: number): void {
    const spent = performance.now() - start;
    if (warmed > 0 && spent > WARM_LOG_MS) {
      // eslint-disable-next-line no-console -- plan 060 round 4 measurement: warm-frame cost attribution
      console.log(`[stream] warm frame ${spent.toFixed(0)}ms (${warmed} objects)`);
    }
  }

  private remove(key: string, objects: readonly Object3D[]): void {
    this.fader.cancel(key); // restore materials before the cell mesh goes back to the cache
    const cellContainers = this.containers.get(key);
    if (cellContainers) {
      for (const container of cellContainers) {
        [...container.children].forEach((object) => container.remove(object)); // objects go back to the cell cache
        this.root.remove(container);
      }
      this.containers.delete(key);
    }
    // Any objects not (yet) wrapped into a container — plain path or a mid-appearance cell — leave via the root.
    objects.forEach((object) => this.root.remove(object));
    this.loaded.delete(key);
  }

  /** Desired stream keys with the hysteresis dead-band: a cell keeps its current level until the view
   *  moves a margin past the ring boundary (sticky on what's already loaded/loading). The lookahead pass
   *  around the predicted view point only ADDS keys for cells the view pass didn't claim (Phase 1). */
  private streamKeys(): Set<string> {
    const keys = this.keysAround(this.viewOf(), null);
    // Readiness is judged on the VIEW ring only (plan 061) — the lookahead keys below are prefetch and
    // waiting on them would flap `settled()` with every move.
    this.viewKeys = new Set(keys);
    const speed = Math.hypot(this.velocity[0], this.velocity[1], this.velocity[2]);
    if (speed > 1) {
      const size = this.adapter.cellSize;
      const reach = Math.min(speed * LOOKAHEAD_SECONDS, size);
      const view = this.viewOf();
      const ahead: Vec3 = [
        view[0] + (this.velocity[0] / speed) * reach,
        view[1] + (this.velocity[1] / speed) * reach,
        view[2] + (this.velocity[2] / speed) * reach,
      ];
      this.keysAround(ahead, keys);
    }

    return keys;
  }

  /** Smoothed view velocity (u/s) for the prefetch lookahead. */
  private trackVelocity(delta: number): void {
    const view = this.viewOf();
    if (this.lastView && delta > 0) {
      this.velocity = [
        (view[0] - this.lastView[0]) / delta,
        (view[1] - this.lastView[1]) / delta,
        (view[2] - this.lastView[2]) / delta,
      ];
    }
    this.lastView = [view[0], view[1], view[2]];
  }

  /** Warm the batch's remaining objects one by one; false = the frame budget ran out mid-batch (stop draining). */
  private warmBatch(batch: { added: number; objects: Object3D[] }, spend: () => boolean): boolean {
    while (batch.added < batch.objects.length) {
      this.gpu.warmUp?.([batch.objects[batch.added]]);
      batch.added += 1;
      if (spend() && batch.added < batch.objects.length) {
        return false;
      }
    }

    return true;
  }

  /** Wrap up to one {@link WRAP_CHUNK}-sized slice of the batch's APPEARED objects into a fresh small BundleGroup
   *  (`Object3D.add` reparents them out of the root). One chunk per frame keeps each bundle's record cheap. */
  private wrapChunk(
    key: string,
    batch: { added: number; objects: Object3D[]; wrapped: number },
    complete: boolean,
  ): void {
    const remaining = batch.added - batch.wrapped;
    if (remaining <= 0 || (!complete && remaining < WRAP_CHUNK)) {
      return; // wait until a full chunk (or the cell's tail) is on screen
    }
    const container = this.gpu.cellContainer?.();
    if (!container) {
      return;
    }
    const size = Math.min(remaining, WRAP_CHUNK);
    container.frustumCulled = false;
    for (let i = batch.wrapped; i < batch.wrapped + size; i += 1) {
      const object = batch.objects[i];
      object.traverse((child) => (child.frustumCulled = false));
      container.add(object);
    }
    batch.wrapped += size;
    this.root.add(container);
    (container as unknown as { needsUpdate: boolean }).needsUpdate = true;
    const list = this.containers.get(key) ?? [];
    list.push(container);
    this.containers.set(key, list);
  }
}

/** The `cx,cy` of a stream key (drops the `hd`/`lod` level suffix). */
function cellOfKey(key: string): string {
  return key.slice(0, key.lastIndexOf(','));
}

/** The same cell's OTHER detail level key (`hd` ↔ `lod`). */
function otherLevelKey(key: string): string {
  const cut = key.lastIndexOf(',');

  return `${key.slice(0, cut)},${key.endsWith(',lod') ? 'hd' : 'lod'}`;
}

function streamKey(cx: number, cy: number, lod: boolean): string {
  return `${cx},${cy},${lod ? 'lod' : 'hd'}`;
}
