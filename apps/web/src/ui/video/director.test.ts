import { mulberry32 } from '@opensa/game/paths/rng';
import { describe, expect, it } from 'vitest';

import type { StationSource } from './director';

import {
  createDirector,
  type DirectorFrame,
  EMPTY_FRAME_SECONDS,
  nextStationSlot,
  PAN_RATE_MAX,
  planShots,
  SAFE_FRAME,
  type ShotPlan,
  SIGHTLINE_MISSES,
  SIGHTLINE_SECONDS,
  stepDirector,
} from './director';
import { forwardFromHeading, type PosedShot, SHOTS, type Subject } from './shots';

const ASPECT = 16 / 9;
const DT = 1 / 60;
const HALF_EXTENTS = [0.9, 2.3, 0.7] as const;

const WING: PosedShot = {
  anchor: { x: 0.38, y: 0.58 },
  eyeSmooth: 0.18,
  fovYRad: Math.PI / 4,
  kind: 'tracking',
  maxDist: 40,
  maxSeconds: 7,
  minSeconds: 5,
  name: 'wing-l',
  offset: { forward: 0.4, height: 1.6, lateral: -5 },
  targetSmooth: 0.14,
  weight: 2,
};

const CHASE = SHOTS.find((shot) => shot.kind === 'chase') ?? SHOTS[0];
const FLYBY = SHOTS.find((shot) => shot.name === 'flyby') ?? SHOTS[0];
const STATION = SHOTS.find((shot) => shot.kind === 'station') ?? SHOTS[0];

