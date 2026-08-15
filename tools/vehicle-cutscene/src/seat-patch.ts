/**
 * The seat retarget (plan 005). A cutscene actor's position is ABSOLUTE — it comes from the scene's
 * own root channel in `anim/cuts.img` — while `ped_frontseat` is read by the GAMEPLAY code only. R*
 * authored every scene against their own car and, measurably, at ±its `ped_frontseat` (x within
 * 0.02 m, z within 0.03 m across FINAL2B and SMOKE2B). So a converted donor whose cabin rides higher
 * seats its occupants low — 0.281 m on the glendale, the field's "they just sit low" — and no static
 * model data can correct it: the actor is not in the car's clump.
 *
 * So this patches the SCENE VALUE, the same way the wheel stash does (`stash-patch.ts`): an actor who
 * rides inside a converted car for the whole scene has his root channel lifted onto the DONOR's own
 * seat. Z ONLY — the pose is authored for R*'s cabin, and moving an actor sideways or forward would
 * take his hands off the wheel; the vertical is the whole measured defect.
 *
 * The ANPK walk mirrors `anim-poses.ts`; the write is in-place (4 bytes per keyframe), everything else
 * byte-verbatim.
 */
import { buildVer2Buffer, openArchive } from '@opensa/renderware/archive/img-archive';

import type { Vec3 } from './rig/matrix';

import { matchSeat, type SeatPoint } from './seats';

/** The box an offset must stay inside to count as riding the car — a cabin, generously. */
const CABIN = { x: 1.3, y: 2.2, z: 1.0 };
/** Spread above which a pair is drifting rather than riding (metres). */
const MAX_SPREAD = 0.12;
/** Too few frames to judge. */
const MIN_FRAMES = 30;
/**
 * The share of the scene an actor must ride for his WHOLE track to be liftable. The measured
 * distribution across the fleet is 100 % / 99 % against 92 % / 85 % — a clean gap, and the low pair are
 * exactly the actors who walk up and get in (SMOKE2B's cssmoke, PROLOG1's csstew). Lifting one of
 * those would float him on his way to the door, so v1 leaves them to the scene; a partial lift needs a
 * blend and its own field round.
 */
const FULLY_SEATED_PERCENT = 98;
/**
 * Corrections below this are not applied (metres). R* authored the scenes at the stock car's own
 * `ped_frontseat`, but only to within 0.03 m — so a delta smaller than that is indistinguishable from
 * the authoring's own noise, and moving an actor for it would be churn on scenes nobody complained
 * about. Measured effect: FINAL2B's two actors (deltas of 0.03 m) stay exactly as authored, and the
 * fleet-wide patch reduces to the one site the field actually reported.
 */
const MIN_CORRECTION = 0.05;

/** One object's root channel: where its keyframes live and the translation of each. */
export interface RootChannel {
  readonly frames: number;
  /** Byte offset of the KRT0 chunk — its rows start 8 bytes later, 32 B each. */
  readonly keyframesAt: number;
  readonly translations: Vec3[];
}

export interface SeatPatchResult {
  bytes: null | Uint8Array;
  /** One `<scene.ifp> <car> <actor> <dz>` row per lifted actor (empty = nothing matched, bytes null). */
  patched: string[];
}

/**
 * Whether an actor RIDES a car, and at what mean car-local offset. A track shorter than the scene is a
 * STATIC pose and holds its last value, the way the engine does — a parked car gets 5 keyframes, and
 * comparing only the overlap misses every scene whose car never moves.
 */
