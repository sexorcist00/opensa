/**
 * The transition exam (plan 080/07): ONE long snapshot sequence walked through every mode change the game
 * can produce, asserting the camera never jumps except where a jump is the intended behaviour.
 *
 * The chain was built so transitions need no code of their own — shared channels, per-mode tuning tables, no
 * state resets. That claim is only worth something if something checks it, and checking it per-plan cannot:
 * a whip on leaving the map viewer, or a snap when a car hands the focus back, only appears when the layers
 * run in sequence against one continuous rig.
 *
 * Continuity is measured RELATIVE to the focus: `|Δeye − Δfocus|`. The absolute eye speed is meaningless
 * here (a car at 40 u/s legitimately moves the eye 0.67 u per frame); what must never jump is the eye's
 * motion against the thing it frames.
 */
import { describe, expect, it } from 'vitest';

import { type CameraSnapshot, createRigState, setFlyEye, snapTopDown, steerYaw, stepCamera } from './camera-director';
import { TEST_CAMERA_CONFIG as CONFIG } from './camera-test-config';

const DT = 1 / 60;
/**
 * The most the eye may move against its focus in one frame before it counts as a CUT (world units).
 *
 * Set above the fastest DELIBERATE channel and below the smallest real cut. The steered swing is the fast
 * one: `steerYaw` over `yawLagTime` 0.25 s peaks near 6 rad/s, which at a 7 m orbit is ~0.53 u/frame — that
 * is the camera swinging behind a car, not a jump. The cuts this chain actually shipped and had to fix were
 * metres per frame (the exit pull-in onto the ped's back), so 1 u/frame separates them cleanly.
 */
const JUMP = 1;

interface Leg {
  /** Frames where a jump is the CORRECT behaviour — a teleport, or the eye changing owner. */
  readonly declared?: boolean;
  /** Runs before the leg's first frame (mode entries the host drives directly). */
  readonly enter?: (state: ReturnType<typeof createRigState>, camera: null | ReturnType<typeof stepCamera>) => void;
  readonly frames: number;
  readonly label: string;
  readonly snapshot: (frame: number, previous: readonly [number, number, number]) => Partial<CameraSnapshot>;
}

const base = (over: Partial<CameraSnapshot>): CameraSnapshot => ({
  airborne: false,
  aspect: 16 / 9,
  bench: null,
  dt: DT,
  focus: [0, 2, 0],
  focusHeading: 0,
  impactForce: 0,
  landingSpeed: 0,
  look: { x: 0, y: 0 },
  mode: 'foot',
  pan: null,
  settling: false,
  vehicle: null,
  vehicleDistance: null,
  walkKeys: new Set(),
  zoomSteps: 0,
  ...over,
});

/** Walk/drive `speed` along heading 0 (toward −Z), continuing from `previous`. */
const advance = (previous: readonly [number, number, number], speed: number): [number, number, number] => [
  previous[0],
  previous[1],
  previous[2] - speed * DT,
];

/**
 * The full matrix, in the order a session actually produces it: walk → get in → drive → get out → walk →
 * map viewer → back → respawn.
 */
const LEGS: readonly Leg[] = [
  {
    frames: 120,
    label: 'walking',
    snapshot: (_frame, previous) => ({ focus: advance(previous, 7) }),
  },
  {
    // The scripted climb-in: the host reports `settling`, and the sequence aims the camera behind the car.
    enter: (state) => steerYaw(state, Math.PI / 2),
    frames: 72,
    label: 'climbing in',
    snapshot: (_frame, previous) => ({ focus: advance(previous, 1), settling: true }),
  },
  {
    frames: 240,
    label: 'driving',
    snapshot: (frame, previous) => ({
      focus: advance(previous, 24),
      focusHeading: frame / 120, // a long, steady corner
      mode: 'vehicle',
      vehicle: { slipAngle: 0.12, speed: 24 },
      vehicleDistance: 9,
    }),
  },
  {
    enter: (state) => steerYaw(state, Math.PI),
    frames: 72,
    label: 'climbing out',
    snapshot: (_frame, previous) => ({ focus: advance(previous, 1), settling: true }),
  },
  {
    frames: 120,
    label: 'walking again',
    snapshot: (_frame, previous) => ({ focus: advance(previous, 7) }),
  },
  {
    // The map viewer takes the eye: the host seeds the fly eye FROM the live camera, so this must not jump.
    enter: (state, camera) => setFlyEye(state, camera ? [...camera.eye] : [0, 10, 0]),
    frames: 60,
    label: 'map viewer (seeded from the live eye)',
    snapshot: (_frame, previous) => ({ focus: previous, mode: 'fly' }),
  },
  {
    declared: true, // an overhead snap IS the activation being visible (074/22)
    enter: (state) => snapTopDown(state, [0, 2, -60]),
    frames: 60,
    label: 'map viewer overhead',
    snapshot: (_frame, previous) => ({ focus: previous, mode: 'fly' }),
  },
  {
    declared: true, // handing the eye back to the rig re-frames the player — a cut by design
    enter: (state) => setFlyEye(state, null),
    frames: 120,
    label: 'back on foot',
    snapshot: (_frame, previous) => ({ focus: advance(previous, 7) }),
  },
  {
    declared: true, // a respawn IS a teleport: the rig snaps rather than flying across the map
    frames: 120,
    label: 'respawn',
    snapshot: (frame, previous) => ({ focus: frame === 0 ? [400, 2, 400] : advance(previous, 7) }),
  },
];

