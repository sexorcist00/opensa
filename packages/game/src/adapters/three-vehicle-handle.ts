/**
 * The three-WebGL implementation of {@link VehicleHandle} (plan 074/08 B5 step 3).
 *
 * Every scene-graph mutation vehicle gameplay used to perform inline now lives here: the chassis transform,
 * the wheel spinners, the door hinges, the `_ok`/`_dam` visibility swap, the `_vlo` LOD band, and the
 * re-parenting of a detached panel into the streaming root. Behaviour is unchanged from the pre-B5 code —
 * this is a move, not a rewrite.
 */
import type { BuiltPart, BuiltVehicle } from '@opensa/renderware';
import type { Mesh, MeshStandardMaterial, Object3D, Texture } from 'three';

import { Quaternion, Vector3 } from 'three';

import type { Vec3 } from '../interfaces/world-adapter.interface';
import type {
  VehicleBand,
  VehicleHandle,
  VehiclePartInfo,
  VehiclePose,
  VehicleQuat,
  VehicleWheelInfo,
} from '../vehicle/vehicle-handle';
import type { VehicleLampState } from '../vehicle/vehicle-lamps';

/** Lamp glow colours (rendered, not the marker colours): warm-white head, red tail. */
const HEAD_COLOR = 0xfff2d0;
const TAIL_COLOR = 0xff1808;
/**
 * Lamp-glass emissive strengths (× the config intensity). Pushed clearly PAST the bloom threshold (0.7) so
 * the lamps bloom into a soft halo the way the baked night sources do (plan 071) — an emissive that only just
 * reaches 1.0 clips in the LDR buffer and barely blooms. Brake > head so it reads as the brighter light.
 */
const HEAD_EMISSIVE = 2.4;
const TAIL_RUN_EMISSIVE = 1;
const TAIL_BRAKE_EMISSIVE = 4;

/** Steer/hinge axis: the vehicle's up (native Z-up). */
const UP = new Vector3(0, 0, 1);
/** Spin axis: the wheel axle (left-right) in the spinner's local space. */
const AXLE = new Vector3(1, 0, 0);

export class ThreeVehicleHandle implements VehicleHandle {
  readonly hasLod: boolean;
  /** The render root — the HOST adds/removes it from the streaming root; gameplay never sees it. */
  readonly object: Object3D;
  readonly parts: VehiclePartInfo[];
  readonly wheels: VehicleWheelInfo[];
  private readonly built: BuiltVehicle;
  /** Cached tagged lamp materials — found once by traversal, then poked per frame (brake brightness). */
  private lampMaterials: null | { heads: MeshStandardMaterial[]; tails: MeshStandardMaterial[] } = null;
  private lampsOn = false;
  private readonly scratch = new Quaternion();

  constructor(built: BuiltVehicle) {
    this.built = built;
    this.object = built.root;
    this.hasLod = built.lod !== null;
    this.parts = built.parts.map((part) => ({ name: part.name, position: part.position }));
    this.wheels = built.wheels.map((wheel) => ({ front: wheel.front, radius: wheel.radius }));
  }

  detachPart(name: string): null | VehiclePose {
    const part = this.partByName(name);
    if (!part) {
      return null;
    }
    // Re-parent to the streaming root, PRESERVING the world transform — `attach` is what makes the panel
    // stay put at the instant it comes off instead of snapping to the car's origin.
    this.object.parent?.attach(part.pivot);
    const { position, quaternion } = part.pivot;

    return {
      position: [position.x, position.y, position.z],
      rotation: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    };
  }

  dispose(): void {
    disposeVehicle(this.object);
  }

  doorHinge(side: string): null | Vec3 {
    const door = this.built.doors.find((candidate) => candidate.side === side);
    if (!door) {
      return null;
    }
    const { position } = door.pivot;

    return [position.x, position.y, position.z];
  }

  lampAnchor(kind: 'head' | 'tail'): null | Vec3 {
    const key = kind === 'head' ? 'headlightDummy' : 'taillightDummy';
    const dummy = this.object.userData[key] as [number, number, number] | null | undefined;

    return dummy ?? null;
  }

  removeDetached(name: string): void {
    const part = this.partByName(name);
    part?.pivot.parent?.remove(part.pivot);
  }

  setDetachedPose(name: string, pose: VehiclePose): void {
    const part = this.partByName(name);
    if (!part) {
      return;
    }
    part.pivot.position.set(pose.position[0], pose.position[1], pose.position[2]);
    part.pivot.quaternion.set(pose.rotation[0], pose.rotation[1], pose.rotation[2], pose.rotation[3]);
  }

