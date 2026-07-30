/**
 * Video mode's shot presets and the framing math under them (plan 096/03).
 *
 * A shot is a TABLE ROW, never a code path: where the camera stands relative to the car, where the car sits
 * on screen, which lens, how long, how softly it follows. Three behaviours cover every row — `chase` yields
 * the frame back to the shipped follow rig, `tracking` rides the car's own heading frame, `static` plants the
 * eye once and lets the car drive past it.
 *
 * Two rules the numbers obey, both from CLAUDE.md and the 080 chain:
 *
 * - **Offsets are multiples of the CAR's own half-extents**, so a shot composed on the `admiral` frames a bus
 *   and a Bandito the same way. No metre is written against a model.
 * - **Offsets live in the SUBJECT's heading frame**, never the camera's screen frame — a screen-frame offset
 *   rotates while a swing is in flight and reads as a stick-and-jump (`docs/edge-cases/camera-rig.md`).
 *
 * Everything here is pure and engine Y-up: the caller converts at the physics boundary (the 080 two-spaces
 * rule) and hands over an already-converted subject.
 */
import { screenBasis } from '../camera/engine-camera';

/** Where the car should sit on screen: 0..1 from the LEFT and from the TOP edge, 0.5 being dead centre. */
export interface ScreenAnchor {
  x: number;
  y: number;
}

export type ShotName = 'chase' | 'flyby' | 'high' | 'nose' | 'wing-l' | 'wing-r';

/**
 * One shot. `chase` carries no geometry on purpose: the shipped follow rig IS that shot, so the director
 * writes `null` for those segments and inherits its collision and motion layers for free.
 */
export type ShotPreset = ChaseShot | PlacedShot;

/** The car being filmed, engine Y-up, as of the frame being composed. */
export interface Subject {
  /** Unit forward — where the car POINTS. Its screen-space direction is what lead room is measured against. */
  forward: Vec3;
  /** The car's own half-extents (m), vehicle space `[lateral, longitudinal, vertical]` — every offset below
   *  is a multiple of these, which is what makes one table fit every model in the slot. */
  halfExtents: Vec3;
  /** The DRAWN position (the interpolated render pose), so the framing is continuous with what is on screen. */
  position: Vec3;
  /** Planar speed (m/s) — below {@link LEAD_SPEED_MIN} there is no motion to leave room for. */
  speed: number;
}

export type Vec3 = readonly [number, number, number];

/** Below this the car is not really travelling, so lead room keeps the authored side (D9: no coin flips). */
const LEAD_SPEED_MIN = 2;

/** The presets, in the order a reader wants them: the free one first, then the placed ones. */
export const SHOTS: readonly ShotPreset[] = [
  { kind: 'chase', maxSeconds: 9, minSeconds: 5, name: 'chase', weight: 3 },
  {
    // The car's face, from a little above the bonnet line and off its axis — the shot that shows a mod car.
    anchor: { x: 0.42, y: 0.56 },
    eyeSmooth: 0.22,
    fovYRad: (50 * Math.PI) / 180,
    kind: 'tracking',
    maxSeconds: 8,
    minSeconds: 5,
    name: 'nose',
    offset: { forward: 3.4, height: 1.4, lateral: 0.9 },
    targetSmooth: 0.18,
    weight: 2,
  },
  {
    // Behind and well above: the road ahead reads, and the car sits low in frame with the city over it.
    anchor: { x: 0.44, y: 0.62 },
    eyeSmooth: 0.3,
    fovYRad: (55 * Math.PI) / 180,
    kind: 'tracking',
    maxSeconds: 9,
    minSeconds: 5,
    name: 'high',
    offset: { forward: -3.5, height: 4, lateral: -0.6 },
    targetSmooth: 0.25,
    weight: 2,
  },
  {
    anchor: { x: 0.38, y: 0.58 },
    eyeSmooth: 0.18,
    fovYRad: (45 * Math.PI) / 180,
    kind: 'tracking',
    maxSeconds: 7,
    minSeconds: 5,
    name: 'wing-l',
    offset: { forward: 0.4, height: 1.6, lateral: -5 },
    targetSmooth: 0.14,
    weight: 2,
  },
  {
    anchor: { x: 0.38, y: 0.58 },
    eyeSmooth: 0.18,
    fovYRad: (45 * Math.PI) / 180,
    kind: 'tracking',
    maxSeconds: 7,
    minSeconds: 5,
    name: 'wing-r',
    offset: { forward: 0.4, height: 1.6, lateral: 5 },
    targetSmooth: 0.14,
    weight: 2,
  },
  {
    // Planted ahead of the car and to one side: it arrives, passes, and the guard cuts before the frame empties.
    anchor: { x: 0.42, y: 0.56 },
    eyeSmooth: 0.2,
    fovYRad: (40 * Math.PI) / 180,
    kind: 'static',
    maxSeconds: 7,
    minSeconds: 5,
    name: 'flyby',
    // Planted far enough ahead and out that the pass itself stays under the pan cap: at a cruise the angular
    // rate at closest approach is speed/standoff, and the first headless round measured what a 2.7 m standoff
    // does to it (266 clipped frames in one scene).
    offset: { forward: 10, height: 3, lateral: 6 },
    targetSmooth: 0.16,
    weight: 1,
  },
];

