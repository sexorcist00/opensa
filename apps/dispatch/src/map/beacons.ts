/**
 * The 3D half of the map symbology: through-depth beacons for units and calls, plus the assignment routes.
 *
 * `createDebugLines(..., { throughDepth: true })` compiles to the `debug-line-through` pipeline, whose depth
 * compare is `always` — the pillar is drawn OVER the city instead of inside it. That is exactly the property a
 * dispatch map needs: a unit behind a downtown tower still has to be findable. The flat icons and the text sit
 * on the 2D overlay; this file only draws what has to read as being *in* the world.
 *
 * Buffers are allocated once at {@link MARKER_CAPACITY} and refilled every frame — `updateDebugLines` rewrites
 * the contents and re-reads the vertex count, so a set that goes empty costs one degenerate segment.
 */
import type { DebugLineSetId, Engine } from '@opensa/engine';

import type { Operations, Selection, UnitStatus } from '../ops/types';
import type { GtaGround } from './coords';

import { gtaToEngine } from './coords';

export type Rgba = readonly [number, number, number, number];

/** The line sets this layer owns, keyed by what they draw. Incident keys are `call<priority>`. */
export type SetKey = 'call1' | 'call2' | 'call3' | 'callClosed' | 'route' | 'selection' | UnitStatus;

/** Markers a single set can hold before it starts dropping them. */
export const MARKER_CAPACITY = 96;

/**
 * The one colour table in the app — the 2D overlay reads it too, so a unit's pillar and its label chip can
 * never drift apart. Values are what the scene pass receives; the tonemapper takes it from there, so the
 * overlay's CSS twin is close rather than identical (and that is fine — one is a halo, one is a chip).
 */
export const SET_COLORS: Readonly<Record<SetKey, Rgba>> = {
  available: [0.26, 0.85, 0.46, 1],
  busy: [0.55, 0.58, 0.62, 1],
  call1: [1, 0.24, 0.3, 1],
  call2: [1, 0.56, 0.16, 1],
  call3: [0.92, 0.84, 0.28, 1],
  callClosed: [0.42, 0.46, 0.5, 1],
  enRoute: [1, 0.66, 0.16, 1],
  onScene: [0.32, 0.66, 1, 1],
  route: [0.34, 0.78, 1, 1],
  selection: [1, 1, 1, 1],
};

/** Beacon height in world units — tall enough to clear Los Santos rooftops. */
const CALL_PILLAR = 190;
const UNIT_PILLAR = 110;
/** Half-size of the ground cross under a beacon. */
const CROSS = 9;
/** Floats per marker: a pillar plus a two-segment ground cross, 6 vertices. */
const FLOATS_PER_MARKER = 18;
/** How high the route lines float, so they read above the road surface rather than inside it. */
const ROUTE_Y = 8;
const RING_RADIUS = 26;
const RING_SEGMENTS = 28;
/** A degenerate segment: two identical vertices rasterize nothing, and it keeps the write non-empty. */
const EMPTY = new Float32Array(6);

export class Beacons {
  private readonly buffers = new Map<SetKey, Float32Array>();
  private readonly counts = new Map<SetKey, number>();
  private readonly engine: Engine;
  private readonly sets = new Map<SetKey, DebugLineSetId>();

  constructor(engine: Engine) {
    this.engine = engine;
    for (const key of Object.keys(SET_COLORS) as SetKey[]) {
      const buffer = new Float32Array(MARKER_CAPACITY * FLOATS_PER_MARKER);
      this.buffers.set(key, buffer);
      this.sets.set(key, engine.createDebugLines(buffer, SET_COLORS[key], { throughDepth: true }));
    }
  }

  dispose(): void {
    for (const id of this.sets.values()) {
      this.engine.destroyDebugLines(id);
    }
    this.sets.clear();
  }

  /** Refill every set from the current board. Called once per frame; allocates nothing. */
  update(ops: Operations, selection: Selection): void {
    this.counts.clear();
    for (const unit of ops.units) {
      this.pushMarker(unit.status, unit.at, UNIT_PILLAR);
    }
    for (const incident of ops.incidents) {
      this.pushMarker(incidentKey(incident.status, incident.priority), incident.at, CALL_PILLAR);
    }
    this.pushRoutes(ops);
    this.pushSelection(ops, selection);
    this.flush();
  }

  private flush(): void {
    for (const [key, id] of this.sets) {
      const buffer = this.buffers.get(key);
      const count = this.counts.get(key) ?? 0;
      this.engine.updateDebugLines(id, buffer && count > 0 ? buffer.subarray(0, count) : EMPTY);
    }
  }

  private pushMarker(key: SetKey, ground: GtaGround, pillar: number): void {
    const out = this.buffers.get(key);
    const at = this.counts.get(key) ?? 0;
    if (!out || at + FLOATS_PER_MARKER > out.length) {
      return;
    }
    const [x, , z] = gtaToEngine(ground);
    out.set([x, 0, z, x, pillar, z], at);
    out.set([x - CROSS, 1, z, x + CROSS, 1, z], at + 6);
    out.set([x, 1, z - CROSS, x, 1, z + CROSS], at + 12);
    this.counts.set(key, at + FLOATS_PER_MARKER);
  }

  /** One straight line per responding unit. It is a BEARING, not a driven route — see the app readme. */
  private pushRoutes(ops: Operations): void {
    const out = this.buffers.get('route');
    if (!out) {
      return;
    }
    let at = 0;
    for (const unit of ops.units) {
      const incident = ops.incidents.find((entry) => entry.id === unit.incident);
      if (!incident || unit.status !== 'enRoute' || at + 6 > out.length) {
        continue;
      }
      out.set(gtaToEngine(unit.at, ROUTE_Y), at);
      out.set(gtaToEngine(incident.at, ROUTE_Y), at + 3);
      at += 6;
    }
    this.counts.set('route', at);
  }

  /** A ground ring under the selected entity — the "you are looking at this one" halo. */
  private pushSelection(ops: Operations, selection: Selection): void {
    const out = this.buffers.get('selection');
    const ground = selectionGround(ops, selection);
    if (!out || ground === null) {
      return;
    }
    const [cx, , cz] = gtaToEngine(ground);
    for (let i = 0; i < RING_SEGMENTS; i += 1) {
      const a0 = (i / RING_SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
      out.set(
        [
          cx + Math.cos(a0) * RING_RADIUS,
          2,
          cz + Math.sin(a0) * RING_RADIUS,
          cx + Math.cos(a1) * RING_RADIUS,
          2,
          cz + Math.sin(a1) * RING_RADIUS,
        ],
        i * 6,
      );
    }
    this.counts.set('selection', RING_SEGMENTS * 6);
  }
}

/** The set a call belongs to: closed calls go grey whatever their priority was. */
export function incidentKey(status: string, priority: number): SetKey {
  if (status === 'closed') {
    return 'callClosed';
  }

  return priority === 1 ? 'call1' : priority === 2 ? 'call2' : 'call3';
}

function selectionGround(ops: Operations, selection: Selection): GtaGround | null {
  if (selection === null) {
    return null;
  }
  if (selection.kind === 'world') {
    return selection.at;
  }
  const found =
    selection.kind === 'unit'
      ? ops.units.find((unit) => unit.id === selection.id)
      : ops.incidents.find((incident) => incident.id === selection.id);

  return found?.at ?? null;
}
