/**
 * The operations camera: a map camera that turns around the GROUND POINT it looks at, not around the eye.
 * Tilting an eye that hovers a kilometre up swings the view to the horizon and drops the city off screen;
 * orbiting the focus keeps the incident under the cursor, which is what makes clicking workable.
 *
 * The rig steps themselves are the debugger's, imported rather than re-derived
 * (`@opensa/web/ui/camera/*`) — one convention for what a drag, a wheel notch and a yaw mean.
 */
import type { CameraState } from '@opensa/engine';

import { CAMERA_FOV_Y, cursorRay, forwardFrom, screenBasis } from '@opensa/web/ui/camera/engine-camera';
import { dollyStep, panStep, TOP_DOWN_PITCH } from '@opensa/web/ui/camera/fly-rig';

import type { GtaGround } from './coords';
import type { Flight } from './fly';

import { engineToGta, gtaToEngine } from './coords';
import { planFlight } from './fly';

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
  /** How the world is projected. Part of the pose because a view is not restored without it (201/7-01). */
  readonly projection: MapProjection;
  /** Radians. {@link MAP_YAW} is north-up. */
  readonly yaw: number;
}

/**
 * `perspective` is the default and the game's own view. `ortho` is the plan view an operator switches on:
 * parallel rays, so buildings stop leaning over the streets they hide and a distance on screen is the same
 * distance wherever it is measured — which is the difference between a picture and a drawing.
 */
export type MapProjection = 'ortho' | 'perspective';

/**
 * The far plane. A city-wide pose sits kilometres from the far corner, and — this is the part that bites —
 * the engine CULLS any cell entirely past `fogCutDistance`, so the host pushes fog out to this same value.
 * Leave them tied together or the map goes empty as you zoom out (the sa-map-viewer learned this the hard way).
 */
export const CAMERA_FAR = 12000;

/** The yaw that draws the map the way every SA map is drawn: north up, east right. */
export const MAP_YAW = Math.PI;

/**
 * The shallowest look-down when NOTHING is streamed — the demo's synthetic grid and plan mode, which are
 * resident in full and have no ring to run out of. A streamed world does not use this: it derives its own
 * bound from what the streamer actually fills (see {@link MapCamera.setStreamedReach}).
 */
const PITCH_MIN_UNSTREAMED = -0.35;
/** Radians per pixel of right-drag. */
const ORBIT_PER_PIXEL = 0.005;
/** The widest view when nothing is streamed. A streamed world derives its own, tighter, cap. */
const MAX_DISTANCE = 7000;
const MIN_DISTANCE = 30;
const NEAR = 0.5;
/** Bisection steps for the pitch bound. Fixed, so the bound is the same number on every machine and in a
 *  test — the reach function is monotonic in pitch, so 32 halvings of the bracket are ~1e-9 rad. */
const PITCH_SOLVE_STEPS = 32;

export class MapCamera {
  private distance!: number;
  /** The flight in progress and how far into it we are, or null when the operator owns the view. */
  private flight: null | { elapsedMs: number; plan: Flight } = null;
  /** The looked-at ground point, ENGINE coords. */
  private focus!: [number, number, number];
  /** The EFFECTIVE tilt — what the frame is drawn with: {@link wantedPitch} narrowed by the world bound. */
  private pitch!: number;
  private projection!: MapProjection;
  /** What the streamer fills around the focus, world units; `Infinity` when nothing streams. */
  private reach = Infinity;
  /**
   * The tilt the OPERATOR asked for, before the world's bound narrows it. Kept apart from the effective
   * pitch because the bound moves with the zoom, and a bound that overwrote the request would be one-way:
   * zooming out would tilt the view down and zooming back in would leave it there, so a wheel round trip
   * would quietly cost the operator their viewing angle.
   */
  private wantedPitch!: number;
  private yaw!: number;

  constructor(pose: MapPose) {
    this.applyPose(pose);
  }

  /** Advance a flight in progress. No-op when there is none, so the host can call it every frame. */
  advance(dtMs: number): void {
    const flight = this.flight;
    if (flight === null) {
      return;
    }
    flight.elapsedMs += Math.max(0, dtMs);
    const view = flight.plan.at(flight.elapsedMs);
    // Straight to the fields: `lookAtGta` and `frameSpan` are input paths and cancel the flight.
    this.focus = gtaToEngine(view.at);
    this.distance = this.clampDistance(Math.max(1, view.span) / (2 * Math.tan(CAMERA_FOV_Y / 2)));
    // The arc climbs and comes back down, so the tilt it forces on the way out is GIVEN BACK on the way in.
    this.pitch = this.clampPitch(this.wantedPitch);
    if (flight.elapsedMs >= flight.plan.durationMs) {
      this.flight = null;
    }
  }

