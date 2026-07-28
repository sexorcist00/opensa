import { describe, expect, it } from 'vitest';

import { parseVehicleFeatures, UP_DOWN_LIGHTS } from './vehicle-features.parser';

describe('parseVehicleFeatures', () => {
  describe('negative cases', () => {
    it('returns nothing for an empty or comment-only table', () => {
      expect(parseVehicleFeatures('')).toEqual(new Map());
      expect(parseVehicleFeatures('# written by vehicle-installer\n\n')).toEqual(new Map());
    });

    it('skips a model line that declares no feature', () => {
      expect(parseVehicleFeatures('previon\n')).toEqual(new Map());
    });
  });

  describe('positive cases', () => {
    it('reads a model line, lowercasing the model and upper-casing its features', () => {
      const table = parseVehicleFeatures(`Previon ${UP_DOWN_LIGHTS.toLowerCase()}`);

      expect(table.get('previon')).toEqual([UP_DOWN_LIGHTS]);
    });

    it('takes several features per model and drops trailing comments', () => {
      const table = parseVehicleFeatures(`previon ${UP_DOWN_LIGHTS} SOMETHING_ELSE  # a 1986 Starion`);

      expect(table.get('previon')).toEqual([UP_DOWN_LIGHTS, 'SOMETHING_ELSE']);
    });
  });
});
