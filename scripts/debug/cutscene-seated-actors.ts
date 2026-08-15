import { openArchive } from '@opensa/renderware/archive/img-archive';
import { readFileSync } from 'node:fs';

/**
 * cutscene-seated-actors — which cutscenes seat an ACTOR inside a converted CAR, and the car-local
 * offset they ride at. The input to plan 005 (seat retarget) and the guard on its patch pass: a
 * cutscene actor's position is ABSOLUTE out of `anim/cuts.img`, so a donor whose cabin rides higher
 * than R*'s seats its occupants low (measured 0.281 m on SMOKE2B) and nothing in the model can fix it.
 *
 * A pair counts as SEATED when the actor's root offset from the car's root stays inside a cabin box
 * with a standard deviation under 12 cm. The two traps, both paid for:
 *   - a track shorter than the scene is a STATIC pose (a parked car gets 5 keyframes), so a short
 *     track HOLDS its last value the way the engine does — comparing only the overlap made the first
 *     census miss RIOT_4B's greenwood entirely;
 *   - props ride vehicles too (an ammo box on the bobcat's bed, the mothership's stand). The census
 *     reports them; the caller decides what is a person.
 *
 * The `seated %` column is what decides whether a pair may be patched at all: an actor who walks up
 * and gets in is seated for only part of the scene, and lifting his whole root track would float him
 * while he walks.
 *
 * Run: `npx tsx scripts/debug/cutscene-seated-actors.ts <cuts.img> <car,car,...>`
 *      `npx tsx scripts/debug/cutscene-seated-actors.ts build/original/opensa/anim/cuts.img csglendale92,csbravura`
 */
const [imgPath, carList] = process.argv.slice(2);
if (!imgPath || !carList) {
  throw new Error('usage: cutscene-seated-actors.ts <cuts.img> <car,car,...>');
}

/** Cabin box the offset must stay inside, and the spread above which a pair is not "riding". */
const CABIN = { x: 1.3, y: 2.2, z: 1.0 };
const MAX_SPREAD = 0.12;
/** Below this many frames a pair is not worth judging. */
const MIN_FRAMES = 30;

type Vec3 = [number, number, number];

const cars = new Set(carList.split(',').map((name) => name.trim().toLowerCase()));
const archive = openArchive(new Uint8Array(readFileSync(imgPath)));

for (const entry of archive.names.filter((name) => name.endsWith('.ifp')).sort()) {
  const roots = readRootTracks(new Uint8Array(archive.get(entry)!));
  const scene = entry.replace('.ifp', '').toUpperCase();
  for (const [car, carTrack] of roots) {
    if (!cars.has(car)) {
      continue;
    }
    for (const [actor, actorTrack] of roots) {
      if (cars.has(actor)) {
        continue;
      }
      const seated = judgeSeated(actorTrack, carTrack);
      if (seated) {
        console.log(
          `${scene.padEnd(9)} ${car.padEnd(15)} ${actor.padEnd(15)} ` +
            `offset=[${seated.offset.map((v) => v.toFixed(2)).join(', ')}] ` +
            `spread=${seated.spread.toFixed(3)} seated ${seated.percent.toFixed(0)}% of ${seated.frames} frames`,
        );
      }
    }
  }
}

/** Mean offset + spread over the frames the actor rides inside the cabin, or null when it never does. */
function judgeSeated(
  actor: Vec3[],
  car: Vec3[],
): null | { frames: number; offset: Vec3; percent: number; spread: number } {
  const frames = Math.max(actor.length, car.length);
  if (frames < MIN_FRAMES) {
    return null;
  }
  // A short track is a static pose: hold its last value, as the engine does.
  const at = (track: Vec3[], frame: number): Vec3 => track[Math.min(frame, track.length - 1)];
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

/** Every frame's translation in one KRT0 block. Rows are 32 B (quat 16 + trans 12 + time 4) and the
 *  frame count comes from the chunk's own SIZE, never from a header field. */
function readKrt0Translations(view: DataView, limit: number, keyframesAt: number): Vec3[] {
  const frames = Math.floor(view.getUint32(keyframesAt + 4, true) / 32);
  const track: Vec3[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const at = keyframesAt + 8 + frame * 32 + 16; // past the chunk header and the quaternion
    if (at + 12 > limit) {
      break;
    }
    track.push([view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)]);
  }

  return track;
}

/**
 * Per object (lowercased), the translations of its FIRST KRT0 channel — the root. The ANPK walk mirrors
 * `tools/vehicle-cutscene/src/anim-poses.ts`; the frame count comes from the keyframe chunk's own SIZE
 * (KRT0 rows are 32 B), never from a header field.
 */
function readRootTracks(data: Uint8Array): Map<string, Vec3[]> {
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

  const roots = new Map<string, Vec3[]>();
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
        const track = readKrt0Translations(view, data.length, keyframesAt);
        if (track.length > 1) {
          roots.set(object, track);
        }
      }
      pos = keyframesAt;
    } else {
      pos = align(pos + 8 + size); // INFO / keyframe blocks / unknowns
    }
  }

  return roots;
}
