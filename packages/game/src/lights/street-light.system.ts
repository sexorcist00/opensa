import type { Color, Object3D, Points, Vector4 } from 'three';

import { Vector3 } from 'three';

import type { System } from '../core/system';
import type { LightsConfig } from '../interfaces/config.interface';
import type { LampLight } from './light-pool';

import { lampKey, selectLamps } from './light-pool';

/** The world-shader pool surface (structurally = renderware's `worldLocalLightUniforms`). */
export interface LocalLightSink {
  uLocalColor: { value: Color[] };
  uLocalCount: { value: number };
  uLocalDir: { value: Vector4[] };
  uLocalPos: { value: Vector4[] };
}

/** A `CoronaEntry` as stashed on each cell's corona Points (`userData.lightDefs`). */
interface CoronaEntry {
  color: [number, number, number];
  farClip: number;
  position: [number, number, number];
  size: number;
}

/** Slots 0–3 belong to the occupied vehicle's lamps; street lamps fill what's left. */
const FIRST_STREET_SLOT = 4;
/** How far a lamp can be and still claim a slot (world units) — beyond this its corona alone represents it.
 *  Comfortably larger than any lamp radius, so a lamp is already dark before it can lose its slot. */
const POOL_RANGE = 90;
/** A lamp's light radius from its authored corona size (SA sizes are ~0.6–3). */
const RADIUS_PER_SIZE = 11;
/** Smallest lamp radius (a tiny authored corona still pools a believable puddle). */
const MIN_RADIUS = 12;
/** Where the range fade starts, as a fraction of {@link POOL_RANGE}. */
const EVICT_FADE_FROM = 0.72;
/** Per-slot fade speed (1/seconds): a lamp entering or leaving the pool ramps over ~0.4 s instead of
 *  snapping. This is what makes slot EVICTION (a nearer rival stealing the slot) invisible — the range fade
 *  alone can't, because an evicted lamp may be close by. */
const FADE_SPEED = 2.5;
/** Below this the slot counts as free and may be re-homed to a different lamp. */
const FADE_EPSILON = 0.02;
/** Pool light strength (the world-shader term is additive on albedo). */
const LAMP_INTENSITY = 1.5;
/** Rebuild the lamp list only every N frames — cells stream in/out slowly, the walk is not free. */
const REBUILD_INTERVAL = 30;

/**
 * Street lamps in the world-shader light pool (plan 070): the 2dfx lights already collected for the corona
 * sprites (`userData.lightDefs`, one collection two consumers) become real POINT lights pooling on the road
 * under each lamp — replacing the baked-prelit-only look. The nearest few claim the slots the vehicle lamps
 * leave free, with hysteresis so a lamp row doesn't thrash them while driving. Coronas demote (not delete)
 * near a pooled lamp via `uPoolHandover`; beyond `POOL_RANGE` the corona alone represents the lamp, exactly
 * as SA does at distance.
 */
export class StreetLightSystem implements System {
  readonly name = 'street-lights';

  private readonly config: () => LightsConfig;
  private frame = 0;
  private lamps: LampLight[] = [];
  private readonly nightFactor: () => number;
  private previous = new Set<string>();
  private readonly root: Object3D;
  private readonly scratch = new Vector3();
  private readonly sink: LocalLightSink;
  private readonly slots: number;
  /** Per-slot temporal state: which lamp lives there and how far its fade has ramped (0…1). */
  private readonly slotState: { fade: number; lamp: LampLight | null }[] = [];
  private readonly viewOf: () => readonly [number, number, number];

  constructor(
    root: Object3D,
    viewOf: () => readonly [number, number, number],
    nightFactor: () => number,
    config: () => LightsConfig,
    sink: LocalLightSink,
    poolSize: number,
  ) {
    this.root = root;
    this.viewOf = viewOf;
    this.nightFactor = nightFactor;
    this.config = config;
    this.sink = sink;
    this.slots = Math.max(0, poolSize - FIRST_STREET_SLOT);
    for (let index = 0; index < this.slots; index += 1) {
      this.slotState.push({ fade: 0, lamp: null });
    }
  }

