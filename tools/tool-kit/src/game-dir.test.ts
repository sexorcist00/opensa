import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { copyGameDir, guardOut } from './game-dir';

describe('guardOut', () => {
  describe('negative cases', () => {
    it('refuses the filesystem root', () => {
      expect(() => guardOut(sep, `${sep}game`)).toThrow(/filesystem root/);
    });

    it('refuses an --out equal to a source dir', () => {
      expect(() => guardOut(`${sep}a${sep}game`, `${sep}a${sep}game`)).toThrow(/must differ/);
    });

    it('refuses an --out that contains a source dir', () => {
      expect(() => guardOut(`${sep}a`, `${sep}a${sep}game`)).toThrow(/must not contain/);
    });

    it('checks every source, not just the first', () => {
      expect(() => guardOut(`${sep}a${sep}wind`, `${sep}a${sep}game`, `${sep}a${sep}wind`)).toThrow(/must differ/);
    });

    it('refuses a source that differs only in case — one folder on Windows and macOS', () => {
      expect(() => guardOut(`${sep}a${sep}GTA San Andreas`, `${sep}a${sep}gta san andreas`)).toThrow(/must differ/);
    });

    it('refuses a contained source that differs only in case', () => {
      expect(() => guardOut(`${sep}A`, `${sep}a${sep}game`)).toThrow(/must not contain/);
    });
  });

  describe('positive cases', () => {
    it('accepts a sibling --out', () => {
      expect(() => guardOut(`${sep}a${sep}out`, `${sep}a${sep}game`)).not.toThrow();
    });

    it('accepts an --out with no sources at all', () => {
      expect(() => guardOut(`${sep}a${sep}out`)).not.toThrow();
    });
  });
});

describe('copyGameDir', () => {
  describe('positive cases', () => {
    it('mirrors the tree and replaces whatever --out held before', () => {
      const root = mkdtempSync(join(tmpdir(), 'game-dir-'));
      const game = join(root, 'game');
      const out = join(root, 'out');
      mkdirSync(join(game, 'data'), { recursive: true });
      writeFileSync(join(game, 'data', 'gta.dat'), 'IDE data/maps/x.ide');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'stale.txt'), 'from a previous run');

      copyGameDir(game, out);

      expect(readFileSync(join(out, 'data', 'gta.dat'), 'utf8')).toBe('IDE data/maps/x.ide');
      expect(existsSync(join(out, 'stale.txt'))).toBe(false);
    });
  });
});
