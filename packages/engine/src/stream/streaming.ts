import type { OspakManifest } from '@opensa/engine-formats';

/**
 * Thin streaming driver (plan 074/05): plan-060 semantics re-implemented three-free — rings + hysteresis,
 * keep-old-level-until-replacement, atomic HD↔LOD swap, bounded creates (≤1 cell/frame), eviction outside the
 * outer ring. Cells come from the pak worker as transferable blobs.
 *
 * Textures stream WITH the cells (003 phase 4): each cell entry lists the arrays it draws with, so an array
 * is fetched alongside the first cell that needs it and destroyed when the last such cell unloads. Before
 * that the whole district's arrays had to be resident from boot (~1.7 GB on a full map), because nothing
 * knew which cell wanted which. A pre-`textures` pak still loads eagerly in `setup`.
 *
 * The LOD ring is the fog-mask boundary (plan 074/21): hosts size it via `lodRadius` so that
 * `fogCut + margin ≤ lodRadius`, and the LOD/evict decisions test the closest point of the cell's TRUE
 * geometry AABB (manifest `aabb`, plan 087) — an instance welds into the cell of its PIVOT, so meshes
 * (bridges, piers) reach a mean 141 u / max 799 u past the grid rect on gostown, and a grid-rect ring
 * skipped cells whose geometry already sat inside the fog. Pre-`aabb` paks fall back to the grid rect
 * (whose closest-point test already beat the old centre test by the 177 u half-diagonal).
 */
import type { Engine } from '../engine';
import type { PakWorkerRequest, PakWorkerResponse } from './pak-worker';

import { COLLISION_KEY_PREFIX } from './collision-source';

const HD_RADIUS = 380;
const LOD_RADIUS = 1000;
const HYSTERESIS = 60;
const EVICT_MARGIN = 150;
/** Adaptive create budget (074/21 P3): a second create in one frame only while total create time stays
 *  under this — bounds the worst frame instead of doubling it (M1 worst create ≈ 1.1 ms). */
const CREATE_BUDGET_MS = 1.5;
/** Budget for draining texture-array (layer, mip) writes inside `update` — the fix for the 15–85 ms
 *  between-frames upload hitch (`docs/performance/applied/texture-upload-budget.md`): the
 *  worker handler only decodes + creates the texture, the writes are paid HERE, like cell creates. */
const UPLOAD_BUDGET_MS = 1.5;
/** Velocity prefetch (074/21 P3): request rings test a focus biased AHEAD along the smoothed per-frame
 *  motion — cells are fetched before the true focus reaches them. Lead ≈ 1.25 s at 120 Hz, capped so a
 *  fast flyover can't drag the request ring a district ahead. Eviction always uses the TRUE focus. */
const PREFETCH_LEAD_FRAMES = 150;
const PREFETCH_MAX = 300;
/** A focus jump of a cell-plus in ONE update is a teleport, not motion: zero the velocity and open the
 *  late-create GRACE (everything legitimately creates inside the fog after a teleport/boot). */
const TELEPORT_JUMP = 260;
/** Velocity EMA smoothing (per update) — frame-time jitter must not wobble the request ring. */
const VELOCITY_SMOOTH = 0.1;

/** Ring radii (engine units). Defaults keep the historical 380/1000 when a host passes nothing. */
export interface StreamingRadii {
  hdRadius?: number;
  lodRadius?: number;
}

export interface StreamStats {
  /**
   * Milliseconds spent in the worker's `message` handler since the last {@link Streaming.update} — blob
   * bookkeeping and the cheap start of a texture upload (decode + `createTexture`; the writes drain in
   * `update` under {@link UPLOAD_BUDGET_MS} and show up as {@link uploadMs}).
   *
   * It is reported because it runs BETWEEN frames, where no in-loop timer can see it: a 2026-07-27 field
   * report of 20-250 ms frames turned out to have 90-98 % of each slow frame outside every block the host
   * times, and it was this — whole-array uploads at 15-85 ms a call. Reset every update, so it is
   * per-frame like the rest.
   */
  blobMs: number;
  created: number;
  evicted: number;
  /** Creates whose cell already sat INSIDE the effective fog cut (074/21 P3) — each one is a pop the
   *  player could have seen. The fog-mask honesty metric: 0 in steady driving; teleports/boot are
   *  graced until their pending queue drains. */
  lateCreates: number;
  loadedCells: number;
  pendingCells: number;
  /** Milliseconds this update spent draining texture-array writes (the budgeted, in-frame share of what
   *  {@link blobMs} used to carry all at once). Sits INSIDE the host's stream block timer. */
  uploadMs: number;
  /** The single most expensive handler call in that window — one huge texture-array upload and a pile-up of
   *  small ones are different problems, and only this number tells them apart. */
  worstBlobMs: number;
  worstCreateMs: number;
}

