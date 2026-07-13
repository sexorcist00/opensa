/**
 * Rigid-part dynamic entity (plan 074/08 B2): a vehicle-style part hierarchy flattened on the CPU each
 * frame into ONE matrix storage buffer — parts draw with `firstInstance = part index`, the vertex shader
 * reads `matrices[instance_index]`. NEVER inside static bundles (the 073 barberpole lesson). Pure CPU
 * state here; the GPU side (buffers/bind group/draws) lives in the engine facade like the ped probe.
 */
import { composePosQuat, mulMat4 } from '../anim/ifp-sampler';

export interface RigidPartInit {
  localRotation: readonly [number, number, number, number];
  localTranslation: readonly [number, number, number];
  name: string;
}

/** Host-side handle: set the root + per-part animation rotations, then `flatten()` before upload. */
export class RigidEntity {
  /** Flattened world matrices, one mat4 per part — the storage-buffer payload. */
  readonly matrices: Float32Array;

  get partCount(): number {
    return this.parts.length;
  }
  private readonly animQuat: Float32Array;
  private readonly local = new Float32Array(16);
  private readonly quat = new Float32Array(4);
  private readonly root = new Float32Array(16);

  private readonly scratch = new Float32Array(16);

  constructor(private readonly parts: readonly RigidPartInit[]) {
    this.matrices = new Float32Array(parts.length * 16);
    this.animQuat = new Float32Array(parts.length * 4);
    for (let part = 0; part < parts.length; part += 1) {
      this.animQuat[part * 4 + 3] = 1; // identity
    }
    this.root.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  /** Recompute every part's world matrix: root × T(local) × R(localQ ⊗ animQ). */
  flatten(): void {
    for (let part = 0; part < this.parts.length; part += 1) {
      const definition = this.parts[part];
      quatMultiply(this.quat, definition.localRotation, this.animQuat.subarray(part * 4, part * 4 + 4));
      composePosQuat(this.local, this.quat, definition.localTranslation);
      mulMat4(this.matrices.subarray(part * 16, part * 16 + 16), this.root, this.local);
    }
  }

  partIndex(name: string): number {
    return this.parts.findIndex((part) => part.name === name);
  }

  /** Per-part animation rotation (wheel spin/steer, doors later) — applied AFTER the bind-local rotation. */
  setPartRotation(part: number, quat: readonly [number, number, number, number]): void {
    this.animQuat.set(quat, part * 4);
  }

  /** Column-major root matrix (the host owns axis conventions — GTA→engine change rides here). */
  setRoot(matrix: ArrayLike<number>): void {
    this.root.set(matrix);
  }
}

/** out = a ⊗ b (quaternion product, xyzw). */
export function quatMultiply(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>): void {
  const [ax, ay, az, aw] = [a[0], a[1], a[2], a[3]];
  const [bx, by, bz, bw] = [b[0], b[1], b[2], b[3]];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by + ay * bw + az * bx - ax * bz;
  out[2] = aw * bz + az * bw + ax * by - ay * bx;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}
