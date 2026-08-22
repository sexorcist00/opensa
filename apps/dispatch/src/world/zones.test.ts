import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDistricts, NO_DISTRICTS } from './zones';

const TABLE = {
  districts: [
    { key: 'LOSSANTOS', max: [2997, -768], min: [44.6, -2892.9], name: 'Los Santos' },
    { key: 'GAN', max: [2632.8, -1722.3], min: [2222.6, -1852.9], name: 'Ganton' },
  ],
  gxt: 'text/american.gxt',
};

function serve(body: string, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok, text: () => Promise.resolve(body) })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadDistricts', () => {
  describe('negative cases', () => {
    it('answers nothing when the pak declares no districts', async () => {
      expect(await loadDistricts('/pak', undefined)).toBe(NO_DISTRICTS);
    });

    it('answers nothing when the file is not there — a world without names is not an error', async () => {
      serve('', false);

      expect((await loadDistricts('/pak', { count: 2, file: 'districts.json' })).count).toBe(0);
    });

    it('answers nothing on a malformed file rather than throwing into the boot', async () => {
      serve('not json at all');

      expect((await loadDistricts('/pak', { count: 2, file: 'districts.json' })).count).toBe(0);
    });

    it('drops a malformed row instead of letting it throw inside the click handler', async () => {
      serve(
        JSON.stringify({
          districts: [{ key: 'BROKEN', name: 'No corners' }, ...TABLE.districts],
          gxt: null,
        }),
      );
      const lookup = await loadDistricts('/pak', { count: 3, file: 'districts.json' });

      expect(lookup.count).toBe(2);
      expect(() => lookup.nameAt([2495, -1800])).not.toThrow();
      expect(lookup.nameAt([2495, -1800])).toBe('Ganton');
    });

    it('answers null for a point in no district', async () => {
      serve(JSON.stringify(TABLE));
      const lookup = await loadDistricts('/pak', { count: 2, file: 'districts.json' });

      expect(lookup.nameAt([-9000, 9000])).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('names the smallest containing district, not the city around it', async () => {
      serve(JSON.stringify(TABLE));
      const lookup = await loadDistricts('/pak', { count: 2, file: 'districts.json' });

      expect(lookup.count).toBe(2);
      expect(lookup.nameAt([2495, -1800])).toBe('Ganton');
      expect(lookup.nameAt([1480, -1720])).toBe('Los Santos');
    });
  });
});
