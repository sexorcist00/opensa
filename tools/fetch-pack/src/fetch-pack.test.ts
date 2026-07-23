import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fetchPack, groupOf, sliceEntries } from './fetch-pack';

const noop = (): void => undefined;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fetch-pack-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('fetchPack', () => {
  describe('negative cases', () => {
    it('throws when the build has no opensa/ target', () => {
      expect(() => fetchPack({ buildDir: dir, log: noop })).toThrow(/no opensa\/ target/);
    });
  });

  describe('positive cases', () => {
    it('slices oversized entries into #index parts that reassemble to the original', () => {
      const bytes = new Uint8Array(10).map((_, i) => i);
      const sliced = sliceEntries([{ bytes, name: 'opensa/world.ospak' }], 4);

      expect(sliced.map((s) => s.name)).toEqual([
        'opensa/world.ospak#0',
        'opensa/world.ospak#1',
        'opensa/world.ospak#2',
      ]);
      expect([...sliced[0].bytes, ...sliced[1].bytes, ...sliced[2].bytes]).toEqual([...bytes]);
      // At or under the target: untouched.
      expect(sliceEntries([{ bytes, name: 'small' }], 10)).toEqual([{ bytes, name: 'small' }]);
    });

    it('maps game-dir paths onto the loader group vocabulary', () => {
      expect(groupOf('data/vehicles.ide')).toBe('data');
      expect(groupOf('text/american.gxt')).toBe('data');
      expect(groupOf('stream.ini')).toBe('data');
      expect(groupOf('models/gta3.img')).toBe('models');
      expect(groupOf('opensa/world.ospak')).toBe('models');
      expect(groupOf('anim/anim.img')).toBe('others');
    });

    it('packs a build into chunks + a manifest keyed by the pak identity', () => {
      const game = join(dir, 'build', 'opensa');
      mkdirSync(join(game, 'opensa'), { recursive: true });
      mkdirSync(join(game, 'data'), { recursive: true });
      writeFileSync(join(game, 'opensa', 'world.ospak'), new Uint8Array(64).fill(7));
      writeFileSync(join(game, 'opensa', 'manifest.json'), JSON.stringify({ appVersion: '9.9.9', game: 'testgame' }));
      writeFileSync(join(game, 'data', 'vehicles.ide'), 'cars\nend\n');
      writeFileSync(join(game, 'stream.ini'), 'memory 512\n');

      const result = fetchPack({ buildDir: join(dir, 'build'), log: noop, outRoot: join(dir, 'out') });

      expect(result.game).toBe('testgame');
      expect(result.version).toBe('9.9.9');
      expect(result.outDir.endsWith('testgame-9.9.9')).toBe(true);
      const manifest = JSON.parse(readFileSync(join(result.outDir, 'manifest.json'), 'utf8')) as {
        chunks: Record<string, { bytes: number; file: string }[]>;
        game: string;
      };
      expect(manifest.game).toBe('testgame');
      expect(Object.keys(manifest.chunks).sort()).toEqual(['data', 'models', 'others', 'textures']);
      expect(manifest.chunks.textures).toEqual([]); // pak textures live inside world.ospak
      expect(manifest.chunks.models.length).toBeGreaterThan(0);
      for (const info of manifest.chunks.models) {
        expect(readFileSync(join(result.outDir, info.file)).length).toBe(info.bytes);
      }
    });
  });
});
