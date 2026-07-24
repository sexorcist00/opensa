import { createImg, openImg, writeImgFile } from '@opensa/tool-kit/archive/img';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { rewriteModelArchives } from './archive-edit';

function entriesOf(root: string, file: string): string[] {
  return openImg(new Uint8Array(readFileSync(join(root, 'models', file)))).names();
}

/** A game-dir stub with `models/<file>.img` archives holding the given entries. */
function gameDir(archives: Record<string, Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'archive-edit-'));
  mkdirSync(join(root, 'models'));
  for (const [file, entries] of Object.entries(archives)) {
    const img = createImg();
    for (const [name, text] of Object.entries(entries)) {
      img.set(name, new TextEncoder().encode(text));
    }
    writeImgFile(img, join(root, 'models', file));
  }

  return root;
}

describe('rewriteModelArchives', () => {
  describe('negative cases', () => {
    it('does not write an insert whose `near` no archive holds', () => {
      const root = gameDir({ 'gta3.img': { 'landstal.dff': 'model' } });

      const report = rewriteModelArchives(root, {
        deletes: [],
        inserts: [{ bytes: new Uint8Array([1]), name: 'ghost.osm', near: 'ghost.dff' }],
      });

      expect(report.unplaced).toEqual(['ghost.osm']);
      expect(entriesOf(root, 'gta3.img')).toEqual(['landstal.dff']);
    });

    it('reports a delete no archive holds instead of failing', () => {
      const root = gameDir({ 'gta3.img': { 'landstal.dff': 'model' } });

      const report = rewriteModelArchives(root, { deletes: ['absent.txd'], inserts: [] });

      expect(report.missingDeletes).toEqual(['absent.txd']);
      expect(report.archives).toEqual([]);
    });

    it('leaves an archive with nothing to change untouched', () => {
      const root = gameDir({ 'gta3.img': { 'landstal.dff': 'model' }, 'gta_int.img': { 'chair.dff': 'prop' } });

      const report = rewriteModelArchives(root, {
        deletes: ['landstal.dff'],
        inserts: [{ bytes: new Uint8Array([1]), name: 'landstal.osm', near: 'landstal.dff' }],
      });

      expect(report.archives.map((archive) => archive.file)).toEqual(['gta3.img']);
      expect(entriesOf(root, 'gta_int.img')).toEqual(['chair.dff']);
    });
  });

  describe('positive cases', () => {
    it('replaces an entry with its optimized form in the same archive', () => {
      const root = gameDir({ 'gta3.img': { 'landstal.dff': 'model', 'landstal.txd': 'textures' } });

      const report = rewriteModelArchives(root, {
        deletes: ['landstal.dff', 'landstal.txd'],
        inserts: [
          { bytes: new TextEncoder().encode('osm'), name: 'landstal.osm', near: 'landstal.dff' },
          { bytes: new TextEncoder().encode('ostex'), name: 'landstal.ostex', near: 'landstal.dff' },
        ],
      });

      expect(entriesOf(root, 'gta3.img').sort()).toEqual(['landstal.osm', 'landstal.ostex']);
      expect(report.archives).toHaveLength(1);
      expect(report.archives[0].deleted).toBe(2);
      expect(report.archives[0].inserted).toBe(2);
      expect(report.archives[0].file).toBe('gta3.img');
      expect(report.unplaced).toEqual([]);
    });

    it('places each insert in the archive that held its origin', () => {
      const root = gameDir({ 'gta3.img': { 'landstal.dff': 'model' }, 'gta_int.img': { 'chair.dff': 'prop' } });

      rewriteModelArchives(root, {
        deletes: ['landstal.dff', 'chair.dff'],
        inserts: [
          { bytes: new Uint8Array([1]), name: 'landstal.osm', near: 'landstal.dff' },
          { bytes: new Uint8Array([2]), name: 'chair.osm', near: 'chair.dff' },
        ],
      });

      expect(entriesOf(root, 'gta3.img')).toEqual(['landstal.osm']);
      expect(entriesOf(root, 'gta_int.img')).toEqual(['chair.osm']);
    });

    it('keeps the bytes it inserted readable after the rebuild', () => {
      const root = gameDir({ 'gta3.img': { 'landstal.dff': 'model' } });

      rewriteModelArchives(root, {
        deletes: ['landstal.dff'],
        inserts: [{ bytes: new TextEncoder().encode('OSM1payload'), name: 'landstal.osm', near: 'landstal.dff' }],
      });

      const img = openImg(new Uint8Array(readFileSync(join(root, 'models', 'gta3.img'))));
      expect(new TextDecoder().decode(img.get('landstal.osm')?.subarray(0, 11))).toBe('OSM1payload');
    });
  });
});