  /**
   * Put the camera at a pose outright, the way the constructor does.
   *
   * Every other step here is RELATIVE — a drag, a notch, a pinch — which is right for input and wrong for a
   * host that has a pose in hand: a caller wanting a known tilt would otherwise have to solve for it through
   * `orbit`, which means knowing this camera's private step scale. A dispatch console locking its view
   * north-up needs exactly that, and so does restoring the tilt it left.
   *
   * `pitch` is clamped like any other pitch, so a caller may ask for straight down without knowing how far
   * down this camera goes.
   */
  applyPose(pose: MapPose): void {
    this.flight = null;
    this.focus = gtaToEngine(pose.at);
    this.projection = pose.projection;
    this.yaw = pose.yaw;
    this.wantedPitch = clampPitchHard(pose.pitch);
    this.distance = this.clampDistance(pose.height / -Math.sin(this.wantedPitch));
    this.pitch = this.clampPitch(this.wantedPitch);
    // The tilt the caller GOT may be steeper than the one they asked for, and the height they asked for is
    // the thing to honour — so the distance is re-read against it rather than left where the raw pitch put it.
    this.distance = this.clampDistance(pose.height / -Math.sin(this.pitch));
  }

  /** One wheel notch along the view — the rig's altitude-scaled step, re-read as a focus distance. */
  dolly(notch: number): void {
    this.flight = null;
    const forward = forwardFrom(this.yaw, this.pitch);
    const [x, y, z] = dollyStep(this.eye(), forward, notch);
    this.distance = this.clampDistance(Math.hypot(x - this.focus[0], y - this.focus[1], z - this.focus[2]));
    // Zooming out widens the frame, so the tilt that was legal a notch ago may not be: the bound is
    // re-taken here rather than only where the tilt itself is touched — and re-taken against what the
    // operator ASKED for, so zooming back in gives their angle back.
    this.pitch = this.clampPitch(this.wantedPitch);
  }

  /** Whether a flight is in progress — the readout says so, and a follow mode must not fight one. */
  flying(): boolean {
    return this.flight !== null;
  }

  /**
   * Fly to another view along Van Wijk & Nuij's path (`fly.ts`), which is what makes a jump readable: the
   * camera pulls up, crosses, and settles. Sampled by {@link advance}, and **cancelled by any input** — an
   * operator who grabs the map mid-flight has to win, or the console feels haunted.
   *
   * `span` is the ground extent to arrive framing; omitted, the current one is kept.
   */
  flyTo(at: GtaGround, span = this.span()): void {
    const plan = planFlight({ at: this.positionGta(), span: this.span() }, { at, span });
    if (plan.durationMs <= 0) {
      this.lookAtGta(at);
      this.frameSpan(span);

      return;
    }
    this.flight = { elapsedMs: 0, plan };
  }

  /** Frame this much ground at the focus, world units. The one place a zoom LEVEL is expressed. */
  frameSpan(span: number): void {
    this.distance = this.clampDistance(Math.max(1, span) / (2 * Math.tan(CAMERA_FOV_Y / 2)));
    this.pitch = this.clampPitch(this.pitch);
  }

  /** Eye height above the ground plane — the pan scale and the streaming radii both key off it. */
  height(): number {
    return this.distance * -Math.sin(this.pitch);
  }

  /** Put the view over a GTA point without changing height, tilt or heading (what "locate unit" does). */
  lookAtGta(at: GtaGround): void {
    this.flight = null;
    this.focus = gtaToEngine(at);
  }

  /** The widest view the bounds allow — what a "everything there is" zoom level resolves to when the
   *  surface has no world to measure (plan mode: no pak, no ring, only the board over a grid). */
  maxSpan(): number {
    return 2 * this.clampDistance(Number.POSITIVE_INFINITY) * Math.tan(CAMERA_FOV_Y / 2);
  }

  /** Right-drag: turn and tilt around the focus. */
  orbit(dxPixels: number, dyPixels: number): void {
    this.flight = null;
    this.yaw -= dxPixels * ORBIT_PER_PIXEL;
    // The drag is measured from what is ON SCREEN, not from an older request: dragging up out of a clamped
    // view has to fight the bound immediately rather than through invisible slack.
    this.wantedPitch = clampPitchHard(this.pitch - dyPixels * ORBIT_PER_PIXEL);
    this.pitch = this.clampPitch(this.wantedPitch);
  }

