import type { OsaudioIndex, OsaudioSound } from '@opensa/engine-formats';

import { describe, expect, it } from 'vitest';

import { BED_SECONDS, bedTable, mergeBedTable, pickBedLayers } from './audio-bed';

/**
 * An index of banks, each `[package, ...sounds]`.
 *
 * Written as a builder because every case here is "the same banks, one thing different", and a fixture
 * copied five times is a fixture where nobody can see which difference the test is about.
 */
function indexOf(banks: readonly (readonly [string, ...OsaudioSound[]])[]): OsaudioIndex {
  const packages = [...new Set(banks.map(([name]) => name))];
  const sounds: OsaudioSound[] = [];

  return {
    banks: banks.map(([name, ...own]) => {
      const firstSound = sounds.length;
      sounds.push(...own);

      return {
        firstSound,
        headerOffset: 0,
        packageIndex: packages.indexOf(name),
        sizeBytes: 0,
        soundCount: own.length,
      };
    }),
    packages,
    sounds,
    zones: [],
  };
}

/** One sound, with only the fields the pick reads set to anything meaningful. */
function sound(seconds: number, loops: boolean): OsaudioSound {
  return {
    byteLength: Math.round(seconds * 12_000) * 2,
    byteOffset: 0,
    durationSeconds: seconds,
    headroom: 0,
    loopOffset: loops ? 0 : -1,
    sampleRate: 12_000,
  };
}

describe('pickBedLayers', () => {
  describe('negative cases', () => {
    it('picks nothing from a build whose only loops are outside GENRL', () => {
      const index = indexOf([['SCRIPT', sound(5, true), sound(4, true)]]);

      expect(pickBedLayers(index, 3)).toEqual([]);
    });

    it('refuses a loop shorter than the floor — that is a click, not a bed', () => {
      const index = indexOf([['GENRL', sound(BED_SECONDS - 0.01, true)]]);

      expect(pickBedLayers(index, 3)).toEqual([]);
    });

    it('refuses a long sound that does not loop', () => {
      const index = indexOf([['GENRL', sound(5, false)]]);

      expect(pickBedLayers(index, 3)).toEqual([]);
    });

    it('never takes two layers from ONE bank, however long its other loops are', () => {
      const index = indexOf([
        ['GENRL', sound(5, true), sound(4.9, true), sound(4.8, true)],
        ['GENRL', sound(1.5, true)],
      ]);

      const picked = pickBedLayers(index, 3);

      expect(picked).toHaveLength(2);
      expect(picked.map((layer) => layer.bank)).toEqual([0, 1]);
    });

    it('gives back fewer layers than asked for rather than padding', () => {
      const index = indexOf([['GENRL', sound(5, true)]]);

      expect(pickBedLayers(index, 3)).toHaveLength(1);
    });
  });

  describe('positive cases', () => {
    it('takes the longest GENRL loop of each bank, longest first', () => {
      const index = indexOf([
        ['GENRL', sound(2, true)],
        ['SCRIPT', sound(9, true)],
        ['GENRL', sound(5, true), sound(1.2, true)],
        ['GENRL', sound(3, true)],
      ]);

      expect(pickBedLayers(index, 3)).toEqual([
        { bank: 2, seconds: 5, slot: 0 },
        { bank: 3, seconds: 3, slot: 0 },
        { bank: 0, seconds: 2, slot: 0 },
      ]);
    });

    it('breaks a tie the same way every time, so the same tree drafts the same bed', () => {
      const index = indexOf([
        ['GENRL', sound(4, true)],
        ['GENRL', sound(4, true)],
      ]);

      expect(pickBedLayers(index, 2).map((layer) => layer.bank)).toEqual([0, 1]);
    });

    it('names the SLOT within its bank, not the flat sound index', () => {
      const index = indexOf([
        ['GENRL', sound(1.1, true), sound(1.1, true)],
        ['GENRL', sound(5, true), sound(4, true)],
      ]);

      expect(pickBedLayers(index, 1)).toEqual([{ bank: 1, seconds: 5, slot: 0 }]);
    });
  });
});

describe('bedTable', () => {
  describe('negative cases', () => {
    it('reuses the last gain when there are more layers than gains', () => {
      const text = bedTable(
        [
          { bank: 1, seconds: 2, slot: 0 },
          { bank: 2, seconds: 2, slot: 1 },
        ],
        [0.5],
      );

      expect(text).toContain('AMB_DEFAULT_2, 2, 1, 0.5, loop');
    });
  });

  describe('positive cases', () => {
    it('writes the first layer unsuffixed and the rest numbered from 2', () => {
      const text = bedTable(
        [
          { bank: 82, seconds: 4.97, slot: 0 },
          { bank: 84, seconds: 4.2, slot: 3 },
        ],
        [0.5, 0.3],
      );

      expect(text).toContain('AMB_DEFAULT, 82, 0, 0.5, loop');
      expect(text).toContain('AMB_DEFAULT_2, 84, 3, 0.3, loop');
      expect(text.split('\n')[0]).toMatch(/^#/u);
    });
  });
});

describe('mergeBedTable', () => {
  describe('negative cases', () => {
    it('never takes an authored row with it — the sirens live in the same file', () => {
      const existing = [
        '# an ear settled these',
        'VEH_SIREN_PATROL, 40, 2, 0.9, loop',
        'AMB_DEFAULT, 1, 0, 0.5, loop',
      ].join('\n');
      const drafted = bedTable([{ bank: 82, seconds: 4, slot: 0 }], [0.5]);

      const merged = mergeBedTable(existing, drafted);

      expect(merged).toContain('VEH_SIREN_PATROL, 40, 2, 0.9, loop');
      expect(merged).toContain('# an ear settled these');
      // The old bed row is gone, replaced rather than doubled.
      expect(merged).not.toContain('AMB_DEFAULT, 1, 0,');
      expect(merged).toContain('AMB_DEFAULT, 82, 0, 0.5, loop');
    });

    it('replaces every numbered layer of the old bed, not only the first', () => {
      const existing = [
        'AMB_DEFAULT, 1, 0, 0.5, loop',
        'AMB_DEFAULT_2, 2, 0, 0.3, loop',
        'AMB_DEFAULT_3, 3, 0, 0.2, loop',
      ].join('\n');

      const merged = mergeBedTable(existing, bedTable([{ bank: 82, seconds: 4, slot: 0 }], [0.5]));

      expect(merged).not.toContain('AMB_DEFAULT_2');
      expect(merged).not.toContain('AMB_DEFAULT_3');
    });

    it("leaves a zone bed alone — only the DEFAULT one is the draft's to replace", () => {
      const merged = mergeBedTable(
        'AMB_LS_BEACH, 9, 0, 0.4, loop',
        bedTable([{ bank: 82, seconds: 4, slot: 0 }], [0.5]),
      );

      expect(merged).toContain('AMB_LS_BEACH, 9, 0, 0.4, loop');
    });
  });

  describe('positive cases', () => {
    it('is the draft itself when there was no table', () => {
      const drafted = bedTable([{ bank: 82, seconds: 4, slot: 0 }], [0.5]);

      expect(mergeBedTable('', drafted)).toBe(drafted);
    });

    it('is idempotent — merging the same draft twice writes the same rows', () => {
      const drafted = bedTable([{ bank: 82, seconds: 4, slot: 0 }], [0.5]);
      const once = mergeBedTable('VEH_SIREN_FIRE, 1, 1, 1, loop', drafted);

      expect(mergeBedTable(once, drafted)).toBe(once);
    });
  });
});
