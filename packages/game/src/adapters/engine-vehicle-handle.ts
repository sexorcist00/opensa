/**
 * The own-engine implementation of {@link VehicleHandle} (plan 074/08 B5 step 4) — the twin of
 * `three-vehicle-handle.ts`. Where three had a scene graph to mutate, here everything is a part matrix or a
 * submesh-visibility flag on a `VehicleInstance`:
 *   - the chassis pose is the entity ROOT (GTA Z-up → engine Y-up rides in that one matrix);
 *   - wheels/doors are per-part animation rotations (the door's hinge pivot is baked into the part);
 *   - `_ok`/`_dam` and the `_vlo` LOD band are submesh visibility (which is exactly what `.visible` was);
 *   - a detached panel gets its own WORLD matrix, bypassing the root — the graph-free stand-in for
 *     three's `parent.attach()`.
 */
import type { VehicleInstance } from '@opensa/engine';
import type { VehicleModelData } from '@opensa/renderware';

import type { Vec3 } from '../interfaces/world-adapter.interface';
import type {
  VehicleBand,
  VehicleHandle,
  VehiclePartInfo,
  VehiclePose,
  VehicleQuat,
  VehicleWheelInfo,
  VehicleWheelPose,
} from '../vehicle/vehicle-handle';
import type { VehicleLampState } from '../vehicle/vehicle-lamps';

/**
 * Just the ARTICULATION a handle animates — doors, dummies, wheels, parts, submeshes — and nothing about
 * how the model reached the GPU. Both spawn paths satisfy it structurally: the unoptimized path's
 * `VehicleModelData` and the optimized path's `.osm` `DESC` fixture (opensa-pack 003).
 */
export type VehicleRigData = Pick<VehicleModelData, 'doors' | 'dummies' | 'parts' | 'submeshes' | 'wheels'>;

/** Column-major mat4 scratch for the detached-part world matrix. */
const WORLD = new Float32Array(16);

export class EngineVehicleHandle implements VehicleHandle {
  readonly hasLod: boolean;
  readonly parts: VehiclePartInfo[];
  readonly wheels: VehicleWheelInfo[];
  private band: VehicleBand = 'hd';
  private readonly damaged = new Set<string>();

  private readonly data: VehicleRigData;
  /**
   * Which `extraN` this CAR shows. SA's optional parts are mutually exclusive and the choice is a spawn
   * decision, not a build one — the model ships every alternative and each instance hides the rest, so a
   * street of the same car does not wear the same optional part. Null when the model has no extras (and on
   * a pak built before the builder started shipping them, where the choice was already baked in).
   */
  private readonly extra: null | string;

  private readonly instance: VehicleInstance;

  private readonly onDispose: () => void;

  /** The body's last rotation — a detaching panel inherits it (see `detachPart`). */
  private rotation: VehicleQuat = [0, 0, 0, 1];

  constructor(instance: VehicleInstance, data: VehicleRigData, onDispose: () => void) {
    this.instance = instance;
    this.data = data;
    this.onDispose = onDispose;
    this.hasLod = data.submeshes.some((submesh) => submesh.kind === 'lod');
    this.wheels = data.wheels.map((wheel) => ({ front: wheel.front, radius: wheel.radius }));
    // Damageable parts = those with a `_dam` twin, keyed by the damage group the builder paired them under.
    const groups = new Map<string, number>();
    for (const submesh of data.submeshes) {
      if (submesh.damageGroup !== null && !groups.has(submesh.damageGroup)) {
        groups.set(submesh.damageGroup, submesh.part);
      }
    }
    this.parts = [...groups].map(([name, part]) => ({
      name,
      position: [...data.parts[part].localTranslation] as [number, number, number],
    }));
    const extras = [
      ...new Set(data.submeshes.map((submesh) => submesh.extra).filter((name): name is string => !!name)),
    ];
    this.extra = extras.length > 0 ? extras[Math.floor(Math.random() * extras.length)] : null;
    this.setLodBand('hd'); // `_dam`, `_vlo` and the extras this car did not draw start hidden
  }

  detachPart(name: string): null | VehiclePose {
    const part = this.partIndex(name);
    if (part === null) {
      return null;
    }
    // The part's CURRENT world matrix is already flattened in the entity — read the position straight off it,
    // so the panel comes off exactly where it was (three got this from `attach()` preserving the transform).
    // Its orientation is the BODY's: a bolted-on panel shares the car's rotation, and handing back identity
    // would snap it flat the instant it detached from a car that was moving.
    const matrix = this.instance.entity.matrices.subarray(part * 16, part * 16 + 16);

    return { position: engineToGta([matrix[12], matrix[13], matrix[14]]), rotation: [...this.rotation] };
  }

  dispose(): void {
    this.onDispose();
  }

  doorHinge(side: string): null | Vec3 {
    const door = this.data.doors.find((candidate) => candidate.side === side);

    return door ? [...this.data.parts[door.part].localTranslation] : null;
  }

  lampAnchor(kind: 'head' | 'tail'): null | Vec3 {
    const dummy = this.data.dummies.find(
      (candidate) => candidate.name === (kind === 'head' ? 'headlights' : 'taillights'),
    );

    return dummy ? [...dummy.position] : null;
  }

  removeDetached(name: string): void {
    const part = this.partIndex(name);
    if (part !== null) {
      this.setPartSubmeshesVisible(part, false);
    }
  }

