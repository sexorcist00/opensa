import { describe, expect, it } from 'vitest';

import { captureSurface } from './capture-surface';

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