export function judgeRide(
  actor: readonly Vec3[],
  car: readonly Vec3[],
): null | { frames: number; offset: Vec3; percent: number; spread: number } {
  const frames = Math.max(actor.length, car.length);
  if (frames < MIN_FRAMES) {
    return null;
  }
  const at = (track: readonly Vec3[], frame: number): Vec3 => track[Math.min(frame, track.length - 1)];
  const inside: Vec3[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const [a, c] = [at(actor, frame), at(car, frame)];
    const offset: Vec3 = [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
    if (Math.abs(offset[0]) < CABIN.x && Math.abs(offset[1]) < CABIN.y && Math.abs(offset[2]) < CABIN.z) {
      inside.push(offset);
    }
  }
  if (inside.length < frames * 0.5) {
    return null;
  }
  const offset = [0, 1, 2].map((axis) => inside.reduce((sum, o) => sum + o[axis], 0) / inside.length) as Vec3;
  const spread = Math.sqrt(
    inside.reduce((sum, o) => sum + [0, 1, 2].reduce((t, axis) => t + (o[axis] - offset[axis]) ** 2, 0), 0) /
      inside.length,
  );

  return spread > MAX_SPREAD ? null : { frames, offset, percent: (100 * inside.length) / frames, spread };
}

/**
 * Return a rebuilt `cuts.img` with every fully-seated actor lifted onto his car's donor seat, or
 * `bytes: null` when nothing matches. `seatsBySlot`: per cs model (lowercased) the seat points the
 * converter resolved — a slot absent from the map, or carrying no seat, is left exactly as authored.
 */
export function patchActorSeats(
  cutsImgBytes: Uint8Array,
  seatsBySlot: ReadonlyMap<string, readonly SeatPoint[]>,
  isActor: (model: string) => boolean,
): SeatPatchResult {
  const archive = openArchive(cutsImgBytes);
  const patched: string[] = [];
  const entries: { data: Uint8Array; name: string }[] = [];
  for (const name of archive.names) {
    const buf = archive.get(name);
    if (!buf) {
      continue;
    }
    const data = new Uint8Array(buf.slice(0));
    if (name.endsWith('.ifp')) {
      for (const hit of liftSeatedActors(data, seatsBySlot, isActor)) {
        patched.push(`${name} ${hit}`);
      }
    }
    entries.push({ data, name });
  }

  return patched.length === 0 ? { bytes: null, patched } : { bytes: buildVer2Buffer(entries), patched };
}

/**
 * Per object (lowercased), its FIRST KRT0 channel — the root. Exported because the census debug script
 * reads the same thing, and a second copy of this walk would drift from this one.
 */
export function readRootChannels(data: Uint8Array): Map<string, RootChannel> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = (at: number): string => String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3]);
  const align = (value: number): number => (value + 3) & ~3;
  const cstr = (at: number, max: number): string => {
    let out = '';
    for (let i = 0; i < max && data[at + i] !== 0; i += 1) {
      out += String.fromCharCode(data[at + i]);
    }

    return out.trim().toLowerCase();
  };

  const roots = new Map<string, RootChannel>();
  let pos = 8; // inside the ANPK container
  let object = '';
  while (pos + 8 <= data.length) {
    const kind = tag(pos);
    const size = view.getUint32(pos + 4, true);
    if (kind === 'NAME') {
      object = cstr(pos + 8, size);
      pos = align(pos + 8 + size);
    } else if (kind === 'DGAN' || kind === 'CPAN') {
      pos += 8; // containers: descend
    } else if (kind === 'ANIM') {
      const keyframesAt = align(pos + 8 + size);
      if (!roots.has(object) && keyframesAt + 8 <= data.length && tag(keyframesAt) === 'KRT0') {
        const channel = readKrt0(view, data.length, keyframesAt, view.getUint32(pos + 36, true));
        if (channel.translations.length > 1) {
          roots.set(object, channel);
        }
      }
      pos = keyframesAt;
    } else {
      pos = align(pos + 8 + size); // INFO / keyframe blocks / unknowns
    }
  }

  return roots;
}

/** Lift matching actors in ONE ANPK ifp in place; returns `<car> <actor> <dz>` per lifted actor. */
function liftSeatedActors(
  data: Uint8Array,
  seatsBySlot: ReadonlyMap<string, readonly SeatPoint[]>,
  isActor: (model: string) => boolean,
): string[] {
  const roots = readRootChannels(data);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const hits: string[] = [];
  for (const [car, carChannel] of roots) {
    const seats = seatsBySlot.get(car);
    if (!seats?.length) {
      continue;
    }
    for (const [actor, actorChannel] of roots) {
      // A PROP rides a vehicle too — the mothership's stand sat 1.6 m from a seat point.
      const dz = isActor(actor) ? seatCorrection(actorChannel, carChannel, seats) : null;
      if (dz === null) {
        continue;
      }
      for (let frame = 0; frame < actorChannel.frames; frame += 1) {
        const at = actorChannel.keyframesAt + 8 + frame * 32 + 24; // the translation's z
        view.setFloat32(at, view.getFloat32(at, true) + dz, true);
      }
      hits.push(`${car} ${actor} ${dz >= 0 ? '+' : ''}${dz.toFixed(3)}`);
    }
  }

  return hits;
}

/** One KRT0 block's translations. Rows are 32 B: quat 16 + trans 12 + time 4. */
function readKrt0(view: DataView, limit: number, keyframesAt: number, frames: number): RootChannel {
  const translations: Vec3[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const at = keyframesAt + 8 + frame * 32 + 16; // past the chunk header and the quaternion
    if (at + 12 > limit) {
      break;
    }
    translations.push([view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)]);
  }

  return { frames: translations.length, keyframesAt, translations };
}

/**
 * The z lift this actor's whole track needs to sit on the donor's seat, or null when he must be left
 * alone: not riding, riding for only part of the scene, matching no seat, or already close enough.
 */
function seatCorrection(actor: RootChannel, car: RootChannel, seats: readonly SeatPoint[]): null | number {
  const ride = judgeRide(actor.translations, car.translations);
  if (!ride || ride.percent < FULLY_SEATED_PERCENT) {
    return null;
  }
  const seat = matchSeat(seats, ride.offset);
  if (!seat) {
    return null;
  }
  const dz = seat.position[2] - ride.offset[2];

  return Math.abs(dz) < MIN_CORRECTION ? null : dz;
}