  setDoorAngle(side: string, angle: number): void {
    const door = this.built.doors.find((candidate) => candidate.side === side);
    if (!door) {
      return;
    }
    this.scratch.setFromAxisAngle(UP, angle);
    door.pivot.quaternion.copy(door.closed).multiply(this.scratch);
  }

  /**
   * Two authentic mechanisms, both moved here from the headlight system (B5 step 5 — the logic that DECIDES
   * lamp state is renderer-agnostic; only this poking of materials is not): stock cars swap SA's shared lamp
   * atlas to its lit copy (`vehiclelights128` → `vehiclelightson128`, identical UVs), and the lamp glows
   * through its own texture via `emissiveMap` — an emissive-only lamp renders as a blank white slab (stock
   * `benson`), while the map keeps the reflector detail and the red tail hue.
   */
  setLamps(state: VehicleLampState): void {
    this.lampMaterials ??= this.collectLampMaterials();
    const { heads, tails } = this.lampMaterials;
    if (this.lampsOn !== state.headlights) {
      this.lampsOn = state.headlights;
      for (const material of [...heads, ...tails]) {
        applyLampState(material, state.headlights, state.intensity);
      }
    }
    // Brake brightness rides per frame — it changes far more often than the on/off swap.
    const tailGlow = (state.brakes ? TAIL_BRAKE_EMISSIVE : TAIL_RUN_EMISSIVE) * state.intensity;
    for (const material of tails) {
      material.emissiveIntensity = state.headlights ? tailGlow : 1;
    }
  }

  setLodBand(band: VehicleBand): void {
    if (band === 'culled') {
      this.object.visible = false;

      return;
    }
    this.object.visible = true;
    const showLod = band === 'vlo';
    const { lod } = this.built;
    if (lod) {
      lod.visible = showLod;
    }
    for (const child of this.object.children) {
      if (child !== lod) {
        child.visible = !showLod; // HD parts off while the LOD is shown
      }
    }
  }

  setPartDamaged(name: string, damaged: boolean): void {
    const part = this.partByName(name);
    if (part) {
      part.ok.visible = !damaged;
      part.dam.visible = damaged;
    }
  }

  setTransform(position: Vec3, rotation: VehicleQuat): void {
    this.object.position.set(position[0], position[1], position[2]);
    this.object.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
  }

  setWheel(index: number, spin: number, steer: number): void {
    const wheel = this.built.wheels[index];
    if (!wheel) {
      return;
    }
    this.scratch.setFromAxisAngle(AXLE, spin);
    wheel.spinner.quaternion.setFromAxisAngle(UP, steer).multiply(this.scratch); // steer, then spin
  }

  private collectLampMaterials(): { heads: MeshStandardMaterial[]; tails: MeshStandardMaterial[] } {
    const heads: MeshStandardMaterial[] = [];
    const tails: MeshStandardMaterial[] = [];
    this.object.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) {
        return;
      }
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const mat = material as MeshStandardMaterial;
        const type = mat.userData.lightType as 'head' | 'tail' | undefined;
        if (type === 'head') {
          heads.push(mat);
        } else if (type === 'tail') {
          tails.push(mat);
        }
      }
    });

    return { heads, tails };
  }

  private partByName(name: string): BuiltPart | undefined {
    return this.built.parts.find((part) => part.name === name);
  }
}

/** Turn ONE tagged lamp material on/off (texture twin + emissive). */
function applyLampState(mat: MeshStandardMaterial, on: boolean, intensity: number): void {
  const lightsOn = mat.userData.lightsOnMap as Texture | undefined;
  const lightsOff = mat.userData.lightsOffMap as Texture | undefined;
  if (lightsOn && lightsOff) {
    mat.map = on ? lightsOn : lightsOff;
  }
  const type = mat.userData.lightType as 'head' | 'tail';
  if (!on) {
    mat.emissive.setHex(0x000000);
    mat.emissiveMap = null;
    mat.emissiveIntensity = 1;
    mat.needsUpdate = true;

    return;
  }
  if (mat.map) {
    mat.emissiveMap = mat.map;
    mat.emissive.setHex(0xffffff);
  } else {
    mat.emissiveMap = null;
    mat.emissive.setHex(type === 'head' ? HEAD_COLOR : TAIL_COLOR);
  }
  mat.emissiveIntensity = (type === 'head' ? HEAD_EMISSIVE : TAIL_RUN_EMISSIVE) * intensity;
  mat.needsUpdate = true;
}

/** Free a despawned car's GPU buffers. Materials only — textures are shared (generic vehicle TXD). */
function disposeVehicle(object: Object3D): void {
  object.traverse((node) => {
    const mesh = node as Partial<Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material?.dispose();
    }
  });
}
