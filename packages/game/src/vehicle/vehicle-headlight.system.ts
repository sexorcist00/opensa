import {
  AdditiveBlending,
  type Camera,
  CanvasTexture,
  type Color,
  type Object3D,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Vector4,
} from 'three';

import type { ThreeVehicleHandle } from '../adapters/three-vehicle-handle';
import type { System } from '../core/system';
import type { HeadlightConfig } from '../interfaces/config.interface';
import type { EnterableVehicle, EnterVehicleSystem } from './enter-vehicle.system';

import { lampAnchorsOf, lampStateFor } from './vehicle-lamps';

/** The world-shader local-light pool surface (structurally = renderware's `worldLocalLightUniforms`).
 *  Slots this system fills: 0/1 = headlight spots, 2/3 = tail/brake points (plan 070, vehicle part). */
export interface LocalLightSink {
  uLocalColor: { value: Color[] };
  uLocalCount: { value: number };
  uLocalDir: { value: Vector4[] };
  uLocalPos: { value: Vector4[] };
}

/** Glow / corona colours by light type (rendered colour, not the marker colour): warm-white head, red tail. */
const HEAD_COLOR = 0xfff2d0;
const TAIL_COLOR = 0xff1808;
/** Rear corona/glass is dim "running" at night, full when braking (× config). */
const REAR_RUNNING = 0.4;

/**
 * ⚠️ MVP — to be redone properly. Turns the **occupied** car's headlights on at night with two cheap parts:
 * (1) the lamp **glass glows** (head/tail materials tagged near the light dummies self-illuminate — head warm-
 * white, tail red dim/brake — bloom makes the halo); (2) a small **corona** flare at each lamp, faded by
 * viewing angle. Gated on `seated && isNight()` (occupant-agnostic — generalises to NPC traffic).
 *
 * Known MVP limitations (see plan 033): no light on the road/world (it's unlit/prelit), so no headlight beam
 * trail on the asphalt. A proper redo would project the beam onto the road polygons (SA `CShadows`-style
 * decal). Rejected dead-ends (do NOT retry as-is): flat ground decal/pool (sliced by geometry, reads badly),
 * a real SpotLight (can't light the unlit world; barely visible on dynamics).
 */
export class VehicleHeadlightSystem implements System {
  readonly name = 'vehicle-headlights';

  private readonly beamDir = new Vector3();
  private readonly camera: Camera;
  /** Camera position in the streaming root's local (GTA Z-up) space — for the per-lamp corona facing fade. */
  private readonly camLocal = new Vector3();
  private readonly config: () => HeadlightConfig;
  /** Lamp coronas: [frontLeft, frontRight, rearLeft, rearRight]. */
  private readonly coronas: Sprite[];
  private readonly dir = new Vector3();
  private readonly enter: EnterVehicleSystem;
  private readonly forward = new Vector3();
  private readonly isNight: () => boolean;
  private readonly lights?: LocalLightSink;
  private lit: EnterableVehicle | null = null;
  private readonly root: Object3D;
  private readonly tmp = new Vector3();

  constructor(
    enter: EnterVehicleSystem,
    isNight: () => boolean,
    root: Object3D,
    config: () => HeadlightConfig,
    glowLayer: number,
    camera: Camera,
    lights?: LocalLightSink,
  ) {
    this.enter = enter;
    this.isNight = isNight;
    this.root = root;
    this.config = config;
    this.camera = camera;
    this.lights = lights;

    const map = coronaTexture(); // soft round glow
    this.coronas = [HEAD_COLOR, HEAD_COLOR, TAIL_COLOR, TAIL_COLOR].map((color) => {
      const corona = new Sprite(
        new SpriteMaterial({ blending: AdditiveBlending, color, depthWrite: false, fog: false, map }),
      );
      corona.visible = false;
      corona.name = 'HeadlightCorona';
      corona.layers.set(glowLayer); // excluded from the SSAO normal prepass (see GLOW_LAYER)
      root.add(corona);

      return corona;
    });
  }

  update(): void {
    const cfg = this.config();
    const braking = this.enter.isBraking();
    // WHICH car lights up (and how) is renderer-agnostic — the shared decision the own engine uses too.
    const { car: target, state } = lampStateFor(
      this.enter.getActive(),
      this.enter.isSeated(),
      braking,
      this.isNight(),
      cfg.intensity,
    );
    if (this.lit && this.lit !== target) {
      this.lit.handle.setLamps({ brakes: false, headlights: false, intensity: cfg.intensity });
    }
    this.lit = target;
    if (!target) {
      for (const corona of this.coronas) {
        corona.visible = false;
      }
      if (this.lights) {
        this.lights.uLocalCount.value = 0; // day / on foot: the pool term early-outs
      }

      return;
    }
    target.handle.setLamps(state); // the glass swap/glow now lives in the three handle
    this.placeCoronas(target, cfg, braking);
    this.fillLightPool(target, cfg, braking);
  }