interface CellSlot {
  centre: [number, number];
  current: Level | null;
  cx: number;
  cy: number;
  /** Union of the level rects — eviction must keep a slot while ANY of its geometry is near the ring. */
  evictRect: [number, number, number, number];
  keys: Partial<Record<Level, string>>;
  pending: Level | null;
  /** GRID cell rect in engine XZ ([minX, maxX, minZ, maxZ]) — the fallback when a level has no `aabb`. */
  rect: [number, number, number, number];
  /** Per-level TRUE geometry rects (manifest `aabb`, plan 087) — what the LOD ring actually tests. */
  rects: Partial<Record<Level, [number, number, number, number]>>;
}

type Level = 'hd' | 'lod';

export class StreamingDriver {
  /** Texture-array ref → the loaded cell keys drawing with it. Empty set ⇒ the array is released. */
  private readonly arrayUsers = new Map<number, Set<string>>();
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly cells = new Map<string, CellSlot>();
  private readonly engine: Engine;
  private readonly hdRadius: number;
  private readonly keyToSlot = new Map<string, CellSlot>();
  /** Previous update's focus (engine XZ) — velocity source; null until the first update. */
  private lastFocus: [number, number] | null = null;
  private readonly lodRadius: number;
  private readonly manifest: OspakManifest;
  /** Map-inspector pin (074/22): while set, the rings are IGNORED — exactly these cells are resident at
   *  exactly this level, and every other slot evicts. `null` = normal focus-driven streaming. */
  private manual: null | { keys: Set<string>; level: Level } = null;
  private readonly requested = new Set<string>();
  private readonly stats: StreamStats = {
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
  /** Late-create grace: open at boot and after every teleport jump, closes once pending drains. */
  private teleportGrace = true;
  /** Smoothed per-update focus delta (engine XZ) — the prefetch direction. */
  private readonly velocity: [number, number] = [0, 0];
  /** Texture-array refs already reported missing — one line each, not one per frame. */
  private readonly warnedArrays = new Set<number>();
  private readonly worker: Worker;

  constructor(engine: Engine, manifest: OspakManifest, worker: Worker, radii: StreamingRadii = {}) {
    this.engine = engine;
    this.manifest = manifest;
    this.worker = worker;
    this.hdRadius = radii.hdRadius ?? HD_RADIUS;
    this.lodRadius = radii.lodRadius ?? LOD_RADIUS;
    const cellSize = manifest.cellSize ?? 250; // pre-cellSize manifests (older converts) default to the stock grid
    for (const [key, entry] of Object.entries(manifest.cells)) {
      const [cxRaw, cyRaw, level] = key.split(',');
      const cx = Number(cxRaw);
      const cy = Number(cyRaw);
      const slotKey = `${cx},${cy}`;
      let slot = this.cells.get(slotKey);
      if (!slot) {
        // GTA cy maps to engine z = −y: the row [cy, cy+1) lands at z ∈ [−(cy+1), −cy) · cellSize.
        const rect: [number, number, number, number] = [
          cx * cellSize,
          (cx + 1) * cellSize,
          -(cy + 1) * cellSize,
          -cy * cellSize,
        ];
        slot = {
          centre: [(cx + 0.5) * cellSize, -(cy + 0.5) * cellSize],
          current: null,
          cx,
          cy,
          evictRect: rect,
          keys: {},
          pending: null,
          rect,
          rects: {},
        };
        this.cells.set(slotKey, slot);
      }
      slot.keys[level as Level] = key;
      if (entry.aabb) {
        slot.rects[level as Level] = entry.aabb;
      }
      this.keyToSlot.set(key, slot);
    }
    // Eviction must be at least as conservative as every level's DECISION rect (aabb, grid fallback) —
    // evicting by a smaller rect than the one that desires the level would load/unload-flap at the edge.
    for (const slot of this.cells.values()) {
      const levels = (Object.keys(slot.keys) as Level[]).map((level) => slot.rects[level] ?? slot.rect);
      slot.evictRect = levels.reduce(
        (union, r): [number, number, number, number] => [
          Math.min(union[0], r[0]),
          Math.max(union[1], r[1]),
          Math.min(union[2], r[2]),
          Math.max(union[3], r[3]),
        ],
        levels[0],
      );
    }
    worker.addEventListener('message', (event: MessageEvent<PakWorkerResponse>) => {
      // Timed HERE and not inside `onBlob`: this handler runs between frames, so its cost is invisible to
      // every timer the host frame keeps (see `StreamStats.blobMs`).
      const started = performance.now();
      this.onBlob(event.data);
      const spent = performance.now() - started;
      this.stats.blobMs += spent;
      this.stats.worstBlobMs = Math.max(this.stats.worstBlobMs, spent);
    });
  }

  /** Every cell the pak offers, as GTA cell coords — the map inspector's section grid. Independent of
   *  what is currently resident (that is `engine.cells`), because the grid must show the whole map. */
  listCells(): [number, number][] {
    return [...this.cells.values()].map((slot): [number, number] => [slot.cx, slot.cy]);
  }

  /**
   * Pin an explicit cell set (map-inspector) or return to focus-driven streaming with `null`. The rings
   * are bypassed rather than the update loop suspended, so creates keep their frame budget and the
   * atomic HD↔LOD swap still applies — a pinned set fills in over a few frames instead of hitching.
   */
  setManualCells(cells: null | readonly (readonly [number, number])[], lod = false): void {
    this.manual =
      cells === null ? null : { keys: new Set(cells.map(([cx, cy]) => `${cx},${cy}`)), level: lod ? 'lod' : 'hd' };
  }

  /** Tear down every loaded cell (the leak-assertion hook: the residency ledger must return to its
   *  post-texture baseline afterwards). */
  unloadAll(): void {
    for (const slot of this.cells.values()) {
      this.unload(slot);
    }
    this.blobs.clear();
    this.requested.clear();
    this.teleportGrace = true; // the re-stream is boot-like — its creates are not pops
  }

  /** Per frame: retarget rings at `focus` (engine coords) and advance the bounded creates + swaps. */
  update(focus: readonly [number, number, number]): StreamStats {
    // Velocity prefetch (074/21 P3): REQUESTS test a focus biased ahead along the smoothed motion;
    // EVICTION stays on the true focus (symmetric safety — the ring behind never thrashes).
    const [biasX, biasZ] = this.advanceVelocity(focus[0], focus[2]);
    // Drain BEFORE the slot loop: an array whose last write lands here unblocks its cell the same frame.
    this.stats.uploadMs = this.engine.textures.drainUploads(UPLOAD_BUDGET_MS);
    let pendingCells = 0;
    let loadedCells = 0;
    let createSpentMs = 0;
    let creates = 0;
    for (const slot of this.cells.values()) {
      // Adaptive budget: up to two creates while the total stays under CREATE_BUDGET_MS — a heavy first
      // create keeps the old 1/frame behaviour, two light ones drain ring-entry bursts twice as fast.
      const canCreate = creates === 0 || (creates < 2 && createSpentMs < CREATE_BUDGET_MS);
      const spent = this.advanceSlot(slot, biasX, biasZ, focus[0], focus[2], canCreate);
      if (spent !== null) {
        creates += 1;
        createSpentMs += spent;
      }
      if (slot.pending !== null) {
        pendingCells += 1;
      }
      if (slot.current !== null) {
        loadedCells += 1;
      }
    }
    this.stats.pendingCells = pendingCells;
    this.stats.loadedCells = loadedCells;
    if (this.teleportGrace && pendingCells === 0) {
      this.teleportGrace = false; // the boot/teleport queue drained — late creates count again
    }
    this.pruneStaleBlobs();
    const stats = { ...this.stats };
    this.stats.blobMs = 0; // per-FRAME, like the host's own block timers — the rest are running totals
    this.stats.worstBlobMs = 0;

    return stats;
  }

  /** One slot's step: evict / request / create-swap. Requests test the BIASED focus (velocity prefetch),
   *  eviction and the late-create metric the TRUE one. Returns the create's duration (ms), null otherwise. */
  private advanceSlot(
    slot: CellSlot,
    biasX: number,
    biasZ: number,
    trueX: number,
    trueZ: number,
    canCreate: boolean,
  ): null | number {
    const desired = this.desiredLevel(slot, biasX, biasZ);
    if (desired === null) {
      slot.pending = null;
      // The evict margin is a RING hysteresis; a pinned set has no ring, so an unselected cell must go
      // regardless of how close it sits to the camera — otherwise deselecting one never clears it.
      if (
        slot.current !== null &&
        (this.manual !== null || rectDistanceOf(slot.evictRect, trueX, trueZ) > this.lodRadius + EVICT_MARGIN)
      ) {
        this.unload(slot);
      }

      return null;
    }
    const key = slot.keys[desired];
    if (desired === slot.current || key === undefined) {
      slot.pending = null;

      return null;
    }
    slot.pending = desired;
    if (!this.requested.has(key)) {
      this.requestBlob(key);
      this.texturesReady(key); // kick the arrays off IN PARALLEL with the cell — never serialize the two

      return null;
    }
    if (!canCreate) {
      return null;
    }
    const blob = this.blobs.get(key);
    if (!blob) {
      return null;
    }
    if (!this.texturesReady(key)) {
      return null; // arrays still in flight — a cell must never record against an unloaded array
    }

    return this.create(slot, desired, key, blob, rectDistanceOf(this.levelRect(slot, desired), trueX, trueZ));
  }

  /** Smooth the per-update focus delta; returns the REQUEST focus (true focus + capped lead vector). */
  private advanceVelocity(fx: number, fz: number): [number, number] {
    if (this.lastFocus === null) {
      this.lastFocus = [fx, fz];
    } else {
      const dx = fx - this.lastFocus[0];
      const dz = fz - this.lastFocus[1];
      this.lastFocus[0] = fx;
      this.lastFocus[1] = fz;
      if (Math.hypot(dx, dz) > TELEPORT_JUMP) {
        // A teleport: yesterday's heading is meaningless, and everything about to create sits inside
        // the fog by necessity — grace the late-create metric until the queue drains.
        this.velocity[0] = 0;
        this.velocity[1] = 0;
        this.teleportGrace = true;
      } else {
        this.velocity[0] += (dx - this.velocity[0]) * VELOCITY_SMOOTH;
        this.velocity[1] += (dz - this.velocity[1]) * VELOCITY_SMOOTH;
      }
    }
    let leadX = this.velocity[0] * PREFETCH_LEAD_FRAMES;
    let leadZ = this.velocity[1] * PREFETCH_LEAD_FRAMES;
    const lead = Math.hypot(leadX, leadZ);
    if (lead > PREFETCH_MAX) {
      leadX *= PREFETCH_MAX / lead;
      leadZ *= PREFETCH_MAX / lead;
    }

    return [fx + leadX, fz + leadZ];
  }

  /** Record this cell as a user of every array it draws with. */
  private claimTextures(key: string): void {
    for (const ref of this.manifest.cells[key].textures ?? []) {
      const users = this.arrayUsers.get(ref) ?? new Set<string>();
      users.add(key);
      this.arrayUsers.set(ref, users);
    }
  }

  /** Load a delivered blob into the engine; returns the create's duration for the frame budget. */
  private create(slot: CellSlot, level: Level, key: string, blob: Uint8Array, trueRect: number): number {
    const start = performance.now();
    // The honesty metric (074/21 P3): a cell APPEARING (current === null) inside the effective fog cut
    // was visible while absent — a pop the fog failed to mask. Steady driving must keep this at zero.
    // HD↔LOD swaps are exempt by design: they happen deep inside the clear zone and swap atomically —
    // the old level renders until the replacement is live, so nothing pops.
    if (!this.teleportGrace && slot.current === null && trueRect < this.engine.environment.fogCutDistance) {
      this.stats.lateCreates += 1;
    }
    this.engine.cells.load(key, blob);
    this.claimTextures(key);
    // Atomic swap: the replacement is live — drop the old level the same frame (no hole, no double-draw).
    const previousKey = slot.current ? slot.keys[slot.current] : undefined;
    if (previousKey !== undefined && previousKey !== key) {
      this.engine.cells.unload(previousKey);
      // Claim BEFORE release: an array both levels draw with must never drop to zero users in between,
      // or the HD↔LOD swap would destroy the texture and immediately re-fetch it.
      this.releaseTextures(previousKey);
      this.requested.delete(previousKey);
    }
    slot.current = level;
    slot.pending = null;
    // `requested` marks IN-FLIGHT fetches only: clear it with the blob, or a demoted level can never be
    // re-fetched on return (the field bug: revisited areas stuck at LOD — blob consumed, mark kept).
    this.blobs.delete(key); // the CPU copy dies immediately after upload (memory model)
    this.requested.delete(key);
    this.stats.created += 1;
    const duration = performance.now() - start;
    this.stats.worstCreateMs = Math.max(this.stats.worstCreateMs, duration);

    return duration;
  }

  /** Ring pick with a hysteresis dead-band: keep the current level near the boundary (no flip-flop).
   *  HD tests the GRID cell CENTRE (a quality ring — a rect test would nearly double HD residency for no
   *  guarantee); the LOD ring tests the level's TRUE geometry rect (manifest `aabb`, grid-rect fallback) —
   *  the fog-mask guarantee is geometric, and the geometry is what must not pop (074/21, 087). */
  private desiredLevel(slot: CellSlot, fx: number, fz: number): Level | null {
    if (this.manual !== null) {
      const { keys, level } = this.manual;

      return keys.has(`${slot.cx},${slot.cy}`) && slot.keys[level] ? level : null;
    }
    const hdEdge = slot.current === 'hd' ? this.hdRadius + HYSTERESIS : this.hdRadius;
    const lodEdge = slot.current !== null ? this.lodRadius + HYSTERESIS : this.lodRadius;
    if (slot.keys.hd && Math.hypot(slot.centre[0] - fx, slot.centre[1] - fz) < hdEdge) {
      return 'hd';
    }
    if (slot.keys.lod && rectDistanceOf(this.levelRect(slot, 'lod'), fx, fz) < lodEdge) {
      return 'lod';
    }

    return null;
  }

  /** The rect a level's ring decisions test: its true geometry AABB, or the grid rect on a pre-`aabb` pak. */
  private levelRect(slot: CellSlot, level: Level): readonly [number, number, number, number] {
    return slot.rects[level] ?? slot.rect;
  }

  /** A delivered pak entry: a texture array uploads straight away, a cell blob waits for its create slot. */
  private onBlob(message: PakWorkerResponse): void {
    if (message.type !== 'blob') {
      return;
    }
    // A texture array BEGINS its upload the moment it lands (decode + `createTexture` — cheap) and never
    // enters `blobs`: it has no slot, so the stale-blob prune would throw it away. The expensive (layer,
    // mip) writes drain from `update` under UPLOAD_BUDGET_MS — a whole-array upload here ran between
    // frames at 15-85 ms a call, invisible to every in-loop timer.
    // Baked collision shares this worker (097/3-01) and its replies land here too — they belong to
    // `PakCollisionSource`, and a blob with no cell slot would be pruned away a frame later anyway.
    if (message.key.startsWith(COLLISION_KEY_PREFIX)) {
      return;
    }
    if (message.key.startsWith('array-')) {
      if (message.buffer) {
        this.engine.textures.beginLoad(Number(message.key.slice('array-'.length)), new Uint8Array(message.buffer));
      } else {
        this.requested.delete(message.key); // failed: let the next cell that needs it re-request
      }

      return;
    }
    if (message.buffer) {
      this.blobs.set(message.key, new Uint8Array(message.buffer));

      return;
    }
    // Failed fetch/inflate: clear the in-flight mark so the slot RETRIES next time it wants the level
    // (a permanently-poisoned key was the original stuck-at-LOD failure mode).
    this.requested.delete(message.key);
    // eslint-disable-next-line no-console -- deliberate field diagnostic: a silent retry loop hid the stuck-at-LOD bug once already
    console.warn(`[stream] entry ${message.key} failed: ${message.error ?? 'unknown'} — will retry`);
  }

  /** Backpressure (whip-bench finding: 736 MB heap): fetched blobs whose slot no longer wants that level
   *  are DROPPED (with their in-flight mark, so a future desire re-fetches). Camera whips order far more
   *  data than the 1-create/frame budget can consume — without pruning it piles up in the worker handoff. */
  private pruneStaleBlobs(): void {
    for (const key of this.blobs.keys()) {
      const slot = this.keyToSlot.get(key);
      if (!slot || slot.keys[slot.pending ?? 'hd'] !== key || slot.pending === null) {
        this.blobs.delete(key);
        this.requested.delete(key);
      }
    }
  }

  /** Drop this cell's claims; an array nothing draws with any more is destroyed. */
  private releaseTextures(key: string): void {
    for (const ref of this.manifest.cells[key].textures ?? []) {
      const users = this.arrayUsers.get(ref);
      if (!users) {
        continue;
      }
      users.delete(key);
      if (users.size === 0) {
        this.arrayUsers.delete(ref);
        this.engine.textures.unload(ref);
        this.requested.delete(`array-${ref}`);
      }
    }
  }

  private requestBlob(key: string): void {
    this.requested.add(key);
    const entry = this.manifest.cells[key];
    this.worker.postMessage({
      ...(entry.enc !== undefined ? { enc: entry.enc } : {}),
      key,
      length: entry.length,
      offset: entry.offset,
      type: 'fetch',
    } satisfies PakWorkerRequest);
  }

  /**
   * Whether every array this cell draws with is uploaded, requesting the missing ones. A pak built before
   * the `textures` field carries no refs — those districts loaded every array eagerly at boot, so there is
   * nothing to wait for and this is trivially true.
   */
  private texturesReady(key: string): boolean {
    const refs = this.manifest.cells[key]?.textures;
    if (refs === undefined) {
      return true;
    }
    let ready = true;
    for (const ref of refs) {
      if (this.engine.textures.has(ref)) {
        continue;
      }
      ready = false;
      const arrayKey = `array-${ref}`;
      if (!this.requested.has(arrayKey)) {
        const entry = this.manifest.textures[arrayKey];
        if (!entry) {
          // A cell naming an array the pak does not carry — a converter bug. The cell stays unbuilt rather
          // than crashing the frame in `cells.load`, but it must SAY so: a silently absent cell is the
          // failure mode this project keeps paying for.
          if (!this.warnedArrays.has(ref)) {
            this.warnedArrays.add(ref);
            // eslint-disable-next-line no-console -- a malformed pak must not fail silently
            console.warn(`[stream] cell ${key} needs ${arrayKey}, which the pak does not carry`);
          }
          continue;
        }
        this.requested.add(arrayKey);
        this.worker.postMessage({
          ...(entry.enc !== undefined ? { enc: entry.enc } : {}),
          key: arrayKey,
          length: entry.length,
          offset: entry.offset,
          type: 'fetch',
        } satisfies PakWorkerRequest);
      }
    }

    return ready;
  }

  private unload(slot: CellSlot): void {
    const currentKey = slot.current ? slot.keys[slot.current] : undefined;
    if (currentKey !== undefined) {
      this.engine.cells.unload(currentKey);
      this.releaseTextures(currentKey);
      this.requested.delete(currentKey);
    }
    slot.current = null;
    slot.pending = null;
    this.stats.evicted += 1;
  }
}

/** Horizontal distance from (fx, fz) to the closest point of a cell rect — 0 inside. */
function rectDistanceOf(rect: readonly [number, number, number, number], fx: number, fz: number): number {
  const dx = Math.max(rect[0] - fx, 0, fx - rect[1]);
  const dz = Math.max(rect[2] - fz, 0, fz - rect[3]);

  return Math.hypot(dx, dz);
}
