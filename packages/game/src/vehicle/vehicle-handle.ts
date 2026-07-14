/**
 * The renderer-agnostic handle gameplay drives a car through (plan 074/08 B5 step 3).
 *
 * Vehicle logic used to hold three `Object3D` refs — the chassis, the wheel spinners, the door pivots, the
 * `_ok`/`_dam` mesh pairs — and mutate them directly (`.quaternion.copy`, `.visible = false`,
 * `parent.attach()`). The own engine has no scene graph to mutate, so both renderers implement this instead
 * and the logic above it stays identical. Everything crossing this boundary is plain data.
 */
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { VehicleLampState } from './vehicle-lamps';

/** Distance band a car falls into, near → far. */
export type VehicleBand = 'culled' | 'hd' | 'vlo';

export interface VehicleHandle {
  /**
   * Detach a part into WORLD space: it stops following the car, and the caller integrates its fall. Returns
   * the pose it detached at (native Z-up), or null when the part is unknown.
   */
  detachPart(name: string): null | VehiclePose;
  dispose(): void;
  /** A door's hinge centre in vehicle space — the walk-up routing reads it. */
  doorHinge(side: string): null | Vec3;
  /** True when the model carries a `_vlo` low-detail mesh (else the LOD band stays HD). */
  readonly hasLod: boolean;
  /**
   * The `headlights` / `taillights` dummy in vehicle space (SA authors ONE per end and mirrors it), or null
   * when the model has none — the caller then falls back to the half-extents.
   */
  lampAnchor(kind: 'head' | 'tail'): null | Vec3;
  /** Damageable body parts — the damage system's entire world model. */
  readonly parts: readonly VehiclePartInfo[];
  /** Drop a detached part for good. */
  removeDetached(name: string): void;
  /** Pose a detached part in world space (native Z-up). */
  setDetachedPose(name: string, pose: VehiclePose): void;
  /** Swing a door about its hinge (radians; 0 = closed). */
  setDoorAngle(side: string, angle: number): void;
  /**
   * Lamp state for THIS car. SA swaps the lamp texture to its lit twin and glows the glass; brakes take the
   * tail lamps from their dim running level to full. Per-VEHICLE, not global: only the driven car lights up.
   */
  setLamps(state: VehicleLampState): void;
  setLodBand(band: VehicleBand): void;
  /** Swap a part between its intact and damaged meshes. */
  setPartDamaged(name: string, damaged: boolean): void;
  /** Chassis pose from the rigid body (native Z-up). */
  setTransform(position: Vec3, rotation: VehicleQuat): void;
  /** One wheel's spin (about the axle) and steer (about up), in radians. */
  setWheel(index: number, spin: number, steer: number): void;
  readonly wheels: readonly VehicleWheelInfo[];
}

/** A damageable body part: its name and centre in vehicle space (for mapping a hit to the part). */
export interface VehiclePartInfo {
  /** Part name without the `_ok`/`_dam` suffix (e.g. `bonnet`, `door_lf`). */
  name: string;
  position: [number, number, number];
}

export interface VehiclePose {
  position: Vec3;
  rotation: VehicleQuat;
}

/** Quaternion (x, y, z, w). */
export type VehicleQuat = [number, number, number, number];

export interface VehicleWheelInfo {
  /** Front wheels steer; all wheels spin. */
  front: boolean;
  /** Wheel radius in world units (roll = distance / radius). */
  radius: number;
}
