import { describe, expect, it } from 'vitest';

import { CLOUD_FIELD_HZ, type CloudFieldBakeState, shouldBakeCloudField } from './cloud-field-bake';

const baked = (atMs: number, scale = 1): CloudFieldBakeState => ({ atMs, scale });

describe('shouldBakeCloudField', () => {
  describe('negative cases', () => {
    it('does not re-bake a field nothing has moved since', () => {
      expect(shouldBakeCloudField({ hz: CLOUD_FIELD_HZ, nowMs: 1000, previous: baked(950), scale: 1 })).toBe(false);
    });

    it('does not let the scroll alone wake it before the period is up', () => {
      // The whole point: time advances every frame, and every frame is what this step removed.
      for (const nowMs of [1000.016, 1016, 1050, 1099]) {
        expect(shouldBakeCloudField({ hz: 10, nowMs, previous: baked(1000), scale: 1 })).toBe(false);
      }
    });

    it('does not hold a stale field across a weather change, whatever the period says', () => {
      // Keying alone freezes the drift and amortizing alone holds a wrong field: the rule is either.
      expect(shouldBakeCloudField({ hz: 1, nowMs: 1001, previous: baked(1000, 1), scale: 1.4 })).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('bakes the first frame, when there is nothing to compare against', () => {
      expect(shouldBakeCloudField({ hz: CLOUD_FIELD_HZ, nowMs: 0, previous: null, scale: 1 })).toBe(true);
    });

    it('bakes once the period has elapsed', () => {
      expect(shouldBakeCloudField({ hz: 10, nowMs: 1100, previous: baked(1000), scale: 1 })).toBe(true);
    });

    it('bakes every frame at hz 0 — the arm that puts the pre-9/06 behaviour back', () => {
      for (const hz of [0, -1, Number.NaN]) {
        expect(shouldBakeCloudField({ hz, nowMs: 1000.016, previous: baked(1000), scale: 1 })).toBe(true);
      }
    });
  });
});
