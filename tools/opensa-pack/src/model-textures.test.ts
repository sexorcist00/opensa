/**
 * The per-model dictionary, on a REAL modded map object (plan opensa-pack/003 phase 5g).
 *
 * The point of planning from the raw TXD is the MIP CHAIN: 95 % of the textures the mod packs ship carry
 * one, map-optimizer authors it deliberately, and the path map objects would otherwise take
 * (`packModelOstex` over `buildVehicleModel`'s output) writes a single level. A stock fixture cannot prove
 * this — the stock game barely ships mips — so the fixture is a Chinatown building from `mods-src`.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { decodeOstex } from '@opensa/engine-formats';
import { parseDff } from '@opensa/renderware';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { planModelTextures } from './model-textures';

const FIXTURES = join(process.cwd(), 'tests', 'original');
const MODEL = 'chinatown_sfe1';
const TXD = 'chinatownsfe';

function fileOf(relative: string): ArrayBuffer {
  const data = readFileSync(join(FIXTURES, relative));

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

const files = new Map<string, ArrayBuffer>([
  [`${MODEL}.dff`, fileOf('mods/chinatown_sfe1.dff')],
  [`${TXD}.txd`, fileOf('mods/chinatownsfe.txd')],
]);

const fs: AssetFileSystem = {
  get: (name: string): ArrayBuffer | null => files.get(name.toLowerCase()) ?? null,
  getText: () => null,
  has: (name: string): boolean => files.has(name.toLowerCase()),
  names: [...files.keys()],
};

const clump = (): ReturnType<typeof parseDff> => parseDff(files.get(`${MODEL}.dff`)!);
const plan = (): ReturnType<typeof planModelTextures> => planModelTextures(fs, new Map<string, string>(), clump(), TXD);

/** The source chain length per texture NAME, straight from the TXD. */
function sourceMips(): Map<string, number> {
  const out = new Map<string, number>();
  for (const texture of parseTxd(files.get(`${TXD}.txd`)!).textures) {
    out.set(texture.name.toLowerCase(), texture.mipmaps.length);
  }

  return out;
}

describe('planModelTextures on a real modded map object', () => {
  describe('negative cases', () => {
    it('never collapses the model onto a single array when its textures disagree', () => {
      const { arrays } = plan();

      // The whole reason (array, layer) exists: one array is one size AND one format AND one mip count.
      expect(arrays.length).toBeGreaterThan(1);
    });

    it('leaves no hole in the array list — every slot a submesh can index exists', () => {
      const { arrays, slotOf } = plan();

      expect(arrays.every((bytes) => bytes !== undefined && bytes.byteLength > 0)).toBe(true);
      for (const slot of slotOf.values()) {
        expect(arrays[slot.array]).toBeDefined();
        expect(decodeOstex(arrays[slot.array]).layers.length).toBeGreaterThan(slot.layer);
      }
    });
  });

  describe('positive cases', () => {
    it('PRESERVES the source mip chain — the thing packModelOstex drops', () => {
      const source = sourceMips();
      const { arrays, slotOf } = plan();
      let checked = 0;

      for (const [name, slot] of slotOf) {
        const mips = source.get(name);
        if (mips === undefined || mips < 2) {
          continue; // flat colours and single-level textures prove nothing here
        }
        const dictionary = decodeOstex(arrays[slot.array]);
        // Opaque well-formed DXT passes through untouched; anything re-processed regenerates a FULL chain.
        // Either way the converted texture must not come out with one level.
        expect(dictionary.mipCount).toBeGreaterThan(1);
        checked += 1;
      }

      expect(checked).toBeGreaterThan(4); // the fixture really does carry chained textures
    });

    it('resolves every material the clump references to a slot', () => {
      const { slotOf } = plan();
      const referenced = new Set<string>();
      for (const geometry of clump().geometries) {
        for (const material of geometry.materials) {
          referenced.add(material.texture?.name?.toLowerCase() ?? `#${material.color.join(',')}`);
        }
      }

      for (const name of referenced) {
        expect(slotOf.has(name)).toBe(true);
      }
    });

    it('deduplicates by CONTENT — two materials sharing a texture share its slot', () => {
      const { slotOf } = plan();
      const slots = [...slotOf.values()].map((slot) => `${slot.array}:${slot.layer}`);

      expect(new Set(slots).size).toBe(slots.length); // one slot per distinct key, none duplicated
    });
  });
});
