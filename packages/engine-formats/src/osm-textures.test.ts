import { describe, expect, it } from 'vitest';

import { decodeOsmTextures, encodeOsmTextures } from './osm-textures';

const arrays = [Uint8Array.from([1, 2, 3, 4, 5]), Uint8Array.from([9, 8]), Uint8Array.from([7])];

describe('osm textures section', () => {
  describe('negative cases', () => {
    it('survives a model with no dictionary at all', () => {
      expect(decodeOsmTextures(encodeOsmTextures({ arrays: [] })).arrays).toEqual([]);
    });

    it('keeps arrays APART rather than concatenating them', () => {
      // A single blob would still decode; only the per-array lengths keep (array, layer) addressable.
      const read = decodeOsmTextures(encodeOsmTextures({ arrays }));

      expect(read.arrays.map((array) => array.byteLength)).toEqual([5, 2, 1]);
    });

    it('decodes from an UNALIGNED view over a larger buffer', () => {
      const encoded = encodeOsmTextures({ arrays });
      const padded = new Uint8Array(encoded.byteLength + 3);
      padded.set(encoded, 3);

      expect(decodeOsmTextures(padded.subarray(3)).arrays).toEqual(arrays);
    });
  });

  describe('positive cases', () => {
    it('round-trips a single-array model (vehicles, clutter)', () => {
      expect(decodeOsmTextures(encodeOsmTextures({ arrays: [arrays[0]] })).arrays).toEqual([arrays[0]]);
    });

    it('round-trips a multi-array model (a ped whose textures disagree on size)', () => {
      expect(decodeOsmTextures(encodeOsmTextures({ arrays })).arrays).toEqual(arrays);
    });
  });
});
