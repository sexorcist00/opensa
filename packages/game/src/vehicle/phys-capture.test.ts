import { describe, expect, it } from 'vitest';

import type { TelemetryFrame, WheelFrame } from './vehicle-telemetry';

import { summarisePhysFrames, thinFrames } from './phys-capture';

const DT = 1 / 60;

const wheel = (contact = true): WheelFrame => ({
  compression: 0.5,
  contact,
  forwardImpulse: 0,
  load: 3000,
  sideImpulse: 0,
  slipRatio: 0,
});

const frame = (t: number, over: Partial<TelemetryFrame> = {}): TelemetryFrame => ({
  brake: 0,
  engineForce: 0,
  gLat: 0,
  gLong: 0,
  gVert: 0,
  heading: 0,
  pitch: 0,
  roll: 0,
  slipAngle: 0,
  slipRatio: 0,
  speed: 0,
  speedLateral: 0,
  steer: 0,
  t,
  throttle: 0,
  wheels: [wheel(), wheel()],
  yawRate: 0,
  ...over,
});

/** `count` frames one fixed step apart, each shaped by `at(index)`. */
const lap = (count: number, at: (index: number) => Partial<TelemetryFrame>): TelemetryFrame[] =>
  Array.from({ length: count }, (_, index) => frame(index * DT, at(index)));

describe('summarisePhysFrames', () => {
  describe('negative cases', () => {
    it('summarises an empty capture to zeros instead of throwing', () => {
      const summary = summarisePhysFrames([]);

      expect(summary.frames).toBe(0);
      expect(summary.brake).toBeNull();
      expect(summary.topSpeedKmh).toBe(0);
    });

    it('reports no braking run when the lap braked but never stopped inside the capture', () => {
      const summary = summarisePhysFrames(lap(60, () => ({ brake: 5000, speed: 20 })));

      expect(summary.brake).toBeNull();
      expect(summary.pitchUnderBrakeDeg).toBe(0); // it DID brake, so the pitch number still exists
    });

    it('reports no time-to-100 for a car that never gets there', () => {
      expect(summarisePhysFrames(lap(120, () => ({ speed: 10 }))).timeTo100S).toBeNull();
    });

    it('reports no flip while the car stays on its wheels', () => {
      expect(summarisePhysFrames(lap(60, () => ({ roll: Math.PI / 4 }))).flip).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('keeps the peak nose-up angle reached while the brakes were on, not the lap maximum', () => {
      const frames = [
        ...lap(30, () => ({ pitch: 0.5 })), // a big nose-up BEFORE the brakes: a crest, not the complaint
        ...lap(30, () => ({ brake: 8000, pitch: 0.1, speed: 20 })).map((f) => ({ ...f, t: f.t + 0.5 })),
      ];

      expect(summarisePhysFrames(frames).pitchUnderBrakeDeg).toBeCloseTo(5.73, 1);
      expect(summarisePhysFrames(frames).pitchDeg.max).toBeCloseTo(28.65, 1);
    });

    it('measures a braking run from its first braked frame to the stop', () => {
      // 2 s rolling at 20 m/s, then 60 frames of braking that end stopped.
      const frames = [
        ...lap(120, () => ({ speed: 20 })),
        ...lap(60, (index) => ({ brake: 8000, speed: index < 59 ? 20 : 0 })).map((f) => ({ ...f, t: f.t + 2 })),
      ];
      const { brake } = summarisePhysFrames(frames);

      expect(brake?.fromKmh).toBeCloseTo(72, 0);
      expect(brake?.seconds).toBeCloseTo(0.98, 1);
      expect(brake?.distanceM).toBeCloseTo(19.7, 0);
    });

    it('counts air time from the frames with no wheel in contact', () => {
      const frames = lap(120, (index) => ({ wheels: index >= 30 && index < 90 ? [wheel(false)] : [wheel()] }));

      expect(summarisePhysFrames(frames).airborneS).toBeCloseTo(1, 1);
    });

    it('integrates the whole rotation, not the shortest way round', () => {
      // A full turn and a bit: 2.5 rad/s for 3 s = 7.5 rad ≈ 430°, which a shortest-angle diff would call 70.
      const frames = lap(180, () => ({ yawRate: 2.5 }));

      expect(summarisePhysFrames(frames).turnedDeg).toBeCloseTo(427, -1);
    });

    it('flags the first flip with the speed it happened at', () => {
      const frames = lap(120, (index) => ({ roll: index < 60 ? 0.2 : Math.PI / 2, speed: 15 }));
      const { flip } = summarisePhysFrames(frames);

      expect(flip?.atS).toBeCloseTo(1, 1);
      expect(flip?.atKmh).toBeCloseTo(54, 0);
    });
  });
});

describe('thinFrames', () => {
  describe('negative cases', () => {
    it('returns a two-frame capture untouched — there is nothing to thin', () => {
      const frames = lap(2, () => ({}));

      expect(thinFrames(frames, 10)).toEqual(frames);
    });
  });

  describe('positive cases', () => {
    it('thins to about the asked rate and always keeps the last frame', () => {
      const frames = lap(601, () => ({})); // 10 s at 60 Hz
      const thinned = thinFrames(frames, 20);

      expect(thinned.length).toBeGreaterThan(190);
      expect(thinned.length).toBeLessThan(210);
      expect(thinned[thinned.length - 1]).toBe(frames[frames.length - 1]);
    });
  });
});
