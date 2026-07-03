import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { guardOut, sortMods } from './install';

describe('guardOut', () => {
  describe('negative cases', () => {
    it('refuses the filesystem root as --out', () => {
      const root = `${sep}`;

      expect(() => guardOut(root, `${sep}game`, `${sep}mods`)).toThrow(/filesystem root/);
    });

    it('refuses --out equal to --game or --in', () => {
      expect(() => guardOut(`${sep}a${sep}game`, `${sep}a${sep}game`, `${sep}a${sep}mods`)).toThrow(/must differ/);
      expect(() => guardOut(`${sep}a${sep}mods`, `${sep}a${sep}game`, `${sep}a${sep}mods`)).toThrow(/must differ/);
    });

    it('refuses --out that contains --game / --in (would wipe them)', () => {
      expect(() => guardOut(`${sep}a`, `${sep}a${sep}game`, `${sep}b${sep}mods`)).toThrow(/must not contain/);
    });
  });

  describe('positive cases', () => {
    it('allows a distinct --out', () => {
      expect(() => guardOut(`${sep}a${sep}out`, `${sep}a${sep}game`, `${sep}a${sep}mods`)).not.toThrow();
    });
  });
});

describe('sortMods', () => {
  describe('positive cases', () => {
    it('sorts numeric-aware: the number prefix is the apply priority (mod1, mod2, mod10)', () => {
      expect(sortMods(['mod2', 'mod10', 'mod1'])).toEqual(['mod1', 'mod2', 'mod10']);
      expect(sortMods(['10. b', '2. a', '1. c'])).toEqual(['1. c', '2. a', '10. b']);
    });

    it('is case-insensitive ascending', () => {
      expect(sortMods(['B_mod', 'a_mod', 'C_mod'])).toEqual(['a_mod', 'B_mod', 'C_mod']);
    });

    it('does not mutate the input', () => {
      const input = ['b', 'a'];
      sortMods(input);

      expect(input).toEqual(['b', 'a']);
    });
  });
});
