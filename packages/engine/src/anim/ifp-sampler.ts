/**
 * Own IFP clip sampler (plan 074/08, the B1 probe): keyframe slerp over pre-extracted clip tracks → a bone
 * palette (world × inverseBind per bone, column-major mat4). The prod path rode three's AnimationMixer —
 * NOT portable; this is the thin replacement the dynamics milestone builds on. Pure math, no dependencies.
 *
 * Conventions (fixed by the probe fixture, `tools/opensa-pack/src/ped-probe.ts`):
 * - bones are in SKIN order, parents point at skin indices (−1 = root), locals = frame bind pose;
 * - a bone with an empty track holds its bind rotation (prod behaviour);
 * - root translation is NOT animated (locomotion stays in-place — gameplay owns the position);
 * - the palette buffer layout is [model matrix, bone 0, bone 1, …] — the sampler writes from slot 1.
 */

export interface SamplerBone {
  bindPosition: readonly [number, number, number];
  bindRotation: readonly [number, number, number, number];
  /** 16 floats, column-major (bone → model space inverted). */
  inverseBind: readonly number[];
  /** Skin-order parent index; −1 for the root. */
  parent: number;
}

export interface SamplerClip {
  duration: number;
  /** Per skin-order bone: keyframe times (seconds, ascending) + quats (x,y,z,w × keyCount). */
  tracks: readonly { quats: readonly number[]; times: readonly number[] }[];
}

/** Scratch reused across frames (bone count fixed per fixture) — the steady-state frame allocates zero. */
export class IfpSampler {
  private readonly local = new Float32Array(16);
  private readonly quat = new Float32Array(4);
  private readonly worlds: Float32Array;

  constructor(private readonly bones: readonly SamplerBone[]) {
    this.worlds = new Float32Array(bones.length * 16);
  }

  /** Sample `clip` at `time` (wraps by duration) and write bone palettes into `out` from `outSlot`. */
  sample(clip: SamplerClip, time: number, out: Float32Array, outSlot = 1): void {
    const looped = clip.duration > 0 ? time % clip.duration : 0;
    for (let bone = 0; bone < this.bones.length; bone += 1) {
      const definition = this.bones[bone];
      const track = clip.tracks[bone];
      if (track && track.times.length > 0) {
        sampleQuat(track, looped, this.quat);
      } else {
        this.quat.set(definition.bindRotation);
      }
      composeLocal(this.local, this.quat, definition.bindPosition);
      const world = this.worlds.subarray(bone * 16, bone * 16 + 16);
      if (definition.parent >= 0) {
        multiply(world, this.worlds.subarray(definition.parent * 16, definition.parent * 16 + 16), this.local);
      } else {
        world.set(this.local);
      }
      multiply(out.subarray((outSlot + bone) * 16, (outSlot + bone) * 16 + 16), world, definition.inverseBind);
    }
  }
}

/** out = translation(position) × rotation(quat), column-major mat4. Shared with the rigid-entity layer. */
export function composePosQuat(
  out: Float32Array,
  quat: ArrayLike<number>,
  position: readonly [number, number, number],
): void {
  composeLocal(out, quat, position);
}

/** out = a × b (column-major 4×4); `out` must not alias inputs. Shared with the rigid-entity layer. */
export function mulMat4(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>): void {
  multiply(out, a, b);
}

/** local = translation(bindPosition) × rotation(quat), column-major. */
function composeLocal(out: Float32Array, quat: ArrayLike<number>, position: readonly [number, number, number]): void {
  const [x, y, z, w] = [quat[0], quat[1], quat[2], quat[3]];
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  out[0] = 1 - (yy + zz);
  out[1] = xy + wz;
  out[2] = xz - wy;
  out[3] = 0;
  out[4] = xy - wz;
  out[5] = 1 - (xx + zz);
  out[6] = yz + wx;
  out[7] = 0;
  out[8] = xz + wy;
  out[9] = yz - wx;
  out[10] = 1 - (xx + yy);
  out[11] = 0;
  out[12] = position[0];
  out[13] = position[1];
  out[14] = position[2];
  out[15] = 1;
}

function copyQuat(out: Float32Array, quats: readonly number[], at: number): void {
  out[0] = quats[at];
  out[1] = quats[at + 1];
  out[2] = quats[at + 2];
  out[3] = quats[at + 3];
}

/** out = a × b (column-major 4×4). `out` must not alias `a` or `b`. */
function multiply(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>): void {
  for (let column = 0; column < 4; column += 1) {
    const b0 = b[column * 4];
    const b1 = b[column * 4 + 1];
    const b2 = b[column * 4 + 2];
    const b3 = b[column * 4 + 3];
    out[column * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[column * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[column * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[column * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
}

/** Binary-search the keyframe pair around `time`, slerp into `out` (shortest path). */
function sampleQuat(
  track: { quats: readonly number[]; times: readonly number[] },
  time: number,
  out: Float32Array,
): void {
  const times = track.times;
  const last = times.length - 1;
  if (time <= times[0]) {
    copyQuat(out, track.quats, 0);

    return;
  }
  if (time >= times[last]) {
    copyQuat(out, track.quats, last * 4);

    return;
  }
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (times[mid] <= time) {
      low = mid;
    } else {
      high = mid;
    }
  }
  const t = (time - times[low]) / (times[high] - times[low] || 1);
  slerp(out, track.quats, low * 4, high * 4, t);
}

function slerp(out: Float32Array, quats: readonly number[], a: number, b: number, t: number): void {
  let bx = quats[b];
  let by = quats[b + 1];
  let bz = quats[b + 2];
  let bw = quats[b + 3];
  const ax = quats[a];
  const ay = quats[a + 1];
  const az = quats[a + 2];
  const aw = quats[a + 3];
  let cosom = ax * bx + ay * by + az * bz + aw * bw;
  if (cosom < 0) {
    cosom = -cosom;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let scale0: number;
  let scale1: number;
  if (1 - cosom > 1e-6) {
    const omega = Math.acos(Math.min(1, cosom));
    const sinom = Math.sin(omega);
    scale0 = Math.sin((1 - t) * omega) / sinom;
    scale1 = Math.sin(t * omega) / sinom;
  } else {
    scale0 = 1 - t;
    scale1 = t;
  }
  out[0] = scale0 * ax + scale1 * bx;
  out[1] = scale0 * ay + scale1 * by;
  out[2] = scale0 * az + scale1 * bz;
  out[3] = scale0 * aw + scale1 * bw;
}
