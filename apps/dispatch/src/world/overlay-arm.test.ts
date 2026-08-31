import { describe, expect, it } from 'vitest';

import { armDrawsContent, armTouchesSurface, overlayArm } from './overlay-arm';

describe('overlayArm', () => {
  describe('negative cases', () => {
    it('reads an unrecognised value as the full arm rather than as a quiet engine-only run', () => {
      expect(overlayArm(new URLSearchParams('overlay=clera'))).toBe('on');
      expect(overlayArm(new URLSearchParams('overlay=1'))).toBe('on');
      expect(overlayArm(new URLSearchParams('overlay='))).toBe('on');
    });

    it('does not treat the cleared arm as an engine-only run — the surface is the thing it prices', () => {
      expect(armTouchesSurface('clear')).toBe(true);
      expect(armDrawsContent('clear')).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('defaults to the full arm when nothing is asked for', () => {
      expect(overlayArm(new URLSearchParams(''))).toBe('on');
    });

    it('keeps `overlay=0` spelled the way every filed row spells it', () => {
      expect(overlayArm(new URLSearchParams('overlay=0'))).toBe('off');
      expect(armTouchesSurface('off')).toBe(false);
    });

    it('separates the layer from its content across the three arms', () => {
      const arms = (['on', 'clear', 'off'] as const).map((arm) => [armTouchesSurface(arm), armDrawsContent(arm)]);

      expect(arms).toEqual([
        [true, true],
        [true, false],
        [false, false],
      ]);
    });
  });
});