/** A shot the director poses itself: `tracking` re-places the eye every frame, `static` plants it once. */
export type PlacedShot = {
  /** Where the car sits on screen before lead room mirrors it ({@link anchorFor}). */
  readonly anchor: ScreenAnchor;
  /** `smoothDamp` time constants (s) for the eye and the look point — the shot's whole feel. */
  readonly eyeSmooth: number;
  readonly fovYRad: number;
  readonly kind: 'static' | 'tracking';
  /** Camera offset in the CAR's heading frame, as multiples of its half-extents (forward/lateral/height). */
  readonly offset: { readonly forward: number; readonly height: number; readonly lateral: number };
  readonly targetSmooth: number;
} & ShotBase;

type ChaseShot = ShotBase & { readonly kind: 'chase' };

interface ShotBase {
  readonly maxSeconds: number;
  /** D4's floor lives in the data: no preset may run shorter than 5 s (`director.test.ts` pins it). */
  readonly minSeconds: number;
  readonly name: ShotName;
  /** Relative weight in the seeded pick. */
  readonly weight: number;
}

/**
 * The look point that puts `subject` at `anchor` on screen, given where the camera stands.
 *
 * The aim depends on the basis, and the basis depends on the aim — so it is solved, not derived: start with
 * the camera looking straight at the car, offset the look point along that basis, then re-solve once on the
 * basis that offset produced. Two passes land the anchor inside a hundredth of the frame at every distance
 * and lens the presets use (pinned by the tests); a third buys nothing.
 */
export function aimShot(
  eye: Vec3,
  subject: Vec3,
  anchor: ScreenAnchor,
  fovYRad: number,
  aspect: number,
): [number, number, number] {
  const tanHalf = Math.tan(fovYRad / 2);
  // NDC of the wanted anchor: x right, y UP — the screen anchor counts y down, hence the flip.
  const ndcX = 2 * anchor.x - 1;
  const ndcY = 1 - 2 * anchor.y;
  let target: Vec3 = subject;
  for (let pass = 0; pass < 2; pass += 1) {
    const forward = normalize(sub(target, eye));
    const { right, up } = screenBasis(forward);
    // How far the car is ALONG the view — the screen offset scales with it, not with the straight-line range.
    const depth = Math.max(0.01, dot(sub(subject, eye), forward));
    const dx = ndcX * tanHalf * aspect * depth;
    const dy = ndcY * tanHalf * depth;
    target = [
      subject[0] - right[0] * dx - up[0] * dy,
      subject[1] - right[1] * dx - up[1] * dy,
      subject[2] - right[2] * dx - up[2] * dy,
    ];
  }

  return [target[0], target[1], target[2]];
}

/**
 * The anchor a shot actually uses this frame: the authored one, mirrored so the car sits on the side OPPOSITE
 * its screen-space travel (D4's "drives into the frame"). A car crossing to the right is framed left, with
 * the road it is heading into taking the open half.
 */
export function anchorFor(shot: PlacedShot, eye: Vec3, subject: Subject): ScreenAnchor {
  const { right } = screenBasis(normalize(sub(subject.position, eye)));
  const screenMotion = dot(subject.forward, right) * subject.speed;
  const { x } = shot.anchor;
  if (Math.abs(screenMotion) < LEAD_SPEED_MIN) {
    return shot.anchor;
  }

  return { x: screenMotion > 0 ? Math.min(x, 1 - x) : Math.max(x, 1 - x), y: shot.anchor.y };
}

/** Unit forward in ENGINE space for a GTA heading (0 faces +Y, counter-clockwise about +Z). */
export function forwardFromHeading(heading: number): [number, number, number] {
  return [-Math.sin(heading), 0, -Math.cos(heading)];
}

/**
 * Where a world point lands on screen (0..1 from the left and the top), and whether it is BEHIND the camera —
 * which the empty-frame guard has to tell apart from "off to the side", because a point behind the eye
 * projects to a perfectly plausible pair of numbers.
 */
export function projectToScreen(
  eye: Vec3,
  target: Vec3,
  fovYRad: number,
  aspect: number,
  point: Vec3,
): { behind: boolean; x: number; y: number } {
  const forward = normalize(sub(target, eye));
  const { right, up } = screenBasis(forward);
  const delta = sub(point, eye);
  const depth = dot(delta, forward);
  if (depth <= 0.01) {
    return { behind: true, x: 0.5, y: 0.5 };
  }
  const tanHalf = Math.tan(fovYRad / 2);
  const ndcX = dot(delta, right) / (tanHalf * aspect * depth);
  const ndcY = dot(delta, up) / (tanHalf * depth);

  return { behind: false, x: (ndcX + 1) / 2, y: (1 - ndcY) / 2 };
}

/**
 * Where a shot's camera stands this frame: the car's position plus the preset's offset in the car's own
 * heading frame, each component scaled by the matching half-extent.
 *
 * The car's right is `forward × up` exactly — the same right the ped-offset spawn uses, so "lateral +1" is
 * the passenger side in every module that talks about this car.
 */
export function shotEye(shot: PlacedShot, subject: Subject): [number, number, number] {
  const forward = normalize(subject.forward);
  const right = cross(forward, UP);
  const [hx, hy, hz] = subject.halfExtents;
  const lateral = shot.offset.lateral * hx;
  const ahead = shot.offset.forward * hy;
  const height = shot.offset.height * hz;

  return [
    subject.position[0] + right[0] * lateral + forward[0] * ahead,
    subject.position[1] + height,
    subject.position[2] + right[2] * lateral + forward[2] * ahead,
  ];
}

const UP: Vec3 = [0, 1, 0];

function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
}

function sub(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
