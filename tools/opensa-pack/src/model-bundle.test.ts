import { OsmSectionTag } from '@opensa/engine-formats';
import { describe, expect, it } from 'vitest';

import { createModelBundles } from './model-bundle';

const section = (tag: number, byte = 1): { bytes: Uint8Array; tag: number } => ({ bytes: Uint8Array.of(byte), tag });

describe('createModelBundles', () => {
  describe('negative cases', () => {
    it('REFUSES two classes writing the same section for one model', () => {
      // Silently keeping either one is how a model ends up with the wrong geometry — the whole point of
      // the accumulator is that this is loud.
      const bundles = createModelBundles();
      bundles.add('rockbrkq', { sections: [section(OsmSectionTag.GEOM)] });

      expect(() => bundles.add('rockbrkq', { sections: [section(OsmSectionTag.GEOM, 2)] })).toThrow(/duplicate/);
    });

    it('emits nothing for a model nobody contributed to', () => {
      expect(createModelBundles().inserts()).toEqual([]);
    });

    it('reports a section it does not hold', () => {
      const bundles = createModelBundles();
      bundles.add('crate', { sections: [section(OsmSectionTag.SHAT)] });

      expect(bundles.hasSection('crate', OsmSectionTag.GEOM)).toBe(false);
      expect(bundles.hasSection('nosuchmodel', OsmSectionTag.SHAT)).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('MERGES the classes a model belongs to into ONE .osm', () => {
      // The real case: a cactus is a clutter species AND a breakable AND a topple prop.
      const bundles = createModelBundles();
      bundles.add('sjmcacti2', { sections: [section(OsmSectionTag.DESC), section(OsmSectionTag.GEOM)] });
      bundles.add('sjmcacti2', { sections: [section(OsmSectionTag.SHAT)] });
      bundles.add('sjmcacti2', { sections: [section(OsmSectionTag.HULL)] });

      const inserts = bundles.inserts();

      expect(bundles.size()).toBe(1);
      expect(inserts).toHaveLength(1); // ONE file, not three
      expect(inserts[0].name).toBe('sjmcacti2.osm');
      expect(inserts[0].near).toBe('sjmcacti2.dff'); // lands in the archive that held the original
    });

    it('answers hasSection so a later class contributes only what it adds', () => {
      const bundles = createModelBundles();
      bundles.add('lamppost1', { sections: [section(OsmSectionTag.GEOM)] });

      expect(bundles.hasSection('lamppost1', OsmSectionTag.GEOM)).toBe(true);
      expect(() => bundles.add('lamppost1', { sections: [section(OsmSectionTag.HULL)] })).not.toThrow();
    });

    it('is case-insensitive on the model name', () => {
      const bundles = createModelBundles();
      bundles.add('Lamppost1', { sections: [section(OsmSectionTag.GEOM)] });

      expect(bundles.hasSection('lamppost1', OsmSectionTag.GEOM)).toBe(true);
      expect(bundles.inserts()[0].name).toBe('lamppost1.osm');
    });

    it('keeps models apart', () => {
      const bundles = createModelBundles();
      bundles.add('a', { sections: [section(OsmSectionTag.GEOM)] });
      bundles.add('b', { sections: [section(OsmSectionTag.SHAT)] });

      expect(bundles.size()).toBe(2);
      expect(
        bundles
          .inserts()
          .map((entry) => entry.name)
          .sort(),
      ).toEqual(['a.osm', 'b.osm']);
    });
  });
});