  setDetachedPose(name: string, pose: VehiclePose): void {
    const part = this.partIndex(name);
    if (part === null) {
      return;
    }
    writeWorld(WORLD, gtaToEngine(pose.position), pose.rotation);
    this.instance.entity.setPartWorldMatrix(part, WORLD);
  }

  setDoorAngle(side: string, angle: number): void {
    const door = this.data.doors.find((candidate) => candidate.side === side);
    if (door) {
      // The hinge frame IS the part's pivot (the builder put it there), so the swing is a plain Z rotation.
      this.instance.entity.setPartRotation(door.part, axisAngle(2, angle));
    }
  }

  setLamps(state: VehicleLampState): void {
    this.instance.setLamps(state.headlights, state.brakes, state.intensity);
  }

  setLodBand(band: VehicleBand): void {
    const showLod = band === 'vlo';
    const culled = band === 'culled';
    this.data.submeshes.forEach((submesh, index) => {
      const damaged = submesh.damageGroup !== null && this.damaged.has(submesh.damageGroup);
      let visible: boolean;
      if (submesh.kind === 'lod') {
        visible = showLod;
      } else if (submesh.kind === 'dam') {
        visible = !showLod && damaged;
      } else {
        visible = !showLod && !damaged;
      }
      // An optional part only exists on the car that drew it — the alternatives sit in the same spot and
      // would render as one overlapping jumble.
      const wrongExtra = !!submesh.extra && submesh.extra !== this.extra;
      this.instance.setSubmeshVisible(index, visible && !culled && !wrongExtra);
    });
    this.band = band;
  }

  setPartDamaged(name: string, damaged: boolean): void {
    if (damaged) {
      this.damaged.add(name);
    } else {
      this.damaged.delete(name);
    }
    this.setLodBand(this.band); // one place decides visibility — damage and LOD compose
  }
  setTransform(position: Vec3, rotation: VehicleQuat): void {
    this.rotation = rotation;
    writeWorld(WORLD, gtaToEngine(position), rotation);
    this.instance.entity.setRoot(WORLD);
  }
  setWheel(index: number, pose: VehicleWheelPose): void {
    const wheel = this.data.wheels[index];
    if (!wheel) {
      return;
    }
    // Steer about the vehicle's up (Z), then spin about the axle (X) — prod's composition order.
    this.instance.entity.setPartRotation(wheel.part, quatMul(axisAngle(2, pose.steer), axisAngle(0, pose.spin)));
    // Suspension travel: the wheel part slides along the body's local Z (the model frame is Z-up like GTA).
    this.instance.entity.setPartTranslation(wheel.part, [0, 0, pose.lift]);
  }

  private partIndex(name: string): null | number {
    const submesh = this.data.submeshes.find((candidate) => candidate.damageGroup === name);

    return submesh ? submesh.part : null;
  }

  private setPartSubmeshesVisible(part: number, visible: boolean): void {
    this.data.submeshes.forEach((submesh, index) => {
      if (submesh.part === part) {
        this.instance.setSubmeshVisible(index, visible);
      }
    });
  }
}

/** GTA (Z-up) world position → the engine's Y-up frame. Exported alongside {@link writeGtaRoot}. */
export function gtaPositionToEngine(position: Vec3): [number, number, number] {
  return gtaToEngine(position);
}

/**
 * Column-major root: translate(engine position) × (GTA Z-up → engine Y-up basis change) × R(body rotation).
 * The geometry stays in its native RW frame; this one matrix carries the whole convention. Exported because
 * the SEATED PLAYER needs exactly the same math — prod seats the rider on the car's FULL transform (so he
 * tilts and rolls with it), which a yaw-only matrix cannot express.
 */
export function writeGtaRoot(
  out: Float32Array,
  position: readonly [number, number, number],
  rotation: VehicleQuat,
): void {
  writeWorld(out, position, rotation);
}

/** Axis-angle quaternion about axis 0 = X, 1 = Y, 2 = Z (vehicle-local, native GTA axes). */
function axisAngle(axis: number, angle: number): [number, number, number, number] {
  const half = angle / 2;
  const s = Math.sin(half);
  const quat: [number, number, number, number] = [0, 0, 0, Math.cos(half)];
  quat[axis] = s;

  return quat;
}

/** Engine (Y-up) → GTA (Z-up): the inverse of {@link gtaToEngine}. */
function engineToGta(position: readonly [number, number, number]): Vec3 {
  return [position[0], -position[2], position[1]];
}

/** GTA (Z-up) → engine (Y-up): e = (x, z, −y), the same axis change the cell converter bakes. */
function gtaToEngine(position: Vec3): [number, number, number] {
  return [position[0], position[2], -position[1]];
}

function quatMul(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] + a[1] * b[3] + a[2] * b[0] - a[0] * b[2],
    a[3] * b[2] + a[2] * b[3] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function writeWorld(out: Float32Array, position: readonly [number, number, number], rotation: VehicleQuat): void {
  const [x, y, z, w] = rotation;
  // R (GTA space), column-major 3×3.
  const r = [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
  ];
  // Basis change B = (x, z, −y) applied to each rotated column: engine = B · R.
  for (let column = 0; column < 3; column += 1) {
    const [rx, ry, rz] = [r[column * 3], r[column * 3 + 1], r[column * 3 + 2]];
    out[column * 4] = rx;
    out[column * 4 + 1] = rz;
    out[column * 4 + 2] = -ry;
    out[column * 4 + 3] = 0;
  }
  out[12] = position[0];
  out[13] = position[1];
  out[14] = position[2];
  out[15] = 1;
}
