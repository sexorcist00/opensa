import { describe, expect, it } from 'vitest';

import { buildLinkedAreas, type LinkedPair, splitByMedian } from './streamed-areas';

const pairAt = (x: number, y = 0): LinkedPair => ({
  hd: { id: 800, interior: 3, position: [x, y, 0], rotation: [0, 0, 0, 1] },
  lod: { id: 6500, model: 'plobush' },
});

describe('splitByMedian', () => {
  describe('negative cases', () => {
    it('returns one leaf when the items already fit', () => {
      expect(splitByMedian([pairAt(0), pairAt(1)], 5, (p) => p.hd.position)).toHaveLength(1);
    });
  });

  describe('positive cases', () => {
    it('packs into exactly ⌈N/max⌉ near-equal leaves instead of halving to powers of two', () => {
      const items = Array.from({ length: 15283 }, (_, i) => pairAt(i % 400, Math.floor(i / 400)));
      const leaves = splitByMedian(items, 2000, (p) => p.hd.position);

      expect(leaves).toHaveLength(8); // halving would give 16 leaves of ~955 — a waste of text-IPL slots
      for (const leaf of leaves) {
        expect(leaf.length).toBeLessThanOrEqual(2000);
        expect(leaf.length).toBeGreaterThanOrEqual(1900); // near-equal packing
      }
      expect(leaves.reduce((n, leaf) => n + leaf.length, 0)).toBe(15283);
    });
  });
});

describe('buildLinkedAreas', () => {
  describe('negative cases', () => {
    it('throws when the areaBase makes a stream name exceed the IMG VER2 23-byte cap', () => {
      expect(() => buildLinkedAreas([pairAt(0)], 'a-far-too-long-base')).toThrow(/23 bytes/);
    });
  });

  describe('positive cases', () => {
    it('propagates the HD interior into the LOD text row', () => {
      const { files } = buildLinkedAreas([pairAt(0)], 'plotr');
      const row = files[0][1].split('\r\n').find((l) => l.startsWith('6500'));

      expect(row).toBe('6500, plobush, 3, 0, 0, 0, 0, 0, 0, 1, -1');
    });

    it('ships unlinked pairs entirely in the binary stream — zero text rows spent', async () => {
      const { parseBinaryIpl } = await import('@opensa/renderware/parsers/text/ipl-binary.parser');
      const { files, imgFiles } = buildLinkedAreas(
        [{ ...pairAt(0), linked: false }, pairAt(5)], // one unlinked bush + one linked tree
        'plotr',
      );

      const textRows = files[0][1].split('\r\n').filter((l) => /^\d/.test(l));
      expect(textRows).toHaveLength(1); // only the LINKED pair's LOD is permanent

      const bytes = imgFiles[0][1];
      const insts = parseBinaryIpl(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      );
      expect(insts).toHaveLength(3); // unlinked HD + unlinked LOD + linked HD
      const unlinked = insts.filter((i) => i.lod === -1);
      expect(unlinked.map((i) => i.id).sort((a, b) => a - b)).toEqual([800, 6500]); // both bush rows, no links
      expect(insts.find((i) => i.lod === 0)?.id).toBe(800); // the tree HD links to text row 0
    });
  });
});
