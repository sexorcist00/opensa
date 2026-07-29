/**
 * The map-viewer camera (plan 094, decision 4). It is the debugger's own map camera — `fly-rig`'s pan and
 * dolly steps, its top-down opening pose — with ONE difference that the plan calls for: the rig turns around
 * the GROUND POINT it looks at, not around the eye. Tilting an eye that hovers 400 u up swings the view to
 * the horizon and drops the inspected cell off screen; orbiting the focus keeps it centred, which is what
 * makes clicking an object workable.
 *
 * **The camera never moves on its own.** No animated orbit, no drift — an orbit's phase difference across two
 * runs is what invalidated a whole blue-strip bisect. `?at`/`?h`/`?pitch`/`?yaw` fully specify a pose, so the
 * same URL is the same pixels.
 */
import type { CameraState } from '@opensa/engine';

import { CAMERA_FOV_Y, forwardFrom } from '@opensa/web/ui/camera/engine-camera';
import { dollyStep, panStep, TOP_DOWN_HEIGHT, TOP_DOWN_PITCH } from '@opensa/web/ui/camera/fly-rig';

/** A fully-specified camera pose — everything `?at`/`?h`/`?pitch`/`?yaw` can say. */
export interface ViewerPose {
  /** The ground point under the view, in GTA coords (x, y). */
  at: readonly [number, number];
  /** Eye height above that point, engine units. */
  height: number;
  /** Radians; negative looks down. */
  pitch: number;
  /** Radians. {@link MAP_YAW} is the conventional map orientation; 0 turns it upside down. */
  yaw: number;
}

/**
 * The yaw that puts the map the way every SA map is drawn: north up, east right. At yaw 0 the top-down basis
 * comes out rotated a half turn (screen right = −X, screen up = −Y in GTA terms), so a screenshot would read
 * as a mirror of every reference anyone compares it against. Half a turn fixes it.
 */
export const MAP_YAW = Math.PI;

const FAR = 12000;
const MIN_DISTANCE = 5;
const NEAR = 0.5;
/** Radians per pixel of right-drag — a full screen width is a bit over a half turn. */
const ORBIT_PER_PIXEL = 0.005;
/** The eye always looks DOWN: a horizon-level map inspector shows nothing but the skyline. */
const PITCH_MAX = -0.06;

export class ViewerCamera {
  private distance: number;
  /** The looked-at ground point, ENGINE coords. */
  private focus: [number, number, number];
  private pitch: number;
  private yaw: number;

  constructor(pose: ViewerPose) {
    this.focus = [pose.at[0], 0, -pose.at[1]];
    this.pitch = clampPitch(pose.pitch);
    this.yaw = pose.yaw;
    this.distance = Math.max(MIN_DISTANCE, pose.height / -Math.sin(this.pitch));
  }

  /** One wheel notch along the view — fly-rig's altitude-scaled step, re-read as a focus distance. */
  dolly(notch: number): void {
    const forward = forwardFrom(this.yaw, this.pitch);
    const [x, y, z] = dollyStep(this.eye(), forward, notch);
    this.distance = Math.max(MIN_DISTANCE, Math.hypot(x - this.focus[0], y - this.focus[1], z - this.focus[2]));
  }

  /** Right-drag: turn and tilt around the focus. */
  orbit(dxPixels: number, dyPixels: number): void {
    this.yaw -= dxPixels * ORBIT_PER_PIXEL;
    this.pitch = clampPitch(this.pitch - dyPixels * ORBIT_PER_PIXEL);
  }

  /** Left-drag: slide the focus in the screen plane, so the map follows the cursor. */
  pan(ndcDelta: readonly [number, number]): void {
    const forward = forwardFrom(this.yaw, this.pitch);
    this.focus = panStep(this.focus, forward, ndcDelta, Math.max(1, this.height()));
  }

  /** The current pose, for the readout (and for pasting back as query params). */
  pose(): ViewerPose {
    const [x, y] = this.positionGta();

    return { at: [x, y], height: this.height(), pitch: this.pitch, yaw: this.yaw };
  }

  /** The ground point under the view, back in GTA coords — what names the cell to render. */
  positionGta(): [number, number] {
    return [this.focus[0], -this.focus[2]];
  }

  state(aspect: number): CameraState {
    return {
      aspect,
      eye: this.eye(),
      far: FAR,
      fovYRad: CAMERA_FOV_Y,
      near: NEAR,
      target: [...this.focus],
      up: [0, 1, 0],
    };
  }

  private eye(): [number, number, number] {
    const [fx, fy, fz] = forwardFrom(this.yaw, this.pitch);

    return [this.focus[0] - fx * this.distance, this.focus[1] - fy * this.distance, this.focus[2] - fz * this.distance];
  }

  private height(): number {
    return this.distance * -Math.sin(this.pitch);
  }
}

/**
 * The pose the URL asks for. Everything is optional and falls back to the top-down opening pose over
 * `fallbackAt` — the loaded map's own centre, so a total conversion whose world sits nowhere near GTA's
 * origin opens on its map and not on empty water.
 */
export function poseFromQuery(search: string, fallbackAt: readonly [number, number]): ViewerPose {
  const params = new URLSearchParams(search);
  const at = (params.get('at') ?? '').split(',').map(Number);
  const height = Number(params.get('h') ?? Number.NaN);
  const pitch = Number(params.get('pitch') ?? Number.NaN);
  const yaw = Number(params.get('yaw') ?? Number.NaN);

  return {
    at: at.length === 2 && at.every(Number.isFinite) ? [at[0], at[1]] : [fallbackAt[0], fallbackAt[1]],
    height: Number.isFinite(height) ? height : TOP_DOWN_HEIGHT,
    pitch: Number.isFinite(pitch) ? (pitch * Math.PI) / 180 : TOP_DOWN_PITCH,
    yaw: Number.isFinite(yaw) ? (yaw * Math.PI) / 180 : MAP_YAW,
  };
}

function clampPitch(pitch: number): number {
  return Math.min(PITCH_MAX, Math.max(TOP_DOWN_PITCH, pitch));
}
