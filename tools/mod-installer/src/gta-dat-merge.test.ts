import { describe, expect, it } from 'vitest';

import { mergeGtaDat } from './gta-dat-merge';

describe('mergeGtaDat', () => {
  describe('negative cases', () => {
    it('returns the base unchanged with no refs', () => {
      const base = 'IDE data/maps/stock.ide\nIPL data/maps/stock.ipl\n';

      expect(mergeGtaDat(base, { ide: [], ipl: [] })).toBe(base);
    });

    it('skips a ref already listed (case/slash-insensitive) so it never double-places', () => {
      const base = 'IPL data/maps/stock.ipl\n';

      expect(mergeGtaDat(base, { ide: [], ipl: ['DATA\\MAPS\\stock.ipl'] })).toBe(base);
    });
  });

  describe('positive cases', () => {
    it('appends the new IDE/IPL lines (verbatim) after the stock ones', () => {
      const out = mergeGtaDat('IDE data/maps/stock.ide\n', {
        ide: ['data/maps/lodtrees.ide', 'data/maps/lodtrees_hd.ide'],
        ipl: ['data/maps/lod_procobj.ipl'],
      });

      expect(out).toBe(
        'IDE data/maps/stock.ide\nIDE data/maps/lodtrees.ide\nIDE data/maps/lodtrees_hd.ide\nIPL data/maps/lod_procobj.ipl\n',
      );
    });

    it('dedups a ref repeated across loader files', () => {
      const out = mergeGtaDat('', { ide: ['x.ide', 'X.IDE'], ipl: [] });

      expect(out).toBe('IDE x.ide\n');
    });
  });
});
