import { describe, expect, it } from 'vitest';

import { canvasAspect, captureSurface } from './capture-surface';

describe('captureSurface', () => {
  describe('negative cases', () => {
    it('is null when the parameter is absent, so the viewport decides as usual', () => {
      expect(captureSurface(new URLSearchParams(''))).toBeNull();
    });

    it('refuses a value it cannot parse rather than pinning a size nobody asked for', () => {
      expect(captureSurface(new URLSearchParams('surface=720'))).toBeNull();
      expect(captureSurface(new URLSearchParams('surface=720*1218'))).toBeNull();
      expect(captureSurface(new URLSearchParams('surface=wide'))).toBeNull();
      expect(captureSurface(new URLSearchParams('surface='))).toBeNull();
    });

    it('refuses a size outside the range a real drawing buffer lives in', () => {
      expect(captureSurface(new URLSearchParams('surface=1x1'))).toBeNull();
      expect(captureSurface(new URLSearchParams('surface=9999x9999'))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('pins the drawing buffer the circuit was taken at', () => {
      expect(captureSurface(new URLSearchParams('surface=720x1218'))).toEqual({ height: 1218, width: 720 });
    });

    it('accepts the capital X a hand-typed link tends to carry', () => {
      expect(captureSurface(new URLSearchParams('surface=720X640'))).toEqual({ height: 640, width: 720 });
    });

    it('reads it beside the other capture knobs', () => {
      expect(captureSurface(new URLSearchParams('units=0&calls=0&inventory=1&surface=720x864'))).toEqual({
        height: 864,
        width: 720,
      });
    });
  });
});

/** A canvas as the two halves see it: the buffer it draws into, and the box the browser stretches it to. */
const canvas = (
  width: number,
  height: number,
  clientWidth: number,
  clientHeight: number,
): Parameters<typeof canvasAspect>[0] => ({
  clientHeight,
  clientWidth,
  height,
  width,
});

describe('canvasAspect', () => {
  describe('negative cases', () => {
    // The whole finding: a pin the camera framed for made the map ~1.7x too tall on the phone.
    it('does not take the aspect from a PINNED buffer, which is not what the viewer sees', () => {
      const pinned = canvas(720, 640, 360, 550);

      expect(canvasAspect(pinned)).not.toBeCloseTo(720 / 640, 3);
      expect(canvasAspect(pinned)).toBeCloseTo(360 / 550, 3);
    });

    it('falls back to the buffer while the element has no layout yet, rather than to 1', () => {
      expect(canvasAspect(canvas(720, 640, 0, 0))).toBeCloseTo(720 / 640, 3);
      expect(canvasAspect(canvas(720, 640, 360, 0))).toBeCloseTo(720 / 640, 3);
    });

    it('never divides by zero on a canvas with no buffer either', () => {
      expect(Number.isFinite(canvasAspect(canvas(0, 0, 0, 0)))).toBe(true);
    });
  });

  describe('positive cases', () => {
    // Unpinned the buffer IS the box times the DPR, so this changes nothing on any shipping surface.
    it('is the same number as the buffer gives when nothing is pinned', () => {
      expect(canvasAspect(canvas(720, 1100, 360, 550))).toBeCloseTo(720 / 1100, 3);
      expect(canvasAspect(canvas(720, 1100, 360, 550))).toBeCloseTo(360 / 550, 3);
    });

    it('follows the box as the browser chrome collapses under a held pin', () => {
      expect(canvasAspect(canvas(720, 640, 360, 609))).toBeCloseTo(360 / 609, 3);
      expect(canvasAspect(canvas(720, 640, 360, 320))).toBeCloseTo(360 / 320, 3);
    });
  });
});
