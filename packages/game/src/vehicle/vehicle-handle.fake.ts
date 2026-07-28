/**
 * A recording {@link VehicleHandle} for the vehicle-system tests (B5 step 3). The systems used to be tested
 * through three `Object3D` flags (`.visible`, `.parent`); now they are tested through the contract they
 * actually depend on, which is what both renderers implement.
 */
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type {
  VehicleBand,
  VehicleHandle,
  VehiclePartInfo,
  VehiclePose,
  VehicleQuat,
  VehicleWheelInfo,
  VehicleWheelPose,
} from './vehicle-handle';
import type { VehicleLampState } from './vehicle-lamps';

export class FakeVehicleHandle implements VehicleHandle {
  band: VehicleBand = 'hd';
  /** Parts currently swapped to their damaged mesh. */
  readonly damaged = new Set<string>();
  /** Parts cut loose into world space (and not yet removed). */
  readonly detached = new Set<string>();
  disposed = false;
  readonly doorAngles = new Map<string, number>();
  readonly hasLod: boolean;
  readonly hinges = new Map<string, Vec3>();
  readonly lampAnchors = new Map<'head' | 'tail', Vec3>();
  lamps: null | VehicleLampState = null;
  readonly parts: VehiclePartInfo[];
  /** Last {@link setPopUpLights} value, 0 (parked) … 1 (up). */
  popUpLights = 0;
  /** Last pose pushed per detached part. */
  readonly poses = new Map<string, VehiclePose>();
  position: Vec3 = [0, 0, 0];
  readonly removed = new Set<string>();
  rotation: VehicleQuat = [0, 0, 0, 1];
  readonly wheels: VehicleWheelInfo[];
  readonly wheelState: VehicleWheelPose[] = [];

  constructor(parts: VehiclePartInfo[] = [], wheels: VehicleWheelInfo[] = [], hasLod = false) {
    this.parts = parts;
    this.wheels = wheels;
    this.hasLod = hasLod;
  }

  detachPart(name: string): null | VehiclePose {
    if (!this.parts.some((part) => part.name === name)) {
      return null;
    }
    this.detached.add(name);

    return { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  }

  dispose(): void {
    this.disposed = true;
  }

  doorHinge(side: string): null | Vec3 {
    return this.hinges.get(side) ?? null;
  }

  lampAnchor(kind: 'head' | 'tail'): null | Vec3 {
    return this.lampAnchors.get(kind) ?? null;
  }

  removeDetached(name: string): void {
    this.detached.delete(name);
    this.removed.add(name);
  }

  setDetachedPose(name: string, pose: VehiclePose): void {
    this.poses.set(name, pose);
  }

  setDoorAngle(side: string, angle: number): void {
    this.doorAngles.set(side, angle);
  }

  setLamps(state: VehicleLampState): void {
    this.lamps = state;
  }

  setLodBand(band: VehicleBand): void {
    this.band = band;
  }

  setPartDamaged(name: string, damaged: boolean): void {
    if (damaged) {
      this.damaged.add(name);
    } else {
      this.damaged.delete(name);
    }
  }

  setPopUpLights(open: number): void {
    this.popUpLights = open;
  }

  setTransform(position: Vec3, rotation: VehicleQuat): void {
    this.position = position;
    this.rotation = rotation;
  }

  setWheel(index: number, pose: VehicleWheelPose): void {
    this.wheelState[index] = { ...pose };
  }
}
