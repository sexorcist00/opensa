import type { OspakManifest } from '@opensa/engine-formats';

/**
 * Thin streaming driver (plan 074/05): plan-060 semantics re-implemented three-free — rings + hysteresis,
 * keep-old-level-until-replacement, atomic HD↔LOD swap, bounded creates (≤1 cell/frame), eviction outside the
 * outer ring. Cells come from the pak worker as transferable blobs; textures load up-front (district-shared).
 */
import type { Engine } from '../engine';
import type { PakWorkerRequest, PakWorkerResponse } from './pak-worker';

const HD_RADIUS = 380;
const LOD_RADIUS = 1000;
const HYSTERESIS = 60;
const EVICT_MARGIN = 150;

export interface StreamStats {
  created: number;
  evicted: number;
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
}

type Level = 'hd' | 'lod';

export class StreamingDriver {
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly cells = new Map<string, CellSlot>();
  private readonly engine: Engine;
  private readonly keyToSlot = new Map<string, CellSlot>();
  private readonly manifest: OspakManifest;
  private readonly requested = new Set<string>();
  private readonly stats: StreamStats = { created: 0, evicted: 0, loadedCells: 0, pendingCells: 0, worstCreateMs: 0 };
  private readonly worker: Worker;

  constructor(engine: Engine, manifest: OspakManifest, worker: Worker) {
    this.engine = engine;
    this.manifest = manifest;
    this.worker = worker;
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
        };
        this.cells.set(slotKey, slot);
      }
      slot.keys[level as Level] = key;
      this.keyToSlot.set(key, slot);
    }
    worker.addEventListener('message', (event: MessageEvent<PakWorkerResponse>) => {
      const message = event.data;
      if (message.type !== 'blob') {
        return;
      }
      if (message.buffer) {
        this.blobs.set(message.key, new Uint8Array(message.buffer));
      } else {
        // Failed fetch/inflate: clear the in-flight mark so the slot RETRIES next time it wants the level
        // (a permanently-poisoned key was the original stuck-at-LOD failure mode).
        this.requested.delete(message.key);
        console.warn(`[stream] entry ${message.key} failed: ${message.error ?? 'unknown'} — will retry`);
      }
    });
  }

  /** Tear down every loaded cell (the leak-assertion hook: the residency ledger must return to its
   *  post-texture baseline afterwards). */
  unloadAll(): void {
    for (const slot of this.cells.values()) {
      this.unload(slot);
    }
    this.blobs.clear();
    this.requested.clear();
  }

  /** Per frame: retarget rings at `focus` (engine coords) and advance at most ONE create + its swap. */
  update(focus: readonly [number, number, number]): StreamStats {
    let pendingCells = 0;
    let loadedCells = 0;
    let createdThisFrame = false;
    for (const slot of this.cells.values()) {
      const distance = Math.hypot(slot.centre[0] - focus[0], slot.centre[1] - focus[2]);
      if (this.advanceSlot(slot, distance, createdThisFrame)) {
        createdThisFrame = true;
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
    this.pruneStaleBlobs();

    return this.stats;
  }

  /** One slot's step: evict / request / create-swap. Returns true when a create consumed this frame's budget. */
  private advanceSlot(slot: CellSlot, distance: number, createdThisFrame: boolean): boolean {
    const desired = this.desiredLevel(slot, distance);
    if (desired === null) {
      slot.pending = null;
      if (slot.current !== null && distance > LOD_RADIUS + EVICT_MARGIN) {
        this.unload(slot);
      }

      return false;
    }
    const key = slot.keys[desired];
    if (desired === slot.current || key === undefined) {
      slot.pending = null;

      return false;
    }
    slot.pending = desired;
    if (!this.requested.has(key)) {
      this.requestBlob(key);

      return false;
    }
    if (createdThisFrame) {
      return false;
    }
    const blob = this.blobs.get(key);
    if (!blob) {
      return false;
    }
    this.create(slot, desired, key, blob);

    return true;
  }

  private create(slot: CellSlot, level: Level, key: string, blob: Uint8Array): void {
    const start = performance.now();
    this.engine.cells.load(key, blob);
    // Atomic swap: the replacement is live — drop the old level the same frame (no hole, no double-draw).
    const previousKey = slot.current ? slot.keys[slot.current] : undefined;
    if (previousKey !== undefined && previousKey !== key) {
      this.engine.cells.unload(previousKey);
      this.requested.delete(previousKey);
    }
    slot.current = level;
    slot.pending = null;
    // `requested` marks IN-FLIGHT fetches only: clear it with the blob, or a demoted level can never be
    // re-fetched on return (the field bug: revisited areas stuck at LOD — blob consumed, mark kept).
    this.blobs.delete(key); // the CPU copy dies immediately after upload (memory model)
    this.requested.delete(key);
    this.stats.created += 1;
    this.stats.worstCreateMs = Math.max(this.stats.worstCreateMs, performance.now() - start);
  }

  /** Ring pick with a hysteresis dead-band: keep the current level near the boundary (no flip-flop). */
  private desiredLevel(slot: CellSlot, distance: number): Level | null {
    const hdEdge = slot.current === 'hd' ? HD_RADIUS + HYSTERESIS : HD_RADIUS;
    const lodEdge = slot.current !== null ? LOD_RADIUS + HYSTERESIS : LOD_RADIUS;
    if (distance < hdEdge && slot.keys.hd) {
      return 'hd';
    }
    if (distance < lodEdge && slot.keys.lod) {
      return 'lod';
    }

    return null;
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

  private unload(slot: CellSlot): void {
    const currentKey = slot.current ? slot.keys[slot.current] : undefined;
    if (currentKey !== undefined) {
      this.engine.cells.unload(currentKey);
      this.requested.delete(currentKey);
    }
    slot.current = null;
    slot.pending = null;
    this.stats.evicted += 1;
  }
}