describe('the camera across every mode transition (plan 080/07)', () => {
  /** Walk the whole matrix, reporting the worst focus-relative eye jump inside each leg. */
  const walkMatrix = (): { jumps: { label: string; worst: number }[] } => {
    const state = createRigState(CONFIG, Math.PI, -0.25);
    const jumps: { label: string; worst: number }[] = [];
    let focus: [number, number, number] = [0, 2, 0];
    let camera: null | ReturnType<typeof stepCamera> = null;
    let lastEye: null | readonly [number, number, number] = null;
    let lastFocus: readonly [number, number, number] = focus;

    for (const leg of LEGS) {
      leg.enter?.(state, camera);
      let worst = 0;
      for (let frame = 0; frame < leg.frames; frame += 1) {
        const over = leg.snapshot(frame, focus);
        focus = [...((over.focus as [number, number, number] | undefined) ?? focus)];
        camera = stepCamera(state, base({ ...over, focus }), CONFIG);
        if (lastEye !== null) {
          // The eye's motion MINUS the focus's: what the rig itself contributed this frame.
          const relative = Math.hypot(
            camera.eye[0] - lastEye[0] - (focus[0] - lastFocus[0]),
            camera.eye[1] - lastEye[1] - (focus[1] - lastFocus[1]),
            camera.eye[2] - lastEye[2] - (focus[2] - lastFocus[2]),
          );
          worst = Math.max(worst, frame === 0 && leg.declared ? 0 : relative);
        }
        lastEye = camera.eye;
        lastFocus = focus;
      }
      jumps.push({ label: leg.label, worst });
    }

    return { jumps };
  };

  describe('negative cases', () => {
    it('never cuts inside a leg, and never cuts across an UNDECLARED transition', () => {
      const { jumps } = walkMatrix();
      const cuts = jumps.filter((leg) => leg.worst > JUMP).map((leg) => `${leg.label}: ${leg.worst.toFixed(3)}`);

      expect(cuts).toEqual([]);
    });

    it('does not whip after the map viewer hands the eye back', () => {
      // The re-frame itself is a cut (declared); what must not happen is the eye then CRAWLING home over
      // seconds, which is what an unseeded spring would do.
      const { jumps } = walkMatrix();
      const back = jumps.find((leg) => leg.label === 'back on foot');

      expect(back?.worst).toBeLessThanOrEqual(JUMP);
    });
  });

  describe('positive cases', () => {
    it('keeps the rig state alive across the whole session — no channel resets to a default', () => {
      const state = createRigState(CONFIG, Math.PI, -0.25);
      let focus: [number, number, number] = [0, 2, 0];
      let camera: null | ReturnType<typeof stepCamera> = null;
      for (const leg of LEGS) {
        leg.enter?.(state, camera);
        for (let frame = 0; frame < leg.frames; frame += 1) {
          const over = leg.snapshot(frame, focus);
          focus = [...((over.focus as [number, number, number] | undefined) ?? focus)];
          camera = stepCamera(state, base({ ...over, focus }), CONFIG);
        }
      }

      // Every channel that carries feel is still live and finite at the end of the session.
      expect(Number.isFinite(state.yaw)).toBe(true);
      expect(Number.isFinite(state.distance)).toBe(true);
      expect(state.fov).toBeCloseTo(Math.PI / 3, 2); // eased back to the base lens on foot
      expect(state.follow.point).not.toBeNull();
      expect(state.flyEye).toBeNull();
    });

    it('reproduces itself exactly — the whole matrix is deterministic', () => {
      expect(walkMatrix()).toEqual(walkMatrix());
    });
  });
});
