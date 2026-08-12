import { writeRw } from '@opensa/rw-codec/chunk';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { readClump, writeClump } from './clump-io';

const CS_BOBCAT = new Uint8Array(readFileSync('tests/original/dff/cutscene/csbobcat92.dff'));

describe('clump-io', () => {
  describe('negative cases', () => {
    it('throws on bytes that are not a clump', () => {
      expect(() => readClump(new Uint8Array([1, 2, 3, 4]))).toThrow('not a DFF');
    });

    it('throws on a clump with no frame list', () => {
      // A clump chunk (0x10) whose body is empty parses to a clump with no children lists.
      const empty = new Uint8Array(12);
      new DataView(empty.buffer).setUint32(0, 0x10, true);
      expect(() => readClump(empty)).toThrow('no frame list');
    });
  });

  describe('positive cases', () => {
    it('reads the vanilla csbobcat92 rig: frames, bones, hierarchy flags', () => {
      const model = readClump(CS_BOBCAT);
      expect(model.frames).toHaveLength(20);
      expect(model.atomics).toHaveLength(18);
      expect(model.geometries).toHaveLength(18);

      const root = model.frames[1];
      expect(root.name).toBe('bobcat_dummy');
      expect(root.boneId).toBe(0);
      // The measured flag rule across the whole skeleton: 2 = siblings follow, 1 = leaf, 3 = both.
      expect(root.hierarchy?.map((node) => node.flags)).toEqual([
        0, 2, 1, 2, 1, 2, 1, 2, 1, 0, 3, 3, 3, 3, 3, 3, 3, 3, 1,
      ]);
      expect(root.hierarchy?.map((node) => node.id)).toEqual([...Array.from({ length: 19 }, (_, i) => i)]);

      const chassis = model.frames.find((frame) => frame.name === 'chassis');
      expect(chassis?.boneId).toBe(9);
      expect(chassis?.position[2]).toBeCloseTo(0.9, 3);
    });

    it('round-trips the model: frames, atomics and geometry bytes survive write → read', () => {
      const model = readClump(CS_BOBCAT);
      const reread = readClump(writeClump(model));

      expect(reread.frames).toEqual(model.frames);
      expect(
        reread.atomics.map(({ flags, frameIndex, geometryIndex }) => ({ flags, frameIndex, geometryIndex })),
      ).toEqual(model.atomics.map(({ flags, frameIndex, geometryIndex }) => ({ flags, frameIndex, geometryIndex })));
      const bytes = (chunk: Parameters<typeof writeRw>[0]['chunks'][number]): Uint8Array =>
        writeRw({ chunks: [chunk], trailing: new Uint8Array(0) });
      expect(bytes(reread.geometries[8])).toEqual(bytes(model.geometries[8]));
      expect(reread.atomics[0].extension && bytes(reread.atomics[0].extension)).toEqual(
        model.atomics[0].extension && bytes(model.atomics[0].extension),
      );
    });
  });
});
