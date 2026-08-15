import { buildVer2Buffer, VER2_MAX_ENTRY_BYTES } from '@opensa/renderware/archive/img-archive';
import { closeSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createImg, openImg, writeImgFile } from './img';

/** Two-entry VER2 archive bytes to open + edit. */
function sampleImg(): Uint8Array {
  return buildVer2Buffer([
    { data: Uint8Array.of(1, 2, 3, 4), name: 'alpha.dff' },
    { data: Uint8Array.of(5, 6, 7, 8), name: 'beta.dff' },
  ]);
}

describe('EditableImg', () => {
  describe('negative cases', () => {
    it('returns null / false for an absent entry', () => {
      const img = openImg(sampleImg());
      expect(img.get('missing.dff')).toBeNull();
      expect(img.has('missing.dff')).toBe(false);
      expect(img.delete('missing.dff')).toBe(false);
    });

    it('reports a deleted entry as gone', () => {
      const img = openImg(sampleImg());
      expect(img.delete('alpha.dff')).toBe(true);
      expect(img.has('alpha.dff')).toBe(false);
      expect(img.names()).toEqual(['beta.dff']);
    });
  });

  describe('positive cases', () => {
    // IMG entries are sector-padded (2048) by the VER2 writer, so reads carry trailing zeros — assert prefixes.
    it('reads original entries (case-insensitive)', () => {
      const img = openImg(sampleImg());
      expect([...(img.get('ALPHA.DFF') ?? []).slice(0, 4)]).toEqual([1, 2, 3, 4]);
      expect(img.names()).toEqual(['alpha.dff', 'beta.dff']);
    });

    it('round-trips add / replace / delete through a rebuild', () => {
      const img = openImg(sampleImg());
      img.set('alpha.dff', Uint8Array.of(9, 9)); // replace
      img.set('gamma.dff', Uint8Array.of(7)); // add
      img.delete('beta.dff'); // remove

      const rebuilt = openImg(img.build());
      expect(rebuilt.names()).toEqual(['alpha.dff', 'gamma.dff']);
      expect([...(rebuilt.get('alpha.dff') ?? []).slice(0, 2)]).toEqual([9, 9]);
      expect([...(rebuilt.get('gamma.dff') ?? []).slice(0, 1)]).toEqual([7]);
      expect(rebuilt.has('beta.dff')).toBe(false);
    });
  });
});

describe('EditableImg.setFile', () => {
  describe('negative cases', () => {
    it('refuses an oversized file on STAT, without reading it', () => {
      // `set` checks the ceiling against bytes it holds; staging deliberately holds none, so the same refusal
      // has to come off the file's size — otherwise the wrap lands mid-write, in the archive.
      const dir = mkdtempSync(join(tmpdir(), 'img-stage-'));
      const path = join(dir, 'huge.dff');
      const fd = openSync(path, 'w');
      ftruncateSync(fd, VER2_MAX_ENTRY_BYTES + 1); // sparse — costs no disk, no read
      closeSync(fd);

      expect(() => openImg(sampleImg()).setFile('huge.dff', path)).toThrow(/huge\.dff/);
      rmSync(dir, { force: true, recursive: true });
    });

    it('is undone by delete, like any other entry', () => {
      const dir = mkdtempSync(join(tmpdir(), 'img-stage-'));
      writeFileSync(join(dir, 'gamma.dff'), Uint8Array.of(7));
      const img = openImg(sampleImg());
      img.setFile('gamma.dff', join(dir, 'gamma.dff'));

      expect(img.delete('gamma.dff')).toBe(true);
      expect(img.get('gamma.dff')).toBeNull();
      rmSync(dir, { force: true, recursive: true });
    });
  });

  describe('positive cases', () => {
    it('adds and replaces exactly like set, and the last write of either kind wins', () => {
      const dir = mkdtempSync(join(tmpdir(), 'img-stage-'));
      writeFileSync(join(dir, 'alpha.dff'), Uint8Array.of(9, 9));
      writeFileSync(join(dir, 'gamma.dff'), Uint8Array.of(7));
      const img = openImg(sampleImg());
      img.setFile('alpha.dff', join(dir, 'alpha.dff')); // replace an original
      img.setFile('gamma.dff', join(dir, 'gamma.dff')); // add
      img.set('gamma.dff', Uint8Array.of(3)); // and back to bytes

      const rebuilt = openImg(img.build());
      expect(rebuilt.names()).toEqual(['alpha.dff', 'beta.dff', 'gamma.dff']);
      expect([...(rebuilt.get('alpha.dff') ?? []).slice(0, 2)]).toEqual([9, 9]);
      expect([...(rebuilt.get('gamma.dff') ?? []).slice(0, 1)]).toEqual([3]);
      rmSync(dir, { force: true, recursive: true });
    });
  });
});

describe('writeImgFile', () => {
  describe('negative cases', () => {
    it('throws on a VER2 name longer than 24 bytes', () => {
      const img = createImg();
      img.set('a-very-long-entry-name-way-past-24.dff', Uint8Array.of(1));
      expect(() => writeImgFile(img, join(tmpdir(), `img-${process.pid}-bad.img`))).toThrow(/name too long/);
    });
  });

  describe('positive cases', () => {
    it('streams bytes identical to build() — sector padding, directory and order included', () => {
      const img = openImg(sampleImg());
      img.set('alpha.dff', Uint8Array.of(9, 9)); // replace
      img.set('gamma.dff', new Uint8Array(2049).fill(7)); // add spanning two sectors
      img.delete('beta.dff');

      const path = join(tmpdir(), `img-${process.pid}-roundtrip.img`);
      writeImgFile(img, path);
      const streamed = new Uint8Array(readFileSync(path));
      rmSync(path);

      expect(streamed).toEqual(img.build());
    });

    // The 24-byte name field is NUL-terminated only when shorter — TCs ship full 24-byte names (Carcer City).
    it('round-trips a full 24-byte entry name', () => {
      const img = createImg();
      img.set('cj_padlockgate_l_(d).dff', Uint8Array.of(1, 2));

      const path = join(tmpdir(), `img-${process.pid}-24byte.img`);
      writeImgFile(img, path);
      const reopened = openImg(new Uint8Array(readFileSync(path)));
      rmSync(path);

      expect(reopened.names()).toEqual(['cj_padlockgate_l_(d).dff']);
      expect([...(reopened.get('cj_padlockgate_l_(d).dff') ?? []).slice(0, 2)]).toEqual([1, 2]);
    });
  });
});
