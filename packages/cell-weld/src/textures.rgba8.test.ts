/**
 * The portable-pak switch (`forceRgba8`, 2026-08-04).
 *
 * BC is a desktop-only format, so a pak that keeps SA's DXT blocks cannot be displayed on a mobile GPU at
 * all. This is the one build switch that changes that, and a silent no-op would cost whoever runs it a full
 * reconvert of a district before anything showed the failure — so both directions are pinned here.
 *
 * The dictionary is SYNTHETIC on purpose: the planner's other tests read `tests/original/mods/*.txd`, which
 * only exists after `npm run test:fixtures` extracts it from a real installation. This one has to run
 * everywhere, because it guards a flag people will reach for without a game tree at hand.
 */
import { OstexFormat } from '@opensa/engine-formats';
import { D3dCompression, RasterFormat, RwSection } from '@opensa/renderware/parsers/binary/constants';
import { chunk, concat, fixedString, toArrayBuffer, u8, u16, u32 } from '@opensa/renderware/test-utils';
import { describe, expect, it } from 'vitest';

import { TexturePlanner } from './textures';

const NAME = 'roadtex';
const TXD = 'district';
const WHITE: readonly [number, number, number, number] = [255, 255, 255, 255];

/** The format the planner actually sealed into the array the texture landed in. */
function builtFormat(planner: TexturePlanner): number {
  const built = planner.build();
  expect(built).toHaveLength(1);

  return built[0].meta.format;
}

/**
 * An 8×8 opaque DXT1 texture with a full mip chain — every condition the passthrough branch tests for
 * (block-aligned, power of two, no alpha, mips present). If any of them lapses, the default build below
 * stops proving anything, so the BC assertion is what keeps this fixture honest.
 */
function dxt1Dictionary(): ArrayBuffer {
  const size = 8;
  // DXT1 = 8 bytes per 4×4 block; mips 8×8, 4×4, 2×2, 1×1 → 4 + 1 + 1 + 1 blocks.
  const mips = [4, 1, 1, 1].map((blocks) => new Uint8Array(blocks * 8));
  const header = concat(
    u32(9),
    u32(0x1101),
    fixedString(NAME, 32),
    fixedString('', 32),
    u32(RasterFormat.C888),
    u32(D3dCompression.DXT1),
    u16(size),
    u16(size),
    u8(16),
    u8(mips.length),
    u8(4),
    u8(0), // flags: no alpha
  );
  const mipBlock = concat(...mips.map((mip) => concat(u32(mip.length), mip)));
  const native = chunk(RwSection.TEXTURE_NATIVE, chunk(RwSection.STRUCT, concat(header, mipBlock)));
  const dictStruct = chunk(RwSection.STRUCT, concat(u16(1), u16(0)));

  return toArrayBuffer(chunk(RwSection.TEXTURE_DICTIONARY, concat(dictStruct, native)));
}

function plannerFor(forceRgba8: boolean): TexturePlanner {
  const bytes = dxt1Dictionary();
  const fs = {
    get: (name: string): ArrayBuffer | null => (name.toLowerCase() === `${TXD}.txd` ? bytes : null),
    getText: (): null => null,
    has: (name: string): boolean => name.toLowerCase() === `${TXD}.txd`,
    names: [`${TXD}.txd`],
  } as unknown as ConstructorParameters<typeof TexturePlanner>[0];

  return new TexturePlanner(fs, new Map(), [], new Set(), { forceRgba8 });
}

describe('TexturePlanner forceRgba8', () => {
  describe('negative cases', () => {
    it('leaves the DXT passthrough alone by default — a desktop pak keeps SA blocks uncompressed-through', () => {
      const planner = plannerFor(false);

      planner.resolve(TXD, NAME, WHITE);

      expect(builtFormat(planner)).toBe(OstexFormat.BC1);
      expect(planner.report.opaquePass).toBe(1);
    });

    it('does not silently keep BC when asked for a portable pak', () => {
      const planner = plannerFor(true);

      planner.resolve(TXD, NAME, WHITE);

      expect(builtFormat(planner)).not.toBe(OstexFormat.BC1);
    });
  });

  describe('positive cases', () => {
    it('decodes a perfectly good DXT block to RGBA8 so the pak loads on a GPU without BC', () => {
      const planner = plannerFor(true);

      planner.resolve(TXD, NAME, WHITE);

      expect(builtFormat(planner)).toBe(OstexFormat.RGBA8);
    });

    it('routes the texture through the processing path instead of the passthrough counter', () => {
      const planner = plannerFor(true);

      planner.resolve(TXD, NAME, WHITE);

      expect(planner.report.opaquePass).toBe(0);
      expect(planner.report.processed).toBe(1);
    });
  });
});
