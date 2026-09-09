import { describe, expect, it } from 'vitest';

import { parseAudioEvents } from './audio-events.parser';

describe('parseAudioEvents', () => {
  describe('negative cases', () => {
    it('DROPS a row it cannot read and names the line, rather than guessing at it', () => {
      // A sound played at a NaN gain is a silence nobody can explain, and a table that swallowed the row
      // would make the mod author's typo look like our bug.
      const { problems, rows } = parseAudioEvents(['GOOD, 1, 2', 'BAD_GAIN, 1, 2, wobbly', 'SHORT, 4'].join('\n'));

      expect(rows.map((row) => row.name)).toEqual(['GOOD']);
      expect(problems).toEqual([
        { line: 2, reason: "gain 'wobbly' is not a number between 0 and 1", text: 'BAD_GAIN, 1, 2, wobbly' },
        {
          line: 3,
          reason: 'a row needs at least a name, a bank and a sound — this one has 2 field(s)',
          text: 'SHORT, 4',
        },
      ]);
    });

    it('refuses a bank or a sound that is not a whole non-negative number', () => {
      const { problems, rows } = parseAudioEvents(['A, -1, 0', 'B, 1.5, 0', 'C, 1, -2', 'D, x, 0'].join('\n'));

      expect(rows).toEqual([]);
      expect(problems).toHaveLength(4);
      expect(problems[0]?.reason).toMatch(/non-negative whole numbers/u);
    });

    it('refuses anything but `loop` or `once` in the loop column', () => {
      const { problems } = parseAudioEvents('A, 1, 0, 1, sometimes');

      expect(problems[0]?.reason).toMatch(/neither 'loop' nor 'once'/u);
    });

    it('NAMES a duplicate rather than letting two rows for one name go unnoticed', () => {
      // Later wins, the way a later mod layer wins — but a sound nobody can predict is worse than a refusal.
      const { problems, rows } = parseAudioEvents(['HORN, 1, 0, 0.5', 'HORN, 9, 9, 1'].join('\n'));

      expect(rows).toEqual([{ bank: 9, gain: 1, loop: false, maxDistance: null, name: 'HORN', sound: 9 }]);
      expect(problems[0]?.reason).toMatch(/defined more than once/u);
    });

    it('is an empty table for an empty file, and for a file of nothing but comments', () => {
      expect(parseAudioEvents('')).toEqual({ problems: [], rows: [] });
      expect(parseAudioEvents('# nothing here\n\n   \n')).toEqual({ problems: [], rows: [] });
    });
  });

  describe('positive cases', () => {
    it('reads the three required columns and defaults the rest', () => {
      const { rows } = parseAudioEvents('VEH_HORN_1, 12, 3');

      expect(rows).toEqual([{ bank: 12, gain: 1, loop: false, maxDistance: null, name: 'VEH_HORN_1', sound: 3 }]);
    });

    it('reads the optional gain, loop and distance', () => {
      const { rows } = parseAudioEvents('AMB_CITY_DAY, 40, 2, 0.6, loop, 400');

      expect(rows[0]).toEqual({
        bank: 40,
        gain: 0.6,
        loop: true,
        maxDistance: 400,
        name: 'AMB_CITY_DAY',
        sound: 2,
      });
    });

    it('upper-cases the name, so the table is case-insensitive to WRITE and exact to read', () => {
      expect(parseAudioEvents('foot_gravel, 1, 0').rows[0]?.name).toBe('FOOT_GRAVEL');
    });

    it('takes commas and whitespace as one separator class, the way the game reads its own rows', () => {
      const spaced = parseAudioEvents('VEH_HORN_1 12 3').rows;
      const tabbed = parseAudioEvents('VEH_HORN_1\t12,\t3').rows;

      expect(spaced).toEqual(tabbed);
      expect(spaced[0]?.bank).toBe(12);
    });

    it('clamps a gain above 1 rather than letting a row shout over every other', () => {
      expect(parseAudioEvents('LOUD, 1, 0, 4').rows[0]?.gain).toBe(1);
    });

    it('ignores comments and blank lines wherever they are', () => {
      const { rows } = parseAudioEvents(['# header', '', 'A, 1, 0', '   # indented comment', 'B, 2, 0'].join('\n'));

      expect(rows.map((row) => row.name)).toEqual(['A', 'B']);
    });
  });
});
