import { describe, expect, it } from 'vitest';

import { attenuation, audibleGain, type AudioListener, DEFAULT_FALLOFF, panFor } from './spatial';

/** A listener at the origin looking down +Y with +X to its right — GTA's own axes. */
const AT_ORIGIN: AudioListener = { forward: [0, 1, 0], position: [0, 0, 0], right: [1, 0, 0] };

describe('attenuation', () => {
  describe('negative cases', () => {
    it('is zero for a falloff with no reference distance rather than dividing by it', () => {
      expect(attenuation(10, { maxDistance: 100, refDistance: 0, rolloffFactor: 1 })).toBe(0);
    });

    it('does not go below its value at maxDistance — a city from 900 m is faint, not switched off', () => {
      // 203's decision 2.3: the console's listener is the camera, and altitude is meant to be quiet rather
      // than silent, so the curve CLAMPS at maxDistance instead of cutting.
      const far = attenuation(900);

      expect(far).toBeCloseTo(attenuation(DEFAULT_FALLOFF.maxDistance), 10);
      expect(far).toBeGreaterThan(0);
    });
  });

  describe('positive cases', () => {
    it('is full gain inside the reference radius', () => {
      expect(attenuation(0)).toBe(1);
      expect(attenuation(DEFAULT_FALLOFF.refDistance)).toBe(1);
    });

    it('follows the Web Audio inverse model exactly, so a PannerNode could take over unchanged', () => {
      const { refDistance, rolloffFactor } = DEFAULT_FALLOFF;
      const distance = 55;

      expect(attenuation(distance)).toBeCloseTo(
        refDistance / (refDistance + rolloffFactor * (distance - refDistance)),
        10,
      );
    });

    it('halves at twice the reference distance under the physical rolloff', () => {
      expect(attenuation(2 * DEFAULT_FALLOFF.refDistance)).toBeCloseTo(0.5, 10);
    });
  });
});

describe('audibleGain', () => {
  describe('negative cases', () => {
    it('gives a non-positional sound its gain everywhere — it has no distance to fade over', () => {
      expect(audibleGain({ ...AT_ORIGIN, position: [900, 900, 900] }, null, 0.5)).toBe(0.5);
    });
  });

  describe('positive cases', () => {
    it('is the authored gain times the attenuation, which is what the pool ranks by', () => {
      expect(audibleGain(AT_ORIGIN, [0, 55, 0], 0.5)).toBeCloseTo(0.5 * attenuation(55), 10);
    });

    it('ranks a loud far sound below a quiet near one when the distance says so', () => {
      const near = audibleGain(AT_ORIGIN, [0, 6, 0], 0.2);
      const far = audibleGain(AT_ORIGIN, [0, 200, 0], 1);

      expect(near).toBeGreaterThan(far);
    });
  });
});

describe('panFor', () => {
  describe('negative cases', () => {
    it('centres a source at the listener rather than dividing by zero', () => {
      expect(panFor(AT_ORIGIN, [0, 0, 0])).toBe(0);
    });

    it('centres what two ears cannot tell apart — ahead, behind and overhead', () => {
      expect(panFor(AT_ORIGIN, [0, 100, 0])).toBe(0);
      expect(panFor(AT_ORIGIN, [0, -100, 0])).toBe(0);
      expect(panFor(AT_ORIGIN, [0, 0, 100])).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('puts a source on the listener’s right at +1 and on its left at -1', () => {
      expect(panFor(AT_ORIGIN, [100, 0, 0])).toBe(1);
      expect(panFor(AT_ORIGIN, [-100, 0, 0])).toBe(-1);
    });

    it('follows the listener’s heading rather than the world axes', () => {
      const turned: AudioListener = { forward: [1, 0, 0], position: [0, 0, 0], right: [0, -1, 0] };

      expect(panFor(turned, [0, -100, 0])).toBe(1);
      expect(panFor(turned, [100, 0, 0])).toBe(0);
    });

    it('is partial off the axis — 45 degrees is about 0.71', () => {
      expect(panFor(AT_ORIGIN, [100, 100, 0])).toBeCloseTo(Math.SQRT1_2, 6);
    });
  });
});
