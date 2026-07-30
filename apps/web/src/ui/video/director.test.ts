import { mulberry32 } from '@opensa/game/paths/rng';
import { describe, expect, it } from 'vitest';

import {
  createDirector,
  type DirectorFrame,
  EMPTY_FRAME_SECONDS,
  PAN_RATE_MAX,
  planShots,
  SAFE_FRAME,
  type ShotPlan,
  stepDirector,
} from './director';
import { forwardFromHeading, type PlacedShot, SHOTS, type Subject } from './shots';

const ASPECT = 16 / 9;
const DT = 1 / 60;
const HALF_EXTENTS = [0.9, 2.3, 0.7] as const;

const WING: PlacedShot = {
  anchor: { x: 0.38, y: 0.58 },
  eyeSmooth: 0.18,
  fovYRad: Math.PI / 4,
  kind: 'tracking',
  maxSeconds: 7,
  minSeconds: 5,
  name: 'wing-l',
  offset: { forward: 0.4, height: 1.6, lateral: -5 },
  targetSmooth: 0.14,
  weight: 2,
};

const CHASE = SHOTS.find((shot) => shot.kind === 'chase') ?? SHOTS[0];
const FLYBY = SHOTS.find((shot) => shot.name === 'flyby') ?? SHOTS[0];

/** A car driving along engine −Z at `speed`, `seconds` after the start. */
const drivingSubject = (seconds: number, speed = 12): Subject => ({
  forward: forwardFromHeading(0),
  halfExtents: HALF_EXTENTS,
  position: [0, 0.6, -speed * seconds],
  speed,
});

/** Run the director over a straight cruise and hand back every frame it produced. */
const cruise = (plan: readonly ShotPlan[], seconds: number, speed = 12): DirectorFrame[] => {
  const state = createDirector(plan);
  const frames: DirectorFrame[] = [];
  for (let frame = 0; frame * DT < seconds; frame += 1) {
    frames.push(stepDirector(state, drivingSubject(frame * DT, speed), DT, ASPECT));
  }

  return frames;
};

describe('planShots', () => {
  describe('negative cases', () => {
    it('never deals a shot under the five-second floor (D4)', () => {
      for (let seed = 0; seed < 40; seed += 1) {
        const plan = planShots(mulberry32(seed), 25);

        expect(plan.filter((entry) => entry.seconds < 5)).toEqual([]);
      }
    });

    it('never repeats a preset back to back — a "cut" to the same shot is not a cut', () => {
      for (let seed = 0; seed < 40; seed += 1) {
        const names = planShots(mulberry32(seed), 60).map((entry) => entry.preset.name);
        const repeats = names.filter((name, at) => at > 0 && name === names[at - 1]);

        expect(repeats).toEqual([]);
      }
    });
  });

  describe('positive cases', () => {
    it('covers the whole fragment', () => {
      for (const seconds of [10, 18, 25, 40]) {
        const total = planShots(mulberry32(7), seconds).reduce((sum, entry) => sum + entry.seconds, 0);

        expect(total).toBeGreaterThanOrEqual(seconds);
      }
    });

    it('always shows the game as it is played — chase appears at least once', () => {
      for (let seed = 0; seed < 40; seed += 1) {
        const plan = planShots(mulberry32(seed), 12);

        expect(plan.some((entry) => entry.preset.kind === 'chase')).toBe(true);
      }
    });

    it('reproduces itself from the seed, shot for shot and second for second', () => {
      expect(planShots(mulberry32(47), 25)).toEqual(planShots(mulberry32(47), 25));
    });
  });
});