  /** Feed the world-shader light pool (plan 070, vehicle part): two forward-down headlight SPOTS that pool
   *  on the road/walls ahead, and two red tail POINTS behind (dim running, bright + wider while braking).
   *  Positions/directions are lifted from root-local (GTA Z-up) lamp space into three world space. */
  private fillLightPool(vehicle: EnterableVehicle, cfg: HeadlightConfig, braking: boolean): void {
    const sink = this.lights;
    if (!sink) {
      return;
    }
    const { front, rear } = lampAnchorsOf(vehicle);
    const { position, quaternion } = threeObject(vehicle);
    // Headlight beams aim forward and DOWN so the pool lands on the asphalt a few metres ahead.
    this.beamDir.set(0, 1, -0.5).normalize().applyQuaternion(quaternion);
    this.beamDir.transformDirection(this.root.matrixWorld);
    const beam = cfg.intensity;
    const slots: [number, number, number, number, boolean][] = [
      [front[0], front[1], front[2], 0, false],
      [-front[0], front[1], front[2], 1, false],
      [rear[0], rear[1], rear[2], 2, true],
      [-rear[0], rear[1], rear[2], 3, true],
    ];
    for (const [lx, ly, lz, index, isRear] of slots) {
      this.tmp.set(lx, ly, lz).applyQuaternion(quaternion);
      this.tmp.set(position.x + this.tmp.x, position.y + this.tmp.y, position.z + this.tmp.z);
      this.root.localToWorld(this.tmp);
      if (isRear) {
        sink.uLocalPos.value[index].set(this.tmp.x, this.tmp.y, this.tmp.z, braking ? 10 : 5);
        const rear = (braking ? cfg.brakeIntensity : cfg.brakeIntensity * 0.2) * beam;
        sink.uLocalColor.value[index].setRGB(1, 0.08, 0.04).multiplyScalar(rear);
        sink.uLocalDir.value[index].set(0, 0, 1, 2); // point light (no cone)
      } else {
        // A real headlight grazes the road — the shader's wrap term plus this range make the pool read at
        // 3–25 m; intensity/range are config knobs (the first pass overshot badly, see plan 070).
        sink.uLocalPos.value[index].set(this.tmp.x, this.tmp.y, this.tmp.z, cfg.beamRange);
        sink.uLocalColor.value[index].setRGB(1, 0.93, 0.72).multiplyScalar(cfg.beamIntensity * beam);
        sink.uLocalDir.value[index].set(this.beamDir.x, this.beamDir.y, this.beamDir.z, 0.55);
      }
    }
    sink.uLocalCount.value = 4;
  }

  /** Place + fade the four lamp coronas at the model's `headlights`/`taillights` dummies (mirrored ±X), each
   *  dimmed by how much its lamp faces the camera (front +Y, rear −Y) so it only shows from the right side.
   *  Rear coronas run dim and brighten on braking. */
  private placeCoronas(vehicle: EnterableVehicle, cfg: HeadlightConfig, braking: boolean): void {
    const { front, rear } = lampAnchorsOf(vehicle);
    const { position, quaternion } = threeObject(vehicle);
    this.camLocal.copy(this.camera.getWorldPosition(this.tmp));
    this.root.worldToLocal(this.camLocal); // camera in root-local (Z-up) space, where the lamps live
    const rearIntensity = cfg.coronaIntensity * (braking ? 1 : REAR_RUNNING);
    // [localX, localY, localZ, index, isRear]
    const lamps: [number, number, number, number, boolean][] = [
      [front[0], front[1], front[2], 0, false],
      [-front[0], front[1], front[2], 1, false],
      [rear[0], rear[1], rear[2], 2, true],
      [-rear[0], rear[1], rear[2], 3, true],
    ];
    for (const [lx, ly, lz, index, isRear] of lamps) {
      const corona = this.coronas[index];
      this.tmp.set(lx, ly, lz).applyQuaternion(quaternion);
      corona.position.set(position.x + this.tmp.x, position.y + this.tmp.y, position.z + this.tmp.z);
      this.forward.set(0, isRear ? -1 : 1, 0).applyQuaternion(quaternion);
      this.dir.copy(this.camLocal).sub(corona.position).normalize();
      const facing = Math.max(this.forward.dot(this.dir), 0);
      const fade = facing * facing; // sharpen so the corona is clearly off from the side/behind
      corona.material.opacity = (isRear ? rearIntensity : cfg.coronaIntensity) * fade;
      corona.visible = fade > 0.01;
      corona.scale.setScalar(cfg.coronaSize * (isRear && braking ? 1.25 : 1));
    }
  }
}

/** A soft round corona (gentle glow, faint halo — NOT a solid disc) for the additive lamp flares. */
function coronaTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return new CanvasTexture(canvas);
}

/**
 * This system is three-only (sprites, materials, three uniform arrays) and is the LAST vehicle system still
 * to be ported (074/08 B5 step 5 — lamp state + coronas move onto the engine's own corona pass). Until then
 * it reaches the render object through the three handle rather than through gameplay state.
 */
function threeObject(vehicle: EnterableVehicle): Object3D {
  return (vehicle.handle as ThreeVehicleHandle).object;
}
