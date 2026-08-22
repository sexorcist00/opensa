/**
 * The time axis (201/8-01): a unit's position stops being a point and becomes a **function of time**.
 *
 * A unit whose position is a point cannot be scrubbed. A unit whose position is a track can be, and
 * everything above it — smooth movement between server packets, trails, replay of a shift — falls out of the
 * same structure. This is the shape CZML gives Cesium; we take the idea (properties over an interval, driven
 * by a clock), not the format.
 *
 * **Where it lives, and why not on `Unit` as the plan first sketched it.** `Operations` is an immutable
 * snapshot and `stepOperations` is a pure reducer — the property that lets the whole board be unit-tested
 * and later swapped for a socket handler. A ring buffer cannot be immutable at a per-tick cost, so putting
 * one on `Unit` would either destroy that purity or copy 150 buffers 20 times a second. So the tracks are a
 * STORE the host owns beside the board, fed from the same tick, with exactly one writer. `Unit.at` stays
 * what it always was — the state at `ops.now` — and the store answers every other T.
 *
 * **What it records and what it drops** is the sampling policy 8/01 owes, and all three rules exist because
 * of the feed rather than by taste:
 *
 * - **Rate limit.** The mock ticks at 20 Hz; PCAD publishes every 4 s (measured in its source, plan 202 §4).
 *   Recording at tick rate would make the mock's tracks five times denser than the live feed's — a memory
 *   figure that flatters, and a scrub that behaves differently in the two. So one sample per
 *   {@link SAMPLE_INTERVAL_MS}, whichever feed is driving.
 * - **A status change always samples**, rate limit or not: a unit that went en-route and arrived between two
 *   position samples has a history that says it never did.
 * - **A stationary run collapses to its two ends.** Most of a shift, most units are parked. Keeping the
 *   first and last sample of a still period says exactly as much as keeping four hundred of them.
 *
 * The interval past the last sample is NOT extrapolated — {@link UnitTracks.at} holds the last known state
 * and marks it stale. That rule is 8/02's to surface to the operator; it is enforced here so that no
 * consumer can accidentally invent a position.
 */
import type { GtaGround } from '../map/coords';
import type { Operations, UnitStatus } from './types';

/** One resolved moment of one unit. `stale` is true past the last sample the feed delivered. */
export interface TrackState {
  /** ms the answer is older than the T asked for — 0 inside the track, >0 past its end. */
  readonly ageMs: number;
  readonly at: GtaGround;
  readonly heading: number;
  readonly stale: boolean;
  readonly status: UnitStatus;
}

/** What the store costs and how much history it is holding — the report reads this. */
export interface TrackStats {
  /** Host bytes held by the sample arrays. NOT GPU residency: `Engine.ledger()` counts that, and the two
   *  are different memories (the same distinction 5/01 drew for `pickingBytes`). */
  readonly bytes: number;
  /** Ring capacity per unit, in samples. */
  readonly capacity: number;
  /** Samples actually stored across every track. */
  readonly samples: number;
  readonly tracks: number;
  /** Oldest → newest sample time held, ms. Null while nothing has been recorded. */
  readonly window: null | readonly [number, number];
}

/** Bytes one sample occupies: t u32, x/y/heading f32, status u8 — parallel arrays, so no padding. */
export const BYTES_PER_SAMPLE = 4 + 4 + 4 + 4 + 1;

/**
 * How often a track takes a sample, ms. **This is PCAD's publish rate**, read out of its source rather than
 * chosen here (plan 202 §4: `cadui.lua`'s `sendPositionUpdate` thread, every 4 s, vehicles only). The mock
 * feed is held to the same rate so the two produce tracks of the same density.
 */
export const SAMPLE_INTERVAL_MS = 4000;

/** How long a track keeps history. See `docs/hacks/dispatch-shift-length.md` — the one number here nobody
 *  has named, and what it costs is linear in it. Not exported: `SAMPLES_PER_TRACK` is what a caller wants,
 *  and a second reader of the hours would be a second place to change it. */
const SHIFT_HOURS = 8;

/** Samples one unit's ring holds: a whole shift at the publish rate, with no gap left to chance. */
export const SAMPLES_PER_TRACK = Math.ceil((SHIFT_HOURS * 3600 * 1000) / SAMPLE_INTERVAL_MS);

/** Movement below this (world units) is "the unit did not move" — a parked car's GPS jitter, not a drive. */
const STILL_RADIUS = 1.5;

/** The status ids, as the ring stores them. Index IS the stored byte, so this order is a format. */
const STATUS_BY_ID: readonly UnitStatus[] = ['available', 'busy', 'enRoute', 'onScene'];

/** One unit's ring of samples, stored column-wise so a sample costs exactly {@link BYTES_PER_SAMPLE}. */
class Track {
  readonly heading: Float32Array;
  /** How many samples are live, up to the ring's capacity. */
  length = 0;
  readonly status: Uint8Array;
  readonly t: Uint32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Where sample 0 sits once the ring has wrapped. */
  private start = 0;
  /** True while the last two samples are both inside {@link STILL_RADIUS} of each other — the run this
   *  collapses. Reset by any real movement or a status change. */
  private still = false;

  constructor(capacity: number) {
    this.heading = new Float32Array(capacity);
    this.status = new Uint8Array(capacity);
    this.t = new Uint32Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
  }

  /** Ring position of logical sample `i`. */
  index(i: number): number {
    return (this.start + i) % this.t.length;
  }

