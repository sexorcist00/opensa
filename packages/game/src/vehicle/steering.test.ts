import { describe, expect, it } from 'vitest';

import { steerLimit } from './steering';

/** A mid-range car: 35° of lock, a road tyre's grip, wheels straight, going straight. */
const CAR = { handbrake: false, lockDeg: 35, speed: 0, steerAngle: 0, swaySpeed: 0, traction: 0.7 };

describe('steerLimit', () => {
  describe('negative cases', () => {
    it('gives the full lock at a standstill — the formula divides by speed squared', () => {
      expect(steerLimit({ ...CAR, speed: 0 })).toBe(1);
    });

    it('gives the full lock to a car with no authored lock rather than dividing by it', () => {
      expect(steerLimit({ ...CAR, lockDeg: 0, speed: 30 })).toBe(1);
    });

    it('gives the full lock back while countersteering a slide', () => {
      // Sliding to the right with the wheel turned left is the driver catching it; the original exempts it.
      const caught = steerLimit({ ...CAR, speed: 30, steerAngle: -0.3, swaySpeed: 2 });

      expect(caught).toBe(1);
      expect(steerLimit({ ...CAR, speed: 30, steerAngle: 0.3, swaySpeed: 2 })).toBeLessThan(1);
    });

    it('gives the full lock back with the handbrake up — a handbrake turn is a slide on purpose', () => {
      expect(steerLimit({ ...CAR, handbrake: true, speed: 30 })).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('does not touch town driving — the full authored lock is available up to ~53 km/h', () => {
      expect(steerLimit({ ...CAR, speed: 50 / 3.6 })).toBe(1);
      expect(steerLimit({ ...CAR, speed: 60 / 3.6 })).toBeLessThan(1);
    });

    it('leaves a usable angle where a real car has one: ~9.4° of a 35° lock at 100 km/h', () => {
      expect(steerLimit({ ...CAR, speed: 100 / 3.6 }) * CAR.lockDeg).toBeCloseTo(9.4, 0);
    });

    it('tightens as the square of speed — twice the speed, a quarter of the demand it will allow', () => {
      const slow = Math.sin(steerLimit({ ...CAR, speed: 20 }) * ((CAR.lockDeg * Math.PI) / 180));
      const fast = Math.sin(steerLimit({ ...CAR, speed: 40 }) * ((CAR.lockDeg * Math.PI) / 180));

      expect(slow / fast).toBeCloseTo(4, 1);
    });

    it('allows a grippier tyre more angle at the same speed', () => {
      const gripped = steerLimit({ ...CAR, speed: 30, traction: 1 });
      const slippery = steerLimit({ ...CAR, speed: 30, traction: 0.5 });

      expect(gripped).toBeGreaterThan(slippery);
    });

    it('leaves a car with more authored lock a smaller SHARE of it — the angle itself is what is limited', () => {
      const wide = steerLimit({ ...CAR, lockDeg: 45, speed: 30 });
      const narrow = steerLimit({ ...CAR, lockDeg: 25, speed: 30 });

      expect(wide).toBeLessThan(narrow);
      expect(wide * 45).toBeCloseTo(narrow * 25, 5); // …and the usable ANGLE is the same either way
    });
  });
});
