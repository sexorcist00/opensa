import { parseBinaryCarGenerators, parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { describe, expect, it } from 'vitest';

import { stripBinaryIpl } from './ipl-binary-strip';
import { type BinaryIplInstance, encodeBinaryIpl } from './ipl-binary-write';

const inst = (id: number, lod: number): BinaryIplInstance => ({
  id,
  interior: 0,
  lod,
  position: [100.5, -200.25, 30.125],
  rotation: [0, 0, -0.7071, 0.7071],
});

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('encodeBinaryIpl', () => {
  describe('negative cases', () => {
    it('encodes an empty stream that still parses with zero instances and zero cars', () => {
      const bytes = encodeBinaryIpl([]);

      expect(bytes.byteLength).toBe(76);
      expect(parseBinaryIpl(toArrayBuffer(bytes))).toEqual([]);
      expect(parseBinaryCarGenerators(toArrayBuffer(bytes))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('round-trips instances through the engine parser', () => {
      const bytes = encodeBinaryIpl([inst(803, 5), inst(4542, -1)]);

      const parsed = parseBinaryIpl(toArrayBuffer(bytes));
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toMatchObject({ id: 803, interior: 0, lod: 5 });
      expect(parsed[0].position[0]).toBeCloseTo(100.5, 5);
      expect(parsed[0].rotation[2]).toBeCloseTo(-0.7071, 5);
      expect(parsed[1]).toMatchObject({ id: 4542, lod: -1 });
    });

    it('produces streams the binary strip tooling accepts', () => {
      const bytes = encodeBinaryIpl([inst(803, 0), inst(804, 1)]);

      const { changed, removed } = stripBinaryIpl(bytes, (id) => id !== 804, null);
      expect(changed).toBe(true);
      expect(removed).toBe(1);
    });
  });
});