  push(t: number, at: GtaGround, heading: number, status: number): void {
    if (this.length === 0) {
      this.write(this.index(0), t, at, heading, status);
      this.length = 1;

      return;
    }
    const last = this.index(this.length - 1);
    const moved = Math.hypot(at[0] - this.x[last], at[1] - this.y[last]) > STILL_RADIUS;
    const changed = status !== this.status[last];
    if (!changed && t - this.t[last] < SAMPLE_INTERVAL_MS) {
      return;
    }
    // A run of stationary samples keeps only its two ends: the moment the unit stopped, and where it still
    // is. Overwriting the tail is what makes a parked shift cost 34 bytes instead of 122 kB.
    if (!moved && !changed && this.still) {
      this.write(last, t, at, heading, status);

      return;
    }
    this.still = !moved && !changed;
    this.append(t, at, heading, status);
  }

  private append(t: number, at: GtaGround, heading: number, status: number): void {
    if (this.length < this.t.length) {
      this.write(this.index(this.length), t, at, heading, status);
      this.length += 1;

      return;
    }
    // Full: the oldest sample of the shift is what falls off.
    this.write(this.start, t, at, heading, status);
    this.start = (this.start + 1) % this.t.length;
  }

  private write(slot: number, t: number, at: GtaGround, heading: number, status: number): void {
    this.heading[slot] = heading;
    this.status[slot] = status;
    this.t[slot] = t;
    this.x[slot] = at[0];
    this.y[slot] = at[1];
  }
}

/**
 * Every unit's track, fed one board snapshot at a time.
 *
 * Deliberately NOT reactive and NOT immutable: the host records into it from the same tick the board is
 * stepped in, and everything that reads it asks a question rather than subscribing.
 */
export class UnitTracks {
  private readonly capacity: number;
  private readonly tracks = new Map<string, Track>();

  /** `capacity` is the ring length per unit; the default is a whole shift at the publish rate. */
  constructor(capacity: number = SAMPLES_PER_TRACK) {
    this.capacity = Math.max(2, Math.floor(capacity));
  }

  /**
   * One unit's state at time `t`.
   *
   * Between two samples it is linearly interpolated. **Past the last sample it HOLDS** — the last known
   * state, marked stale with its age — because a car continued along its last vector drives through a wall,
   * and a map that invents a position is worse than one that admits it is a second behind (decided
   * 2026-08-06; 8/02 is what shows that staleness to the operator). Before the first sample, the first.
   */
  at(id: string, t: number): null | TrackState {
    const track = this.tracks.get(id);
    if (!track || track.length === 0) {
      return null;
    }
    const last = track.index(track.length - 1);
    if (t >= track.t[last]) {
      const ageMs = t - track.t[last];

      return state(track, last, track, last, 0, ageMs);
    }
    const first = track.index(0);
    if (t <= track.t[first]) {
      return state(track, first, track, first, 0, 0);
    }
    // Binary search for the last sample at or before `t`.
    let low = 0;
    let high = track.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (track.t[track.index(mid)] <= t) {
        low = mid;
      } else {
        high = mid;
      }
    }
    const a = track.index(low);
    const b = track.index(high);
    const span = track.t[b] - track.t[a];

    return state(track, a, track, b, span > 0 ? (t - track.t[a]) / span : 0, 0);
  }

  /** Drop a unit's history — it went off duty. */
  forget(id: string): void {
    this.tracks.delete(id);
  }

  /**
   * Take one board snapshot into the tracks. Called once per tick, whatever the tick rate: the policy in
   * this file decides what actually lands.
   */
  record(ops: Operations): void {
    for (const unit of ops.units) {
      let track = this.tracks.get(unit.id);
      if (!track) {
        track = new Track(this.capacity);
        this.tracks.set(unit.id, track);
      }
      track.push(ops.now, unit.at, unit.heading, STATUS_BY_ID.indexOf(unit.status));
    }
  }

  stats(): TrackStats {
    let samples = 0;
    let oldest = Infinity;
    let newest = -Infinity;
    for (const track of this.tracks.values()) {
      samples += track.length;
      if (track.length > 0) {
        oldest = Math.min(oldest, track.t[track.index(0)]);
        newest = Math.max(newest, track.t[track.index(track.length - 1)]);
      }
    }

    return {
      bytes: this.tracks.size * this.capacity * BYTES_PER_SAMPLE,
      capacity: this.capacity,
      samples,
      tracks: this.tracks.size,
      window: samples > 0 ? [oldest, newest] : null,
    };
  }
}

/** The short way round from `from` to `to`, radians — a unit turning past north must not spin backwards. */
function angleDelta(from: number, to: number): number {
  const delta = (to - from) % (Math.PI * 2);

  return delta > Math.PI ? delta - Math.PI * 2 : delta < -Math.PI ? delta + Math.PI * 2 : delta;
}

/** Interpolate between two ring slots. `status` is the EARLIER sample's — a status does not blend. */
function state(a: Track, ai: number, b: Track, bi: number, mix: number, ageMs: number): TrackState {
  return {
    ageMs,
    at: [a.x[ai] + (b.x[bi] - a.x[ai]) * mix, a.y[ai] + (b.y[bi] - a.y[ai]) * mix],
    heading: a.heading[ai] + angleDelta(a.heading[ai], b.heading[bi]) * mix,
    stale: ageMs > SAMPLE_INTERVAL_MS,
    status: STATUS_BY_ID[a.status[ai]] ?? 'available',
  };
}
