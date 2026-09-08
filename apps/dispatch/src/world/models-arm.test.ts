import { describe, expect, it } from 'vitest';

import { modelsArm } from './models-arm';

describe('modelsArm', () => {
  describe('negative cases', () => {
    it('reads an unrecognised value as the full arm rather than as a quiet fleet-less run', () => {
      expect(modelsArm(new URLSearchParams('models=off'))).toBe('on');
      expect(modelsArm(new URLSearchParams('models=false'))).toBe('on');
      expect(modelsArm(new URLSearchParams('models='))).toBe('on');
      expect(modelsArm(new URLSearchParams('models=00'))).toBe('on');
    });
  });

  describe('positive cases', () => {
    it('draws the fleet when nothing is asked for', () => {
      expect(modelsArm(new URLSearchParams(''))).toBe('on');
      expect(modelsArm(new URLSearchParams('units=150&calls=40'))).toBe('on');
    });

    it('takes the fleet off on the exact string every filed row will carry', () => {
      expect(modelsArm(new URLSearchParams('models=0'))).toBe('off');
      expect(modelsArm(new URLSearchParams('units=150&models=0&inventory=1'))).toBe('off');
    });
  });
});