  update(delta: number): void {
    const night = this.nightFactor();
    const on = this.config().enabled && night > 0.05 && this.slots > 0;
    // The vehicle system owns slots 0–3 and sets uLocalCount to 4 when lit, 0 otherwise: never shrink below it.
    const vehicleCount = Math.min(this.sink.uLocalCount.value, FIRST_STREET_SLOT);
    if (!on) {
      for (const slot of this.slotState) {
        slot.fade = 0;
        slot.lamp = null;
      }
      this.sink.uLocalCount.value = vehicleCount;
      this.previous.clear();

      return;
    }
    if (this.frame % REBUILD_INTERVAL === 0) {
      this.lamps = this.collectLamps();
    }
    this.frame += 1;

    const viewer = this.viewOf();
    const picked = selectLamps(this.lamps, viewer, this.slots, POOL_RANGE, this.previous);
    this.previous = new Set(picked.map((lamp) => lamp.key));
    this.assignSlots(picked);

    const step = Math.min(1, delta * FADE_SPEED);
    const fadeFrom = POOL_RANGE * EVICT_FADE_FROM;
    let used = 0;
    for (const [index, state] of this.slotState.entries()) {
      // Ramp toward 1 while the lamp holds its slot, toward 0 once evicted — no light ever snaps on or off.
      const wanted = state.lamp && this.previous.has(state.lamp.key) ? 1 : 0;
      state.fade += (wanted - state.fade) * step;
      if (state.fade < FADE_EPSILON && wanted === 0) {
        state.fade = 0;
        state.lamp = null;
      }
      const lamp = state.lamp;
      if (!lamp) {
        continue;
      }
      used = index + 1;
      const slot = FIRST_STREET_SLOT + index;
      // Lamp positions are baked in root-local (GTA Z-up) space; the shader wants three world space.
      this.scratch.set(lamp.position[0], lamp.position[1], lamp.position[2]);
      this.root.localToWorld(this.scratch);
      this.sink.uLocalPos.value[slot].set(this.scratch.x, this.scratch.y, this.scratch.z, lamp.radius);
      const distance = Math.hypot(
        lamp.position[0] - viewer[0],
        lamp.position[1] - viewer[1],
        lamp.position[2] - viewer[2],
      );
      const range = 1 - smoothstep(fadeFrom, POOL_RANGE, distance);
      this.sink.uLocalColor.value[slot]
        .setRGB(lamp.color[0] / 255, lamp.color[1] / 255, lamp.color[2] / 255)
        .multiplyScalar(LAMP_INTENSITY * night * range * state.fade);
      this.sink.uLocalDir.value[slot].set(0, 0, 1, 2); // point light (no cone)
    }
    this.sink.uLocalCount.value = Math.max(vehicleCount, used > 0 ? FIRST_STREET_SLOT + used : vehicleCount);
  }

  /** Keep each lamp in the slot it already occupies (its fade is mid-ramp); give newcomers the free ones. */
  private assignSlots(picked: readonly LampLight[]): void {
    const held = new Set<string>();
    for (const state of this.slotState) {
      if (state.lamp && this.previous.has(state.lamp.key)) {
        held.add(state.lamp.key);
      }
    }
    for (const lamp of picked) {
      if (held.has(lamp.key)) {
        continue;
      }
      // A slot is free once its previous lamp has faded out (or it never had one).
      const free = this.slotState.find((state) => !state.lamp);
      if (!free) {
        return; // all slots still fading out; the newcomer waits a frame or two — invisible at 2.5/s
      }
      free.lamp = lamp;
      free.fade = 0;
      held.add(lamp.key);
    }
  }

  /** Walk the streamed cells' corona clouds and lift their light defs (one collection, two consumers). */
  private collectLamps(): LampLight[] {
    const lamps: LampLight[] = [];
    this.root.traverse((object) => {
      const entries = (object as Points).userData.lightDefs as CoronaEntry[] | undefined;
      if (!entries) {
        return;
      }
      for (const entry of entries) {
        lamps.push({
          color: entry.color,
          key: lampKey(entry.position),
          position: entry.position,
          radius: Math.max(MIN_RADIUS, entry.size * RADIUS_PER_SIZE),
        });
      }
    });

    return lamps;
  }
}

/** Hermite 0→1 between `edge0` and `edge1` (three's Vector maths has no scalar variant). */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / Math.max(edge1 - edge0, 1e-6)));

  return t * t * (3 - 2 * t);
}