  /** Left-drag: slide the focus in the screen plane, so the map follows the cursor like a grabbed sheet. */
  pan(ndcDelta: readonly [number, number]): void {
    this.flight = null;
    const forward = forwardFrom(this.yaw, this.pitch);
    this.focus = panStep(this.focus, forward, ndcDelta, Math.max(1, this.height()));
  }

  pose(): MapPose {
    return {
      at: this.positionGta(),
      height: this.height(),
      pitch: this.pitch,
      projection: this.projection,
      yaw: this.yaw,
    };
  }

  /** The ground point under the view, in GTA coords — what the streaming rings follow. */
  positionGta(): [number, number] {
    return engineToGta(this.focus);
  }

  /**
   * The world ray under a screen position in NDC (x right, y up, both −1..1).
   *
   * The two projections put the variation in different halves of the ray, and getting that backwards is
   * SILENT — picks land on whatever is under the middle of the screen and the map simply feels wrong:
   * under perspective every ray leaves the one eye and the DIRECTION fans out; under orthographic every
   * ray is parallel and the ORIGIN slides across the image plane.
   */
  rayAt(ndc: readonly [number, number], aspect: number): CursorPick {
    const forward = forwardFrom(this.yaw, this.pitch);
    if (this.projection === 'perspective') {
      return { direction: cursorRay(forward, ndc, aspect, CAMERA_FOV_Y), origin: this.eye() };
    }
    const { right, up } = screenBasis(forward);
    const halfHeight = this.orthoHalfHeight();
    const sx = ndc[0] * halfHeight * aspect;
    const sy = ndc[1] * halfHeight;
    const eye = this.eye();

    return {
      direction: forward,
      origin: [
        eye[0] + right[0] * sx + up[0] * sy,
        eye[1] + right[1] * sx + up[1] * sy,
        eye[2] + right[2] * sx + up[2] * sy,
      ],
    };
  }

  /** Switch how the world is projected; everything else about the view is untouched. */
  setProjection(projection: MapProjection): void {
    this.projection = projection;
  }

  /**
   * What the streamer fills around the focus (the LOD ring), world units — `Infinity` for a world that
   * streams nothing, which is the demo grid and plan mode.
   *
   * This is the number both bounds are derived from, and the reason they are rules rather than constants:
   * **the frame may not reach past the world that is there.** A view whose top edge lands outside the ring
   * is a view of ground nobody loaded — and it does not fail, it renders empty and looks like a broken map.
   */
  setStreamedReach(radius: number): void {
    const height = this.height();
    this.reach = radius > 0 ? radius : Infinity;
    this.distance = this.clampDistance(this.distance);
    this.pitch = this.clampPitch(this.wantedPitch);
    // The bound can only tilt the view DOWN, and a tilt at a fixed distance lifts the eye. The height is
    // what `?h=` states and what the readout shows, so it is the thing held: the same rule `applyPose`
    // follows when its own clamp moves the tilt.
    this.distance = this.clampDistance(height / -Math.sin(this.pitch));
  }

  /** How much ground the frame covers at the focus plane, world units — the inverse of {@link frameSpan}. */
  span(): number {
    return 2 * this.distance * Math.tan(CAMERA_FOV_Y / 2);
  }

  state(aspect: number): CameraState {
    const perspective = this.projection === 'perspective';

    return {
      aspect,
      eye: this.eye(),
      far: CAMERA_FAR,
      fovYRad: CAMERA_FOV_Y,
      // An orthographic box has no apex, so its front plane is placed as far in FRONT of the focus as the
      // far plane lies behind it. Two things fall out of that, and neither is a preference: a tower taller
      // than the eye keeps drawing instead of being sliced off at block zoom (the perspective near plane
      // cannot express that), and the depth range stays 2 × (far − distance) — 24 km at worst, which a
      // depth32float carries at ~1.5 mm.
      near: perspective ? NEAR : 2 * this.distance - CAMERA_FAR,
      ...(perspective ? {} : { orthoHalfHeight: this.orthoHalfHeight() }),
      target: [...this.focus],
      up: [0, 1, 0],
    };
  }

  /**
   * Scale the view distance directly — what a pinch drives. The wheel's {@link dolly} steps by a notch, which
   * a continuous gesture cannot express: a pinch reports a RATIO, and quantising it into notches is what makes
   * touch zoom feel like it is fighting the finger.
   */
  zoomBy(factor: number): void {
    this.flight = null;
    this.distance = this.clampDistance(this.distance * factor);
    this.pitch = this.clampPitch(this.wantedPitch);
  }

