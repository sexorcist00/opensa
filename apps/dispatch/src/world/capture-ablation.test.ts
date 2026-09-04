/**
 * The parsing half of 201/9's ablation arms.
 *
 * What has to hold is the same thing `capture-budget`'s suite holds, and for the same reason: **an arm that
 * silently fell back to the default is a measurement of the default filed under another name**, and on a
 * device with no `timestamp-query` there is no second signal to catch it with. So a refused name must leave
 * the rest of the list standing, and `ablationLabel` must say exactly what ran.
 */
import { ablationLabel, NOTHING_ABLATED } from '@opensa/engine';
import { describe, expect, it } from 'vitest';

import { captureAblation } from './capture-ablation';

const read = (query: string): ReturnType<typeof captureAblation> => captureAblation(new URLSearchParams(query));

describe('captureAblation', () => {
  describe('negative cases', () => {
    it('ablates nothing when nothing is asked for', () => {
      expect(read('')).toEqual(NOTHING_ABLATED);
      expect(read('ablate=')).toEqual(NOTHING_ABLATED);
    });

    it('ignores a name it does not know and keeps the rest of the list', () => {
      const ablation = read('ablate=bloom,nonsense,cloud');

      expect(ablation.bloom).toBe(false);
      expect(ablation.cloudField).toBe(false);
      expect(ablation.cells).toBe(true);
    });

    it('falls back to the engine count for a level count that cannot be built', () => {
      expect(read('bloomlevels=0').bloomLevels).toBeNull();
      expect(read('bloomlevels=1').bloomLevels).toBeNull();
      expect(read('bloomlevels=99').bloomLevels).toBeNull();
      expect(read('bloomlevels=3.5').bloomLevels).toBeNull();
      expect(read('bloomlevels=four').bloomLevels).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('removes one pass by name', () => {
      expect(read('ablate=cells')).toMatchObject({ bloom: true, cells: false, cloudField: true });
      expect(read('ablate=probe')).toMatchObject({ probe: false, skyLut: true });
      expect(read('ablate=skylut')).toMatchObject({ probe: true, skyLut: false });
    });

    // Subtraction needs groups as often as it needs singles.
    it('removes several at once, in one arm', () => {
      const ablation = read('ablate=bloom,cloud,probe');

      expect(ablation).toMatchObject({ bloom: false, cells: true, cloudField: false, probe: false });
    });

    it('takes a level count the chain can build', () => {
      expect(read('bloomlevels=4').bloomLevels).toBe(4);
      expect(read('bloomlevels= 2 ').bloomLevels).toBe(2);
    });

    it('reads back what ran, so a row cannot claim an arm it did not take', () => {
      expect(ablationLabel(read(''))).toBe('none');
      expect(ablationLabel(read('ablate=cells'))).toBe('cells');
      expect(ablationLabel(read('ablate=bloom,cloud'))).toBe('cloud-field bloom');
      expect(ablationLabel(read('bloomlevels=4'))).toBe('bloom-levels=4');
    });
  });
});
