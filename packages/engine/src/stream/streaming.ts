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
 * `fogCut + margin ≤ lodRadius`, and the LOD/evict decisions test the CELL RECT (closest point), not the
 * centre — a 250 u cell's 177 u half-diagonal would otherwise put unloaded geometry deep inside clear air.
 */
import type { Engine } from '../engine';
import type { PakWorkerRequest, PakWorkerResponse } from './pak-worker';

const HD_RADIUS = 380;
const LOD_RADIUS = 1000;
const HYSTERESIS = 60;
const EVICT_MARGIN = 150;
/** Adaptive create budget (074/21 P3): a second create in one frame only while total create time stays
 *  under this — bounds the worst frame instead of doubling it (M1 worst create ≈ 1.1 ms). */
const CREATE_BUDGET_MS = 1.5;
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
  created: number;
  evicted: number;
  /** Creates whose cell already sat INSIDE the effective fog cut (074/21 P3) — each one is a pop the
   *  player could have seen. The fog-mask honesty metric: 0 in steady driving; teleports/boot are
   *  graced until their pending queue drains. */
  lateCreates: number;
  loadedCells: number;
  pendingCells: number;
  worstCreateMs: number;
}

interface CellSlot {
  centre: [number, number];
  current: Level | null;
  cx: number;
  cy: number;
  keys: Partial<Record<Level, string>>;
  pending: Level | null;
  /** Cell rect in engine XZ ([minX, maxX, minZ, maxZ]) — the LOD ring tests its closest point. */
  rect: [number, number, number, number];
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
    created: 0,
    evicted: 0,
    lateCreates: 0,
    loadedCells: 0,
    pendingCells: 0,
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
    for (const key of Object.keys(manifest.cells)) {
      const [cxRaw, cyRaw, level] = key.split(',');
      const cx = Number(cxRaw);
      const cy = Number(cyRaw);
      const slotKey = `${cx},${cy}`;
      let slot = this.cells.get(slotKey);
      if (!slot) {
        slot = {
          centre: [(cx + 0.5) * cellSize, -(cy + 0.5) * cellSize],
          current: null,
          cx,
          cy,
          keys: {},
          pending: null,
          // GTA cy maps to engine z = −y: the row [cy, cy+1) lands at z ∈ [−(cy+1), −cy) · cellSize.
          rect: [cx * cellSize, (cx + 1) * cellSize, -(cy + 1) * cellSize, -cy * cellSize],
        };
        this.cells.set(slotKey, slot);
      }
      slot.keys[level as Level] = key;
      this.keyToSlot.set(key, slot);
    }
    worker.addEventListener('message', (event: MessageEvent<PakWorkerResponse>) => {
      this.onBlob(event.data);
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
    let pendingCells = 0;
    let loadedCells = 0;
    let createSpentMs = 0;
    let creates = 0;
    for (const slot of this.cells.values()) {
      const biasedCentre = Math.hypot(slot.centre[0] - biasX, slot.centre[1] - biasZ);
      const biasedRect = rectDistanceOf(slot.rect, biasX, biasZ);
      const trueRect = rectDistanceOf(slot.rect, focus[0], focus[2]);
      // Adaptive budget: up to two creates while the total stays under CREATE_BUDGET_MS — a heavy first
      // create keeps the old 1/frame behaviour, two light ones drain ring-entry bursts twice as fast.
      const canCreate = creates === 0 || (creates < 2 && createSpentMs < CREATE_BUDGET_MS);
      const spent = this.advanceSlot(slot, biasedCentre, biasedRect, trueRect, canCreate);
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

    return this.stats;
  }

  /** One slot's step: evict / request / create-swap. Returns the create's duration (ms), null otherwise. */
  private advanceSlot(
    slot: CellSlot,
    biasedCentre: number,
    biasedRect: number,
    trueRect: number,
    canCreate: boolean,
  ): null | number {
    const desired = this.desiredLevel(slot, biasedCentre, biasedRect);
    if (desired === null) {
      slot.pending = null;
      // The evict margin is a RING hysteresis; a pinned set has no ring, so an unselected cell must go
      // regardless of how close it sits to the camera — otherwise deselecting one never clears it.
      if (slot.current !== null && (this.manual !== null || trueRect > this.lodRadius + EVICT_MARGIN)) {
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

    return this.create(slot, desired, key, blob, trueRect);
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
   *  HD tests the cell CENTRE (a quality ring — rect would nearly double HD residency for no guarantee);
   *  the LOD ring tests the cell RECT — the fog-mask guarantee is geometric (074/21). */
  private desiredLevel(slot: CellSlot, centreDistance: number, rectDistance: number): Level | null {
    if (this.manual !== null) {
      const { keys, level } = this.manual;

      return keys.has(`${slot.cx},${slot.cy}`) && slot.keys[level] ? level : null;
    }
    const hdEdge = slot.current === 'hd' ? this.hdRadius + HYSTERESIS : this.hdRadius;
    const lodEdge = slot.current !== null ? this.lodRadius + HYSTERESIS : this.lodRadius;
    if (centreDistance < hdEdge && slot.keys.hd) {
      return 'hd';
    }
    if (rectDistance < lodEdge && slot.keys.lod) {
      return 'lod';
    }

    return null;
  }

  /** A delivered pak entry: a texture array uploads straight away, a cell blob waits for its create slot. */
  private onBlob(message: PakWorkerResponse): void {
    if (message.type !== 'blob') {
      return;
    }
    // A texture array is uploaded the moment it lands and never enters `blobs`: it has no slot, so the
    // stale-blob prune would throw it away, and holding the CPU copy is exactly the memory we came here to
    // save.
    if (message.key.startsWith('array-')) {
      if (message.buffer) {
        this.engine.textures.load(Number(message.key.slice('array-'.length)), new Uint8Array(message.buffer));
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