  /** Frame a GTA point at a given eye height — "zoom to incident". */
  zoomTo(at: GtaGround, height: number): void {
    this.lookAtGta(at);
    this.distance = this.clampDistance(height / -Math.sin(this.pitch));
    this.pitch = this.clampPitch(this.wantedPitch);
  }

  /**
   * The widest the view may be. A streamed world derives it: at the top-down limit the frame's half-span is
   * `d·tan(fov/2)`, so a distance past `reach / tan(fov/2)` frames ground outside the ring however the
   * camera is tilted. Nothing streamed → the flat bound, which is all the demo and plan mode need.
   */
  private clampDistance(distance: number): number {
    const cap = Number.isFinite(this.reach) ? this.reach / Math.tan(CAMERA_FOV_Y / 2) : MAX_DISTANCE;

    return Math.min(Math.min(MAX_DISTANCE, cap), Math.max(MIN_DISTANCE, distance));
  }

  /**
   * The shallowest tilt this view may take, RE-TAKEN on every step that moves the frame rather than decided
   * once ([restrictions/architecture.md](../../../../docs/restrictions/architecture.md): a framing decision
   * taken on a threshold gets retaken every frame). Zooming out widens the frame, which pushes its far edge
   * out, which is why a tilt that was legal one notch ago may not be legal now.
   *
   * Solved by bisection because {@link frameReach} has no closed-form inverse worth writing: it is monotonic
   * in the tilt, so a fixed number of halvings gives the same bound everywhere.
   */
  private clampPitch(pitch: number): number {
    const hard = clampPitchHard(pitch);
    if (!Number.isFinite(this.reach) || frameReach(this.distance, hard, this.projection) <= this.reach) {
      return hard;
    }
    // Straight down is always legal (the frame reaches least there) and the asked-for tilt is not, so the
    // bound lies between them: walk the legal side SHALLOWER, one halving at a time, and answer with it.
    // Answering with the illegal side, or with the steep end, would tilt the operator flat down every time
    // they asked for one degree too much.
    let legal = TOP_DOWN_PITCH;
    let illegal = hard;
    for (let step = 0; step < PITCH_SOLVE_STEPS; step += 1) {
      const middle = (legal + illegal) / 2;
      if (frameReach(this.distance, middle, this.projection) <= this.reach) {
        legal = middle;
      } else {
        illegal = middle;
      }
    }

    return legal;
  }

  private eye(): [number, number, number] {
    const [fx, fy, fz] = forwardFrom(this.yaw, this.pitch);

    return [this.focus[0] - fx * this.distance, this.focus[1] - fy * this.distance, this.focus[2] - fz * this.distance];
  }

  /**
   * The ortho box is sized so it frames exactly what the perspective view frames AT THE FOCUS PLANE. That is
   * what makes switching a change of projection rather than a jump: the ground under the view keeps its
   * scale, and pan, dolly and pinch — all of which move `distance` — go on meaning what they meant.
   */
  private orthoHalfHeight(): number {
    return this.distance * Math.tan(CAMERA_FOV_Y / 2);
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

/**
 * The absolute range every pitch lives in, whatever the world is: never level (a level view has no ground
 * point and the rig's basis degenerates) and never past straight down (the view would flip through the
 * vertical). {@link MapCamera.clampPitch} narrows this further from what the streamer fills.
 */
function clampPitchHard(pitch: number): number {
  return Math.min(PITCH_MIN_UNSTREAMED, Math.max(TOP_DOWN_PITCH, pitch));
}

/**
 * How far past the focus, along the ground, the TOP of the frame reaches at this tilt — the number the
 * pitch bound is a rule about. Shallower tilt pushes it out; at the top-down limit it is just the frame's
 * own half-span.
 *
 * The two projections reach differently and both are exact rather than approximated: a perspective frame's
 * top edge is a ray `fovY/2` above the view axis, so it lands at `d·sin t / tan(t − f)`; an orthographic
 * frame's top edge is PARALLEL to the axis and offset by the box's half-height, so it lands at
 * `halfHeight / sin t`. Half-height is `d·tan f` in both, which is what makes the two comparable at all.
 */
function frameReach(distance: number, pitch: number, projection: MapProjection): number {
  const t = -pitch;
  const half = distance * Math.tan(CAMERA_FOV_Y / 2);
  if (projection === 'ortho') {
    return half / Math.max(1e-6, Math.sin(t));
  }
  const edge = t - CAMERA_FOV_Y / 2;
  if (edge <= 1e-6) {
    // The top of the frame is at or above the horizon: it reaches forever, and no ring can cover it.
    return Infinity;
  }

  return (distance * Math.sin(t)) / Math.tan(edge) - distance * Math.cos(t);
}
