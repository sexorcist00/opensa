import { describe, expect, it } from 'vitest';

import { applyIdeMerge, parseMergeFile } from './ide-merge';

const TARGET = ['objs', '1682, ap_radar1_01, ap_misc1bit, 100, 2097152', '1683, other, tex, 100, 0', 'end', ''].join(
  '\n',
);

describe('parseMergeFile', () => {
  describe('negative cases', () => {
    it('throws on an entry outside any directive', () => {
      expect(() => parseMergeFile('1682, ap_radar1_01, ap_misc1bit, 100, 2097152')).toThrow(/outside any directive/);
    });

    it('throws on a malformed directive header (typo guard)', () => {
      expect(() => parseMergeFile('add too "anim":\n1, a, b, 0')).toThrow(/malformed merge directive/);
    });

    it('throws on an entry without a numeric ID', () => {
      expect(() => parseMergeFile('add to "anim":\nap_radar1_01, no, id')).toThrow(/no numeric ID/);
    });
  });

  describe('positive cases', () => {
    it('parses remove/add directives with comments and blank lines', () => {
      const directives = parseMergeFile(
        [
          '# radar becomes an anim object',
          'remove from "objs":',
          '1682, ap_radar1_01, ap_misc1bit, 100, 2097152 # documentation line',
          '',
          'add to "anim":',
          '1682, ap_radar1_01, ap_misc1bit, radar, 600, 0',
        ].join('\n'),
      );
      expect(directives).toHaveLength(2);
      expect(directives[0]).toMatchObject({ action: 'remove', section: 'objs' });
      expect(directives[0].entries).toHaveLength(1);
      expect(directives[1]).toMatchObject({ action: 'add', section: 'anim' });
    });
  });
});

describe('applyIdeMerge', () => {
  describe('negative cases', () => {
    it('warns when removing from a section the target does not have', () => {
      const { text, warnings } = applyIdeMerge(TARGET, parseMergeFile('remove from "tobj":\n1682, a, b, 0, 0, 0, 0'));
      expect(warnings).toHaveLength(1);
      expect(text).toBe(TARGET); // untouched
    });

    it('warns (not throws) when a remove ID is absent, and applies the rest', () => {
      const directives = parseMergeFile(
        'remove from "objs":\n9999, ghost, tex, 100, 0\nadd to "anim":\n1, a, b, c, 0, 0',
      );
      const { text, warnings } = applyIdeMerge(TARGET, directives);
      expect(warnings).toEqual(['remove from "objs": id 9999 not found — skipped']);
      expect(text).toContain('anim\n1, a, b, c, 0, 0\nend');
    });
  });

  describe('positive cases', () => {
    it('moves an entry between sections (the radar case), leaving other lines verbatim', () => {
      const directives = parseMergeFile(
        'remove from "objs":\n1682, ap_radar1_01, ap_misc1bit, 100, 2097152\nadd to "anim":\n1682, ap_radar1_01, ap_misc1bit, radar, 600, 0',
      );
      const { text, warnings } = applyIdeMerge(TARGET, directives);
      expect(warnings).toEqual([]);
      expect(text).not.toMatch(/objs\n1682/); // removed from objs
      expect(text).toContain('1683, other, tex, 100, 0'); // untouched neighbour kept verbatim
      expect(text).toContain('anim\n1682, ap_radar1_01, ap_misc1bit, radar, 600, 0\nend'); // section created
    });

    it('replaces a same-ID entry when adding into a section that already has it (mod stacking)', () => {
      const first = applyIdeMerge(TARGET, parseMergeFile('add to "anim":\n1682, a, b, clip1, 100, 0')).text;
      const second = applyIdeMerge(first, parseMergeFile('add to "anim":\n1682, a, b, clip2, 600, 0')).text;
      expect(second).toContain('clip2');
      expect(second).not.toContain('clip1');
    });

    it('preserves the target CRLF line endings', () => {
      const crlf = TARGET.replace(/\n/g, '\r\n');
      const { text } = applyIdeMerge(crlf, parseMergeFile('add to "anim":\n1, a, b, c, 0, 0'));
      expect(text).toContain('\r\n');
      expect(text).toContain('anim\r\n1, a, b, c, 0, 0\r\nend');
    });

    it('removes by ID even when the target line was reformatted by another tool (float noise)', () => {
      const reformatted = TARGET.replace(
        '1682, ap_radar1_01, ap_misc1bit, 100, 2097152',
        '1682 ,ap_radar1_01 ,ap_misc1bit ,100 ,2097152',
      );
      const { text } = applyIdeMerge(
        reformatted,
        parseMergeFile('remove from "objs":\n1682, ap_radar1_01, ap_misc1bit, 100, 2097152'),
      );
      expect(text).not.toContain('1682');
    });
  });
});
