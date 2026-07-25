import { describe, expect, it } from 'vitest';

import { type CameraProbe } from './camera-collision';
import {
  type CameraSnapshot,
  createRigState,
  reseedDistance,
  setFlyEye,
  snapTopDown,
  steerYaw,
  stepCamera,
} from './camera-director';
import { TEST_CAMERA_CONFIG } from './camera-test-config';
import { CAMERA_FOV_Y } from './engine-camera';
import { FLY_SPEED, TOP_DOWN_HEIGHT, TOP_DOWN_PITCH } from './fly-rig';

const CONFIG = TEST_CAMERA_CONFIG;

/** Every SMOOTHING channel off, so the rig reduces to its base orbit math: raw pointer input and an instant
 *  zoom. What the parity gate steps, and the raw reference the input damper is measured against. (The
 *  position channels need no zeroing here — a static focus keeps the look point exactly on target.) */
const RIGID = { ...CONFIG, inputSmoothTime: 0, zoomLambda: Number.POSITIVE_INFINITY };

const rigState = (): ReturnType<typeof createRigState> => createRigState(CONFIG, Math.PI, -0.25);

const snapshot = (over: Partial<CameraSnapshot> = {}): CameraSnapshot => ({
  aspect: 16 / 9,
  bench: null,
  dt: 1 / 60,
  focus: [10, 2, 30],
  focusHeading: 0,
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

/** The pre-080 inline host math, verbatim: what the director must still produce (the plan-01 parity gate). */
function stickCamera(steps: readonly { look: [number, number]; wheel: number }[]): {
  eye: [number, number, number];
  target: [number, number, number];
} {
  let yaw = Math.PI;
  let pitch = -0.25;
  let distance = 7;
  for (const step of steps) {
    yaw -= step.look[0] * 0.004;
    pitch = Math.max(-1.2, Math.min(0.9, pitch - step.look[1] * 0.004));
    if (step.wheel !== 0) {
      distance = Math.max(4, Math.min(10, distance * (step.wheel > 0 ? 1.08 : 0.93)));
    }
  }
  const forward: [number, number, number] = [
    Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    Math.cos(pitch) * Math.cos(yaw),
  ];
  const target: [number, number, number] = [10, 2 + 0.9, 30];

  return {
    eye: [target[0] - forward[0] * distance, target[1] - forward[1] * distance, target[2] - forward[2] * distance],
    target,
  };
}

describe('stepCamera', () => {
  describe('negative cases', () => {
    it('hands the frame to a running bench whatever the rig is doing', () => {
      const state = rigState();
      setFlyEye(state, [9, 9, 9]);
      const bench = { eye: [1, 1, 1] as [number, number, number], target: [2, 2, 2] as [number, number, number] };

      const camera = stepCamera(state, snapshot({ bench, mode: 'fly' }), CONFIG);

      expect(camera.eye).toEqual([1, 1, 1]);
      expect(camera.target).toEqual([2, 2, 2]);
    });

    it('does not zoom while the wheel toggle is off', () => {
      const state = rigState();

      stepCamera(state, snapshot({ zoomSteps: 3 }), { ...CONFIG, followZoom: false });

      expect(state.distanceTarget).toBe(7);
    });

    it('keeps the gameplay pitch inside the config clamps', () => {
      const state = rigState();

      stepCamera(state, snapshot({ look: { x: 0, y: 5000 } }), RIGID);
      expect(state.pitch).toBe(CONFIG.pitchMin);

      stepCamera(state, snapshot({ look: { x: 0, y: -5000 } }), RIGID);
      expect(state.pitch).toBe(CONFIG.pitchMax);
    });

    it('leaves the follow rig alone in fly mode — the eye is detached, not trailing the focus', () => {
      const state = rigState();
      setFlyEye(state, [4, 5, 6]);

      const camera = stepCamera(state, snapshot({ mode: 'fly' }), CONFIG);

      expect(camera.eye).toEqual([4, 5, 6]);
    });
  });

  describe('positive cases', () => {
    it('reproduces the pre-080 stick camera over a scripted look + zoom sequence, every channel off', () => {
      const steps = [
        { look: [12, -4] as [number, number], wheel: 0 },
        { look: [-30, 9] as [number, number], wheel: 1 },
        { look: [0, 0] as [number, number], wheel: -1 },
        { look: [140, 260] as [number, number], wheel: 0 },
      ];
      const state = rigState();
      let camera = stepCamera(state, snapshot(), RIGID);
      for (const step of steps) {
        camera = stepCamera(
          state,
          snapshot({ look: { x: step.look[0], y: step.look[1] }, zoomSteps: step.wheel }),
          RIGID,
        );
      }
      const stick = stickCamera(steps);

      camera.eye.forEach((value, axis) => expect(value).toBeCloseTo(stick.eye[axis], 12));
      camera.target.forEach((value, axis) => expect(value).toBeCloseTo(stick.target[axis], 12));
    });

    it('frames the focus at the config eye height', () => {
      const camera = stepCamera(rigState(), snapshot(), { ...CONFIG, followHeight: 2 });

      expect(camera.target).toEqual([10, 4, 30]);
    });

    it('applies every wheel notch of a frame, clamped to the zoom bounds', () => {
      const state = rigState();

      stepCamera(state, snapshot({ zoomSteps: 2 }), CONFIG);
      expect(state.distanceTarget).toBeCloseTo(7 * 1.08 * 1.08, 12);

      stepCamera(state, snapshot({ zoomSteps: 20 }), CONFIG);
      expect(state.distanceTarget).toBe(CONFIG.followZoomMax);
    });

    it('lets the map viewer look further down than gameplay may', () => {
      const state = rigState();
      setFlyEye(state, [0, 100, 0]);

      stepCamera(state, snapshot({ look: { x: 0, y: 5000 }, mode: 'fly' }), RIGID);

      expect(state.pitch).toBe(TOP_DOWN_PITCH);
      expect(state.pitch).toBeLessThan(CONFIG.pitchMin);
    });

    it('walks, pans and dollies the detached eye in fly mode', () => {
      const state = createRigState(CONFIG, 0, 0); // looking down +Z
      setFlyEye(state, [0, 100, 0]);

      stepCamera(state, snapshot({ mode: 'fly', walkKeys: new Set(['ArrowUp']) }), CONFIG);
      expect(state.flyEye?.[2]).toBeCloseTo(FLY_SPEED / 60, 12);

      const walked = state.flyEye?.[0] ?? 0;
      stepCamera(state, snapshot({ mode: 'fly', pan: { x: 0.1, y: 0 } }), CONFIG);
      expect(state.flyEye?.[0]).toBeGreaterThan(walked);

      const height = state.flyEye?.[1] ?? 0;
      stepCamera(state, snapshot({ mode: 'fly', zoomSteps: -1 }), CONFIG);
      expect(state.flyEye?.[1]).toBe(height); // level view: the dolly runs flat, not down
      expect(state.flyEye?.[2]).toBeGreaterThan(FLY_SPEED / 60);
    });

    it('snaps overhead when the map viewer opens, and re-attaches on exit', () => {
      const state = rigState();
      snapTopDown(state, [10, 2, 30]);

      expect(state.flyEye).toEqual([10, 2 + TOP_DOWN_HEIGHT, 30]);
      expect(state.pitch).toBe(TOP_DOWN_PITCH);

      setFlyEye(state, null);
      const camera = stepCamera(state, snapshot(), CONFIG);

      expect(camera.eye[1]).toBeLessThan(TOP_DOWN_HEIGHT);
    });

    it('re-seeds the zoom from an authored distance the debugger changed', () => {
      const state = rigState();

      reseedDistance(state, CONFIG, 9);
      expect(state.distance).toBe(9);

      reseedDistance(state, CONFIG, 40); // past the bound — the slider may not escape the zoom range
      expect(state.distance).toBe(CONFIG.followZoomMax);
    });
  });
});

describe('stepCamera — the smoothed rig (plan 080/02)', () => {
  /** Step `frames` idle frames and hand back the last camera. */
  const idle = (
    state: ReturnType<typeof createRigState>,
    frames: number,
    over: Partial<CameraSnapshot> = {},
  ): ReturnType<typeof stepCamera> => {
    let camera = stepCamera(state, snapshot(over), CONFIG);
    for (let frame = 1; frame < frames; frame += 1) {
      camera = stepCamera(state, snapshot(over), CONFIG);
    }

    return camera;
  };

  describe('negative cases', () => {
    it('does not turn the whole flick in the frame it arrives (input dampening)', () => {
      const smooth = rigState();
      const raw = rigState();

      stepCamera(smooth, snapshot({ look: { x: 200, y: 0 } }), CONFIG);
      stepCamera(raw, snapshot({ look: { x: 200, y: 0 } }), RIGID);

      expect(Math.abs(smooth.yaw - Math.PI)).toBeLessThan(Math.abs(raw.yaw - Math.PI));
    });

    it('does not snap the frame onto a focus that jumped a few metres', () => {
      const state = rigState();
      stepCamera(state, snapshot(), CONFIG);
      const camera = stepCamera(state, snapshot({ focus: [10, 2, 33] }), CONFIG);

      expect(camera.target[2]).toBeGreaterThan(30);
      expect(camera.target[2]).toBeLessThan(33);
    });

    it('leaves a detached fly eye unsmoothed — a viewer must land where it is dragged', () => {
      const state = rigState();
      setFlyEye(state, [4, 50, 6]);

      expect(stepCamera(state, snapshot({ mode: 'fly' }), CONFIG).eye).toEqual([4, 50, 6]);
    });

    it('drops the steered yaw the moment the player touches the mouse', () => {
      const state = rigState();
      steerYaw(state, 0);
      stepCamera(state, snapshot(), CONFIG);

      stepCamera(state, snapshot({ look: { x: 5, y: 0 } }), CONFIG);

      expect(state.yawTarget).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('conserves the gesture: the same total turn as the raw path, a few frames later', () => {
      const smooth = rigState();
      const raw = rigState();
      stepCamera(smooth, snapshot({ look: { x: 200, y: 0 } }), CONFIG);
      idle(smooth, 30);
      stepCamera(raw, snapshot({ look: { x: 200, y: 0 } }), RIGID);

      expect(smooth.yaw).toBeCloseTo(raw.yaw, 6);
    });

    it('settles the look point on a focus that stopped moving', () => {
      const state = rigState();
      stepCamera(state, snapshot(), CONFIG);
      const camera = idle(state, 180, { focus: [10, 2, 33] });

      expect(33 - camera.target[2]).toBeLessThanOrEqual(CONFIG.deadZone * 1.5); // dead-zone residual only
    });

    it('swings BEHIND a steered facing instead of snapping, then hands the camera back', () => {
      const state = rigState();
      // steerYaw takes a FACING; the rig settles at yawBehind of it (facing −π/2 → behind is π/2).
      steerYaw(state, -Math.PI / 2);
      expect(state.yawTarget).toBeCloseTo(Math.PI / 2, 12);

      stepCamera(state, snapshot(), CONFIG);
      expect(state.yaw).toBeLessThan(Math.PI);
      expect(state.yaw).toBeGreaterThan(Math.PI / 2); // partway, not there

      idle(state, 180);
      expect(state.yaw).toBeCloseTo(Math.PI / 2, 3);
      expect(state.yawTarget).toBeNull();
    });

    it('glides the zoom toward its target instead of stepping', () => {
      const state = rigState();
      stepCamera(state, snapshot({ zoomSteps: 3 }), CONFIG);

      expect(state.distanceTarget).toBeGreaterThan(8);
      expect(state.distance).toBeLessThan(state.distanceTarget);

      idle(state, 120);
      expect(state.distance).toBeCloseTo(state.distanceTarget, 3);
    });

    it('snaps everything on a teleport (respawn, debugger warp)', () => {
      const state = rigState();
      stepCamera(state, snapshot(), CONFIG);
      const camera = stepCamera(state, snapshot({ focus: [10, 2, 500] }), CONFIG);

      expect(camera.target[2]).toBe(500);
    });
  });
});

describe('stepCamera — composition (plan 080/03)', () => {
  /**
   * Walk the focus in the direction `heading` FACES, at `speed`, for `seconds`.
   *
   * A GTA heading h points along (−sin h, cos h) in GTA XY, which is (−sin h, −cos h) in the engine's
   * planar axes — so heading 0 walks toward −Z, the way a camera at yaw π looks.
   */
  const walk = (
    state: ReturnType<typeof createRigState>,
    speed: number,
    seconds: number,
    heading = 0,
    mode: CameraSnapshot['mode'] = 'foot',
  ): ReturnType<typeof stepCamera> => {
    const dirX = -Math.sin(heading);
    const dirZ = -Math.cos(heading);
    let x = 10;
    let z = 30;
    let camera = stepCamera(state, snapshot({ focusHeading: heading, mode }), CONFIG);
    for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) {
      x += (dirX * speed) / 60;
      z += (dirZ * speed) / 60;
      camera = stepCamera(state, snapshot({ focus: [x, 2, z], focusHeading: heading, mode }), CONFIG);
    }

    return camera;
  };

  describe('negative cases', () => {
    it('leaves the yaw alone while the player stands still, however long', () => {
      const state = rigState();
      walk(state, 0, 6);

      expect(state.yaw).toBe(Math.PI);
    });

    it('does not LEAN in a vehicle — the look-ahead lean is drift framing, plan 05', () => {
      const state = rigState();
      walk(state, 12, 3, 0, 'vehicle');

      expect(state.lookAhead.z).toBe(0); // no look-ahead offset while driving
    });

    it('suspends auto-center while a scripted enter/exit settles, but keeps the steered swing', () => {
      const state = rigState();
      steerYaw(state, -Math.PI / 2); // the sequence aimed the camera behind the car
      const settling = (over = {}): CameraSnapshot => snapshot({ settling: true, ...over });

      // A ped twitching through the climb-in (heading swinging around) must not drag the camera...
      for (let frame = 0; frame < 30; frame += 1) {
        stepCamera(state, settling({ focus: [10, 2, 30 + frame], focusHeading: frame }), CONFIG);
      }
      expect(state.autoCenter.following).toBe(false);

      // ...but the swing set at the start still glides to its target.
      for (let frame = 0; frame < 300; frame += 1) {
        stepCamera(state, settling(), CONFIG);
      }
      expect(state.yaw).toBeCloseTo(Math.PI / 2, 2); // yawBehind(−π/2)
    });

    it('restarts the idle clock the moment the player looks', () => {
      const state = rigState();
      walk(state, 7, 1.5);
      const before = state.autoCenter.idleFor;

      stepCamera(state, snapshot({ look: { x: 3, y: 0 } }), CONFIG);

      expect(state.autoCenter.idleFor).toBeLessThan(before);
      expect(state.autoCenter.idleFor).toBeCloseTo(1 / 60, 6);
    });
  });

  describe('positive cases', () => {
    it('eases behind a player who runs off at an angle without touching the mouse', () => {
      const state = rigState();
      // Running the way the camera already looks needs no correction — that IS the invariant: heading 0 is
      // exactly what a camera at yaw π (the rig's start) sits behind.
      walk(state, 7, 1);
      expect(state.yaw).toBeCloseTo(Math.PI, 6);

      // Now run 1 rad off to the side and keep going: the camera finds its way behind, unasked.
      walk(state, 7, CONFIG.recenterDelaySec + 6, 1);

      expect(state.autoCenter.idleFor).toBeGreaterThan(CONFIG.recenterDelaySec);
      expect(state.yaw).toBeCloseTo(1 + Math.PI, 1);
    });

    it('leans the frame toward travel while running', () => {
      const state = rigState();
      walk(state, 7, 3);

      expect(state.lookAhead.z).toBeLessThan(-0.5); // heading 0 runs toward −Z, so the frame leans that way
      expect(Math.hypot(state.lookAhead.x, state.lookAhead.z)).toBeLessThanOrEqual(CONFIG.lookAheadDistance + 1e-9);
    });

    it('moves eye and target together, so the orbit geometry is unchanged', () => {
      const state = rigState();
      const camera = walk(state, 7, 3);
      const orbit = Math.hypot(camera.eye[0] - camera.target[0], camera.eye[2] - camera.target[2]);

      // The lean shifted the whole rig, not the eye alone: the planar orbit radius still matches the
      // distance channel projected onto the plane.
      expect(orbit).toBeCloseTo(state.distance * Math.cos(state.pitch), 6);
    });

    it('settles behind a car the player drives on without touching the mouse', () => {
      const state = rigState();
      // Drive off 1 rad from where the camera looks and keep going past the recenter delay.
      walk(state, 12, CONFIG.recenterDelaySec + 6, 1, 'vehicle');

      expect(state.yaw).toBeCloseTo(1 + Math.PI, 1);
      expect(state.lookAhead.z).toBe(0); // still no lean — that is 05
    });

    it('eases the distance to the car size while seated, and back on foot', () => {
      const state = rigState();
      // A car wanting distance 12 (bigger than the on-foot 7): the live distance glides up to it.
      for (let frame = 0; frame < 240; frame += 1) {
        stepCamera(state, snapshot({ mode: 'vehicle', vehicleDistance: 12 }), CONFIG);
      }
      expect(state.distance).toBeCloseTo(12, 1);

      // Out of the car, it eases back to the on-foot zoom target (7).
      for (let frame = 0; frame < 240; frame += 1) {
        stepCamera(state, snapshot(), CONFIG);
      }
      expect(state.distance).toBeCloseTo(7, 1);
    });

    it('caps the distance at a wall (collision) on foot AND in a car', () => {
      const wall: CameraProbe = () => 3; // a wall 3 m behind the look point
      const orbitOf = (state: ReturnType<typeof createRigState>, over = {}): number => {
        let camera = stepCamera(state, snapshot(over), CONFIG, wall);
        for (let frame = 0; frame < 120; frame += 1) {
          camera = stepCamera(state, snapshot(over), CONFIG, wall);
        }

        return Math.hypot(camera.eye[0] - camera.target[0], camera.eye[2] - camera.target[2]) / Math.cos(state.pitch);
      };

      // On foot the desired 7 is capped to the wall at 3.
      expect(orbitOf(rigState())).toBeCloseTo(3, 1);
      // In a car the size-based 12 is capped to the same wall at 3.
      expect(orbitOf(rigState(), { mode: 'vehicle', vehicleDistance: 12 })).toBeCloseTo(3, 1);
    });

    it('does not cap during a scripted enter/exit (settling), only the floor guard runs', () => {
      const wall: CameraProbe = () => 3;
      const state = rigState();
      let camera = stepCamera(state, snapshot({ settling: true }), CONFIG, wall);
      for (let frame = 0; frame < 60; frame += 1) {
        camera = stepCamera(state, snapshot({ settling: true }), CONFIG, wall);
      }
      const orbit =
        Math.hypot(camera.eye[0] - camera.target[0], camera.eye[2] - camera.target[2]) / Math.cos(state.pitch);

      expect(orbit).toBeCloseTo(7, 1); // the wall cap is suspended; the swing centres without a pull-in jump
    });

    it('holds the eye at the near-plane floor against a very close wall (clips the ped, not skybox)', () => {
      const near: CameraProbe = () => 0.2; // a wall 0.2 m behind — inside the near plane
      const state = rigState();
      let camera = stepCamera(state, snapshot(), CONFIG, near);
      for (let frame = 0; frame < 60; frame += 1) {
        camera = stepCamera(state, snapshot(), CONFIG, near);
      }
      const orbit =
        Math.hypot(camera.eye[0] - camera.target[0], camera.eye[2] - camera.target[2]) / Math.cos(state.pitch);

      expect(orbit).toBeCloseTo(CONFIG.collisionMinDistance, 1); // held at 0.5, never behind the wall
    });
  });
});

describe('stepCamera — the vehicle camera (plan 080/05)', () => {
  const FAST = CONFIG.vehicleFovMaxSpeed;
  const SLIDE = CONFIG.driftSlipDeadZone * 3;

  /**
   * Drive the focus along `heading` at `speed` for `seconds`, reporting the car's slip the way the physics
   * channel does (081/01's `planarMotion`), not as something derived from the focus delta.
   */
  const drive = (
    state: ReturnType<typeof createRigState>,
    speed: number,
    seconds: number,
    over: { heading?: number; slipAngle?: number } = {},
  ): ReturnType<typeof stepCamera> => {
    const heading = over.heading ?? 0;
    const dirX = -Math.sin(heading);
    const dirZ = -Math.cos(heading);
    const frame = (focus: [number, number, number]): CameraSnapshot =>
      snapshot({
        focus,
        focusHeading: heading,
        mode: 'vehicle',
        vehicle: { slipAngle: over.slipAngle ?? 0, speed },
        vehicleDistance: 9,
      });
    let x = 10;
    let z = 30;
    let camera = stepCamera(state, frame([x, 2, z]), CONFIG);
    for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) {
      x += (dirX * speed) / 60;
      z += (dirZ * speed) / 60;
      camera = stepCamera(state, frame([x, 2, z]), CONFIG);
    }

    return camera;
  };

  describe('negative cases', () => {
    it('never widens the lens on foot, however fast the player runs', () => {
      const state = rigState();
      for (let frame = 0; frame < 240; frame += 1) {
        stepCamera(state, snapshot({ focus: [10, 2, 30 - frame], focusHeading: 0 }), CONFIG);
      }

      expect(state.fov).toBe(CAMERA_FOV_Y);
    });

    it('does not lean the frame while driving straight — the slip channel reads zero', () => {
      const state = rigState();
      drive(state, FAST, CONFIG.vehicleRecenterDelaySec + 6);

      expect(state.yaw).toBeCloseTo(Math.PI, 1); // squarely behind the car, no drift offset
    });

    it('holds the base lens at city speeds — throttle noise must not pump the FOV', () => {
      const state = rigState();
      drive(state, CONFIG.vehicleFovMinSpeed - 1, 4);

      expect(state.fov).toBe(CAMERA_FOV_Y);
    });
  });

  describe('positive cases', () => {
    it('widens the lens with speed, and eases it back once out of the car', () => {
      const state = rigState();
      drive(state, FAST, 4);
      expect(state.fov).toBeGreaterThan(CAMERA_FOV_Y);
      const wide = state.fov;

      // Back on foot the same channel closes it — no cut.
      for (let frame = 0; frame < 240; frame += 1) {
        stepCamera(state, snapshot(), CONFIG);
      }

      expect(state.fov).toBeLessThan(wide);
      expect(state.fov).toBeCloseTo(CAMERA_FOV_Y, 3);
    });

    it('opens the follow distance with speed and glides it back in when the car slows', () => {
      const state = rigState();
      drive(state, CONFIG.vehicleDistanceSpeed, 6);
      const atSpeed = state.distance;
      expect(atSpeed).toBeGreaterThan(9);
      expect(atSpeed).toBeCloseTo(9 + CONFIG.vehicleDistanceGain, 1);

      drive(state, 0, 6);

      expect(state.distance).toBeLessThan(atSpeed);
      expect(state.distance).toBeCloseTo(9, 1); // back to the size-based distance
    });

    it('settles behind where the car TRAVELS in a slide, not behind its nose', () => {
      const state = rigState();
      drive(state, FAST, CONFIG.vehicleRecenterDelaySec + 8, { slipAngle: SLIDE });

      // Behind the drift-blended heading: the camera looks partway along the slide.
      expect(state.yaw).toBeCloseTo(Math.PI + SLIDE * CONFIG.driftLookBlend, 1);
      expect(state.yaw).toBeGreaterThan(Math.PI);
    });

    it('settles sooner in a car than on foot — hands-off is the norm while driving', () => {
      // The vehicle table's shorter recenter delay: at a time BETWEEN the two delays, only the car has
      // started coming home.
      const seconds = (CONFIG.vehicleRecenterDelaySec + CONFIG.recenterDelaySec) / 2;
      const driven = rigState();
      driven.yaw = Math.PI - 1;
      drive(driven, FAST, seconds, { heading: 0 });

      const onFoot = rigState();
      onFoot.yaw = Math.PI - 1;
      for (let elapsed = 0, z = 30; elapsed < seconds; elapsed += 1 / 60) {
        z -= 7 / 60;
        stepCamera(onFoot, snapshot({ focus: [10, 2, z], focusHeading: 0 }), CONFIG);
      }

      expect(Math.abs(driven.yaw - Math.PI)).toBeLessThan(Math.abs(onFoot.yaw - Math.PI));
    });

    it('crosses seat → drive → exit with no cut: every channel keeps its state', () => {
      const state = rigState();
      drive(state, FAST, 4, { slipAngle: SLIDE });
      const before = { distance: state.distance, fov: state.fov, yaw: state.yaw };

      // The step the player steps out on: same rig, foot tuning.
      const camera = stepCamera(state, snapshot({ focus: [10, 2, 30] }), CONFIG);

      expect(state.yaw).toBe(before.yaw); // nothing re-seeds the yaw
      expect(Math.abs(state.fov - before.fov)).toBeLessThan(0.02); // the lens eases, it does not cut
      expect(Math.abs(state.distance - before.distance)).toBeLessThan(0.5);
      expect(camera.fovYRad).toBe(state.fov); // the frame is drawn with the channel's live value
    });
  });
});
