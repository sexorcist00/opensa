/**
 * The operations camera: a map camera that turns around the GROUND POINT it looks at, not around the eye.
 * Tilting an eye that hovers a kilometre up swings the view to the horizon and drops the city off screen;
 * orbiting the focus keeps the incident under the cursor, which is what makes clicking workable.
 *
 * The rig steps themselves are the debugger's, imported rather than re-derived
 * (`@opensa/web/ui/camera/*`) — one convention for what a drag, a wheel notch and a yaw mean.
 */
import type { CameraState } from '@opensa/engine';

import { CAMERA_FOV_Y, cursorRay, forwardFrom } from '@opensa/web/ui/camera/engine-camera';
import { dollyStep, panStep, TOP_DOWN_PITCH } from '@opensa/web/ui/camera/fly-rig';

import type { GtaGround } from './coords';

import { engineToGta, gtaToEngine } from './coords';

/** Where a screen click lands in the world. */
export interface CursorPick {
  readonly direction: [number, number, number];
  readonly origin: [number, number, number];
}

export interface MapPose {
  /** The ground point under the view, GTA coords. */
  readonly at: GtaGround;
  /** Eye height above that point, world units. */
  readonly height: number;
  /** Radians; negative looks down. */
  readonly pitch: number;
  /** Radians. {@link MAP_YAW} is north-up. */
  readonly yaw: number;
}

/**
 * The far plane. A city-wide pose sits kilometres from the far corner, and — this is the part that bites —
 * the engine CULLS any cell entirely past `fogCutDistance`, so the host pushes fog out to this same value.
 * Leave them tied together or the map goes empty as you zoom out (the sa-map-viewer learned this the hard way).
 */
export const CAMERA_FAR = 12000;

/** The yaw that draws the map the way every SA map is drawn: north up, east right. */
export const MAP_YAW = Math.PI;

/** Shallowest look-down. A dispatch view that can reach the horizon is a dispatch view showing sky. */
const PITCH_MIN = -0.35;
/** Radians per pixel of right-drag. */
const ORBIT_PER_PIXEL = 0.005;
const MAX_DISTANCE = 7000;
const MIN_DISTANCE = 30;
const NEAR = 0.5;

export class MapCamera {
  private distance: number;
  /** The looked-at ground point, ENGINE coords. */
  private focus: [number, number, number];
  private pitch: number;
  private yaw: number;

  constructor(pose: MapPose) {
    this.focus = gtaToEngine(pose.at);
    this.pitch = clampPitch(pose.pitch);
    this.yaw = pose.yaw;
    this.distance = clampDistance(pose.height / -Math.sin(this.pitch));
  }

  /** One wheel notch along the view — the rig's altitude-scaled step, re-read as a focus distance. */
  dolly(notch: number): void {
    const forward = forwardFrom(this.yaw, this.pitch);
    const [x, y, z] = dollyStep(this.eye(), forward, notch);
    this.distance = clampDistance(Math.hypot(x - this.focus[0], y - this.focus[1], z - this.focus[2]));
  }

  /** Eye height above the ground plane — the pan scale and the streaming radii both key off it. */
  height(): number {
    return this.distance * -Math.sin(this.pitch);
  }

  /** Put the view over a GTA point without changing height, tilt or heading (what "locate unit" does). */
  lookAtGta(at: GtaGround): void {
    this.focus = gtaToEngine(at);
  }

  /** Right-drag: turn and tilt around the focus. */
  orbit(dxPixels: number, dyPixels: number): void {
    this.yaw -= dxPixels * ORBIT_PER_PIXEL;
    this.pitch = clampPitch(this.pitch - dyPixels * ORBIT_PER_PIXEL);
  }

  /** Left-drag: slide the focus in the screen plane, so the map follows the cursor like a grabbed sheet. */
  pan(ndcDelta: readonly [number, number]): void {
    const forward = forwardFrom(this.yaw, this.pitch);
    this.focus = panStep(this.focus, forward, ndcDelta, Math.max(1, this.height()));
  }

  pose(): MapPose {
    return { at: this.positionGta(), height: this.height(), pitch: this.pitch, yaw: this.yaw };
  }

  /** The ground point under the view, in GTA coords — what the streaming rings follow. */
  positionGta(): [number, number] {
    return engineToGta(this.focus);
  }

  /** The world ray under a screen position in NDC (x right, y up, both −1..1). */
  rayAt(ndc: readonly [number, number], aspect: number): CursorPick {
    const forward = forwardFrom(this.yaw, this.pitch);

    return { direction: cursorRay(forward, ndc, aspect, CAMERA_FOV_Y), origin: this.eye() };
  }

  state(aspect: number): CameraState {
    return {
      aspect,
      eye: this.eye(),
      far: CAMERA_FAR,
      fovYRad: CAMERA_FOV_Y,
      near: NEAR,
      target: [...this.focus],
      up: [0, 1, 0],
    };
  }

  /** Frame a GTA point at a given eye height — "zoom to incident". */
  zoomTo(at: GtaGround, height: number): void {
    this.lookAtGta(at);
    this.distance = clampDistance(height / -Math.sin(this.pitch));
  }

  private eye(): [number, number, number] {
    const [fx, fy, fz] = forwardFrom(this.yaw, this.pitch);

    return [this.focus[0] - fx * this.distance, this.focus[1] - fy * this.distance, this.focus[2] - fz * this.distance];
  }
}

/**
 * Where a cursor ray meets a horizontal plane, as a GTA ground point. `null` when the ray is level or points
 * away — there is no sane "here" then, and the caller must not invent one.
 */
export function groundPoint(pick: CursorPick, planeY = 0): [number, number] | null {
  if (Math.abs(pick.direction[1]) < 1e-4) {
    return null;
  }
  const t = (planeY - pick.origin[1]) / pick.direction[1];
  if (t <= 0) {
    return null;
  }

  return engineToGta([pick.origin[0] + pick.direction[0] * t, planeY, pick.origin[2] + pick.direction[2] * t]);
}

function clampDistance(distance: number): number {
  return Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, distance));
}

function clampPitch(pitch: number): number {
  return Math.min(PITCH_MIN, Math.max(TOP_DOWN_PITCH, pitch));
}