/** A stand-in survey: hands out one eye, and answers the live sightline however the test says. */
const stationSource = (
  eye: [number, number, number] | null,
  clear: () => boolean = () => true,
): StationSource & { asked: number } => {
  const source = {
    asked: 0,
    sightline(): boolean {
      source.asked += 1;

      return clear();
    },
    take: (): [number, number, number] | null => eye,
  };

  return source satisfies StationSource & { asked: number };
};

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

    it('does not let an irregular frame clock shake a car-mounted shot', () => {
      // The field bug this pins (096 field round 1): a `tracking` eye damped in WORLD space against a car at
      // a cruise carries a permanent lag, and the per-frame catch-up step scales with `dt` — so an uneven
      // frame clock modulates it and the mount buzzes along the travel axis. A headless run measured 3.1 ms
      // RMS of frame-clock jitter on a healthy 120 fps scene; these steps are that, rounded to the coarse.
      const steps = [1 / 120, 1 / 40, 1 / 120, 1 / 120, 1 / 60, 1 / 120, 1 / 90, 1 / 120];
      const state = createDirector([{ preset: WING, seconds: 30 }]);
      const mounts: number[] = [];
      let at = 0;
      for (let frame = 0; frame < 400; frame += 1) {
        const dt = steps[frame % steps.length];
        at += dt;
        const subject = drivingSubject(at);
        const { pose } = stepDirector(state, subject, dt, ASPECT);
        // The opening frame SNAPS by design, and the frames after it are the damper settling — neither is
        // what this measures. Everything from a second in is the shot as a viewer sees it.
        if (pose && at > 1) {
          mounts.push(pose.eye[2] - subject.position[2]); // the mount along the travel axis (heading 0 = −Z)
        }
      }
      const spread = Math.max(...mounts) - Math.min(...mounts);

      // Rigid means rigid: a constant-speed drive must leave the mount NOTHING to damp, whatever the clock
      // does. Damped in world space this same drive wandered by ~0.2 m and read as a 6 px/frame² shiver.
      expect(spread).toBeLessThan(0.001);
    });

    it('does not cut a tripod on ONE blocked probe — a lamppost is not a lost shot', () => {
      const state = createDirector([{ preset: STATION, seconds: 20 }]);
      const source = stationSource([14, 2, -20], () => false);
      for (let frame = 0; frame * DT < SIGHTLINE_SECONDS * SIGHTLINE_MISSES - 0.2; frame += 1) {
        stepDirector(state, drivingSubject(frame * DT), DT, ASPECT, source);
      }

      expect(state.misses).toBe(SIGHTLINE_MISSES - 1);
      expect(state.causes.occluded).toBe(0);
    });

    it('asks the sightline once a second, not once a frame', () => {
      const state = createDirector([{ preset: STATION, seconds: 20 }]);
      const source = stationSource([14, 2, -20]);
      for (let frame = 0; frame < 180; frame += 1) {
        stepDirector(state, drivingSubject(frame * DT), DT, ASPECT, source);
      }

      // Three seconds of frames, three probes — the budget the whole design rests on.
      expect(source.asked).toBe(3);
    });

    it('never asks the sightline for a car-anchored shot — only a tripod has one to lose', () => {
      const state = createDirector([{ preset: WING, seconds: 20 }]);
      const source = stationSource(null);
      for (let frame = 0; frame < 180; frame += 1) {
        stepDirector(state, drivingSubject(frame * DT), DT, ASPECT, source);
      }

      expect(source.asked).toBe(0);
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

    it('stands the tripod where the survey put it, and never moves it', () => {
      const state = createDirector([{ preset: STATION, seconds: 20 }]);
      const eye: [number, number, number] = [14, 2, -20];
      const first = stepDirector(state, drivingSubject(0), DT, ASPECT, stationSource(eye));
      let last = first;
      for (let frame = 1; frame < 120; frame += 1) {
        last = stepDirector(state, drivingSubject(frame * DT), DT, ASPECT, stationSource(eye));
      }

      expect(first.pose?.eye).toEqual(eye);
      expect(last.pose?.eye).toEqual(eye); // the aim tracked the car; the stand did not budge
      expect(last.pose?.target).not.toEqual(first.pose?.target);
    });

    it('cuts a tripod away after two blocked probes in a row, and says why', () => {
      const state = createDirector([
        { preset: STATION, seconds: 30 },
        { preset: WING, seconds: 6 },
      ]);
      const source = stationSource([14, 2, -20], () => false);
      stepDirector(state, drivingSubject(0), DT, ASPECT, source); // the opening frame is a cut by definition
      let cutAt = -1;
      for (let frame = 1; frame < 600 && cutAt < 0; frame += 1) {
        const step = stepDirector(state, drivingSubject(frame * DT), DT, ASPECT, source);
        if (step.cut) {
          cutAt = frame * DT;
          expect(step.cutCause).toBe('occluded');
        }
      }

      expect(cutAt).toBeGreaterThanOrEqual(SIGHTLINE_SECONDS * SIGHTLINE_MISSES);
      expect(state.causes.occluded).toBe(1);
      expect(state.plan[state.index].preset.name).toBe('wing-l');
    });

    it('plays the plan fallback when the survey came back empty — a missing station costs variety, not a scene', () => {
      const state = createDirector([{ fallback: WING, preset: STATION, seconds: 20 }]);
      const frame = stepDirector(state, drivingSubject(0), DT, ASPECT, stationSource(null));

      expect(frame.shot).toBe('wing-l');
      expect(frame.pose).not.toBeNull();
      expect(state.fallbacks).toBe(1);
    });

    it('treats a car past the shot distance ceiling as an empty frame', () => {
      const state = createDirector([
        { preset: STATION, seconds: 60 },
        { preset: WING, seconds: 6 },
      ]);
      const source = stationSource([0, 2, 0]);
      stepDirector(state, drivingSubject(0, 20), DT, ASPECT, source);
      let cutAt = -1;
      for (let frame = 1; frame < 3600 && cutAt < 0; frame += 1) {
        const step = stepDirector(state, drivingSubject(frame * DT, 20), DT, ASPECT, source);
        if (step.cut) {
          cutAt = frame * DT;
          expect(step.cutCause).toBe('empty');
        }
      }
      // The car passes 70 m at 3.5 s and the guard waits its window out on top of that.
      expect(cutAt).toBeGreaterThan(STATION.kind === 'chase' ? 0 : 3.5);
      expect(cutAt).toBeLessThan(3.5 + EMPTY_FRAME_SECONDS + 0.5);
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

describe('nextStationSlot', () => {
  describe('negative cases', () => {
    it('finds nothing in a plan with no tripod in it', () => {
      const state = createDirector([
        { preset: WING, seconds: 5 },
        { preset: CHASE, seconds: 5 },
      ]);

      expect(nextStationSlot(state)).toBeNull();
    });

    it('skips the tripod that is already PLAYING — its eye was taken when it started', () => {
      const state = createDirector([
        { preset: STATION, seconds: 6 },
        { preset: WING, seconds: 5 },
      ]);
      stepDirector(state, drivingSubject(0), DT, ASPECT, stationSource([14, 2, -20]));

      // The next one is the same slot a lap later, with the whole list to survey in.
      expect(nextStationSlot(state)?.index).toBe(0);
      expect(nextStationSlot(state)?.startsIn).toBeGreaterThan(6);
    });
  });

  describe('positive cases', () => {
    it('reports a tripod that has not started yet, so a scene opening on one can still be surveyed', () => {
      const state = createDirector([
        { preset: STATION, seconds: 6 },
        { preset: WING, seconds: 5 },
      ]);

      expect(nextStationSlot(state)).toEqual({ index: 0, seconds: 6, startsIn: 0 });
    });

    it('says when the next tripod starts, counting what is left of the shot in play', () => {
      const state = createDirector([
        { preset: WING, seconds: 6 },
        { preset: CHASE, seconds: 5 },
        { preset: STATION, seconds: 7 },
      ]);
      stepDirector(state, drivingSubject(0), 2, ASPECT); // two seconds into the first shot

      const slot = nextStationSlot(state);

      expect(slot?.index).toBe(2);
      expect(slot?.seconds).toBe(7);
      expect(slot?.startsIn).toBeCloseTo(4 + 5, 6);
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