describe('stepDirector', () => {
  describe('negative cases', () => {
    it('does not cut inside a shot that is still framing its car', () => {
      const frames = cruise([{ preset: WING, seconds: 6 }], 5);

      expect(frames.filter((frame) => frame.cut).length).toBe(1); // the opening frame only
    });

    it('never swings the aim faster than the pan cap, however hard the car cuts across', () => {
      // A static camera the car passes at 30 m/s from 6 m out — the geometry that would whip.
      const state = createDirector([{ preset: FLYBY, seconds: 8 }]);
      let previous: [number, number, number] | null = null;
      let worst = 0;
      for (let frame = 0; frame < 300; frame += 1) {
        const at = frame * DT;
        const subject: Subject = {
          forward: forwardFromHeading(0),
          halfExtents: HALF_EXTENTS,
          position: [6, 0.6, 40 - 30 * at],
          speed: 30,
        };
        const { cut, pose } = stepDirector(state, subject, DT, ASPECT);
        if (!pose) {
          continue;
        }
        const direction = unit(pose.target, pose.eye);
        // A declared cut IS a discontinuity — the cap governs the frames BETWEEN cuts, which is exactly what
        // the watchdog is left holding the director to.
        if (previous !== null && !cut) {
          worst = Math.max(worst, Math.acos(Math.min(1, dot(previous, direction))) / DT);
        }
        previous = direction;
      }

      expect(worst).toBeLessThanOrEqual(PAN_RATE_MAX + 1e-6);
    });

    it('does not judge framing while the chase rig owns the frame', () => {
      const state = createDirector([{ preset: CHASE, seconds: 6 }]);
      for (let frame = 0; frame < 120; frame += 1) {
        stepDirector(state, drivingSubject(frame * DT), DT, ASPECT);
      }

      expect(state.framesJudged).toBe(0);
      expect(state.eye).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('opens on a declared cut and hands the shot its pose on the very first frame', () => {
      const [first] = cruise([{ preset: WING, seconds: 6 }], 1);

      expect(first.cut).toBe(true);
      expect(first.pose).not.toBeNull();
      expect(first.shot).toBe('wing-l');
    });

    it('yields the frame to the shipped rig for a chase shot, and declares the hand-over', () => {
      const frames = cruise(
        [
          { preset: WING, seconds: 5 },
          { preset: CHASE, seconds: 5 },
        ],
        7,
      );
      const handover = frames.findIndex((frame) => frame.pose === null);

      expect(handover).toBeGreaterThan(0);
      expect(frames[handover].cut).toBe(true);
      expect(frames[handover].shot).toBe('chase');
    });

    it('keeps the car inside the safe frame through a straight cruise', () => {
      const frames = cruise([{ preset: WING, seconds: 20 }], 8).filter((frame) => frame.screen !== null);
      const off = frames.filter(
        (frame) =>
          Math.abs((frame.screen?.x ?? 0.5) - 0.5) > SAFE_FRAME ||
          Math.abs((frame.screen?.y ?? 0.5) - 0.5) > SAFE_FRAME,
      );

      expect(off.length).toBe(0);
    });

    it('cuts a shot short once the car has been out of frame for the guard window', () => {
      // A static shot the car drives away from: it leaves frame and never comes back.
      const state = createDirector([
        { preset: FLYBY, seconds: 30 },
        { preset: WING, seconds: 6 },
      ]);
      stepDirector(state, drivingSubject(0, 25), DT, ASPECT); // the opening frame is a cut by definition
      let cutAt = -1;
      for (let frame = 1; frame < 1800 && cutAt < 0; frame += 1) {
        const step = stepDirector(state, drivingSubject(frame * DT, 25), DT, ASPECT);
        if (step.cut) {
          cutAt = frame * DT;
        }
      }

      expect(cutAt).toBeGreaterThan(EMPTY_FRAME_SECONDS);
      expect(cutAt).toBeLessThan(30); // long before the shot's own clock would have ended it
      expect(state.plan[state.index].preset.name).toBe('wing-l');
    });

    it('wraps to the front of the list rather than running out of director', () => {
      const frames = cruise(
        [
          { preset: WING, seconds: 5 },
          { preset: FLYBY, seconds: 5 },
        ],
        12,
      );

      expect(frames[frames.length - 1].shot).toBe('wing-l');
    });

    it('reproduces itself exactly from the same plan and the same drive', () => {
      const plan = planShots(mulberry32(11), 20);

      expect(cruise(plan, 15)).toEqual(cruise(plan, 15));
    });
  });
});

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function unit(
  to: readonly [number, number, number],
  from: readonly [number, number, number],
): [number, number, number] {
  const delta: [number, number, number] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const length = Math.hypot(...delta) || 1;

  return [delta[0] / length, delta[1] / length, delta[2] / length];
}
