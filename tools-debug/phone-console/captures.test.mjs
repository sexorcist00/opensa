import { describe, expect, it } from 'vitest';

import { capturePath, checkTilesArchive, commitPlan, pakFacts, slugify, withNote } from './captures.mjs';

const FACTS = { commit: 'abc1234', device: 'Pixel', node: 'v22.0.0', pak: 'original rect 8,-8,11,-5' };

describe('phone console captures', () => {
  describe('negative cases', () => {
    it('refuses a capture with no name — the file name IS the name', () => {
      expect(() => capturePath('2026-08-23', '   ')).toThrow(/needs a name/);
    });

    it('refuses a capture whose note says nothing', () => {
      // The benchmark record's first rule: a row nobody can place is a row nobody can compare.
      expect(() => withNote({ runs: [] }, 'ok', FACTS)).toThrow(/at least 12 characters/);
    });

    it('refuses a file that is not a PMTiles archive', () => {
      // Silent by nature: an HTML error page saved under the right name makes the flat map draw nothing,
      // which looks exactly like a map that has not loaded.
      const html = new Uint8Array(Buffer.from('<!doctype html><title>404'));

      expect(() => checkTilesArchive(html)).toThrow(/not a PMTiles archive/);
    });

    it('refuses to commit anything but a capture', () => {
      expect(() => commitPlan(['apps/dispatch/src/world/boot.ts'], 'sneak')).toThrow(/files data, never code/);
    });

    it('refuses an empty commit', () => {
      expect(() => commitPlan([], 'nothing')).toThrow(/nothing to commit/);
    });
  });

  describe('positive cases', () => {
    it('names the file the way the family does', () => {
      expect(capturePath('2026-08-23', 'Mobile pinned district — inventory')).toBe(
        'docs/benchmarks/opensa-engine/2026-08-23-mobile-pinned-district-inventory.json',
      );
    });

    it('slugifies a phone-typed name', () => {
      expect(slugify('  ASTC vs RGBA8 (LS) ')).toBe('astc-vs-rgba8-ls');
    });

    it('stamps the conditions it can prove onto the note the operator wrote', () => {
      const stamped = withNote({ frames: 400 }, 'the ASTC side of the format A/B', FACTS);

      expect(stamped.frames).toBe(400);
      expect(stamped.note).toBe(
        'the ASTC side of the format A/B — Pixel · node v22.0.0 · pak original rect 8,-8,11,-5 · commit abc1234 · captured through tools-debug/phone-console',
      );
    });

    it('reads the pak own recipe, and says so when there is none', () => {
      expect(
        pakFacts({
          build: {
            at: '2026-08-23T10:00:00Z',
            commit: 'deadbee',
            game: 'original',
            rect: [8, -8, 11, -5],
            textures: 'astc',
          },
        }),
      ).toEqual({
        commit: 'deadbee',
        pak: 'original rect 8,-8,11,-5 textures astc built 2026-08-23T10:00:00Z',
      });
      expect(pakFacts(null)).toEqual({ commit: null, pak: null });
    });

    it('accepts a real archive header', () => {
      const archive = new Uint8Array(Buffer.from('PMTilesrest of it'));

      expect(checkTilesArchive(archive)).toEqual({ bytes: archive.byteLength });
    });

    it('names the paths on the commit itself, so a dirty tree cannot ride along', () => {
      const plan = commitPlan(['docs/benchmarks/opensa-engine/2026-08-23-a.json'], 'the pinned district on ASTC');

      expect(plan.env).toEqual({ HUSKY: '0' });
      expect(plan.steps[0]).toEqual(['git', ['add', '--', 'docs/benchmarks/opensa-engine/2026-08-23-a.json']]);
      expect(plan.steps[1]).toEqual([
        'git',
        [
          'commit',
          '-m',
          'chore(bench): the pinned district on ASTC',
          '--',
          'docs/benchmarks/opensa-engine/2026-08-23-a.json',
        ],
      ]);
    });
  });
});
