import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseCarcols } from '@opensa/renderware/parsers/text/carcols.parser';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  bakePaintMarkers,
  clampWindowGlass,
  FLEET_GLASS_FLOOR,
  type PaintColours,
  paintColoursFor,
  vanillaGlassFloor,
} from './materials';
import { toArrayBuffer } from './template';

const BOBCAT = new Uint8Array(readFileSync('tests/original/dff/cutscene/bobcat.dff'));
const CS_ZR350 = new Uint8Array(readFileSync('tests/original/dff/cutscene/cszr350.dff'));
const CARCOLS = parseCarcols(readFileSync('tests/original/data/carcols.dat', 'utf8'));

const COLOURS: PaintColours = [
  [11, 22, 33],
  [44, 55, 66],
  [77, 88, 99],
  [111, 122, 133],
];

function materialColours(dff: Uint8Array): string[] {
  const clump = parseDff(toArrayBuffer(dff));

  return clump.geometries.flatMap((geometry) =>
    geometry.materials.map(
      (material) => `${material.color[0]},${material.color[1]},${material.color[2]},${material.color[3]}`,
    ),
  );
}

describe('bakePaintMarkers', () => {
  describe('negative cases', () => {
    it('throws when the model carries markers but has no carcols row', () => {
      expect(() => bakePaintMarkers(BOBCAT, null)).toThrow('no carcols row');
    });
  });

  describe('positive cases', () => {
    it('replaces every paint marker, preserves alpha, bakes lamp markers white', () => {
      const { baked, bytes } = bakePaintMarkers(BOBCAT, COLOURS);
      expect(baked).toBeGreaterThan(0);

      const colours = materialColours(bytes);
      expect(colours.some((colour) => colour.startsWith('60,255,0'))).toBe(false);
      expect(colours.some((colour) => colour.startsWith('255,0,175'))).toBe(false);
      expect(colours).toContain('11,22,33,255');
      expect(colours).toContain('44,55,66,255');
      // Lamp ID markers render raw in the cutscene path — baked white like vanilla cs models.
      for (const marker of ['0,255,200', '185,255,0', '255,175,0', '255,60,0']) {
        expect(colours.some((colour) => colour.startsWith(marker))).toBe(false);
      }
      // Non-marker alpha materials (glass at 128) survive byte-identically.
      expect(colours).toContain('0,0,0,128');
    });

    it('does not disturb the rest of the file: same size, geometry parses identically', () => {
      const { bytes } = bakePaintMarkers(BOBCAT, COLOURS);
      expect(bytes.length).toBe(BOBCAT.length);
      const before = parseDff(toArrayBuffer(BOBCAT));
      const after = parseDff(toArrayBuffer(bytes));
      expect(after.geometries.map((geometry) => geometry.positions.length)).toEqual(
        before.geometries.map((geometry) => geometry.positions.length),
      );
    });
  });
});

describe('vanillaGlassFloor', () => {
  describe('negative cases', () => {
    it('returns null for a model with no window glass', () => {
      // An empty DFF-shaped buffer: no clump at all.
      expect(vanillaGlassFloor(new Uint8Array(0))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it("reads the vanilla zr350's authored big-pane alpha of 26", () => {
      expect(vanillaGlassFloor(CS_ZR350)).toBe(26);
    });
  });
});

describe('clampWindowGlass', () => {
  describe('negative cases', () => {
    it('leaves lenses and decals alone (the bobcat logo at alpha 242 is above the window band)', () => {
      const { bytes } = clampWindowGlass(BOBCAT, 26);
      const logos = materialColours(bytes).filter((colour) => colour === '255,255,255,242');
      expect(logos).toEqual(materialColours(BOBCAT).filter((colour) => colour === '255,255,255,242'));
    });

    it('does not raise a pane already below the floor', () => {
      const { bytes, clamped } = clampWindowGlass(BOBCAT, 254);
      expect(clamped).toBe(0);
      expect(materialColours(bytes)).toEqual(materialColours(BOBCAT));
    });
  });

  describe('positive cases', () => {
    it('clamps window panes down to the fleet floor when the twin has none', () => {
      const { bytes, clamped } = clampWindowGlass(BOBCAT, null);
      expect(clamped).toBe(6);
      const colours = materialColours(bytes);
      // The bobcat's windows (255,255,255,128 ×4) and dark glass (0,0,0,128 ×2) cap at the floor.
      expect(colours.filter((colour) => colour === `255,255,255,${FLEET_GLASS_FLOOR}`)).toHaveLength(4);
      expect(colours.filter((colour) => colour === `0,0,0,${FLEET_GLASS_FLOOR}`)).toHaveLength(2);
      expect(colours.some((colour) => colour.endsWith(',128'))).toBe(false);
    });

    it('same size, geometry parses identically', () => {
      const { bytes } = clampWindowGlass(BOBCAT, 26);
      expect(bytes.length).toBe(BOBCAT.length);
      const before = parseDff(toArrayBuffer(BOBCAT));
      const after = parseDff(toArrayBuffer(bytes));
      expect(after.geometries.map((geometry) => geometry.positions.length)).toEqual(
        before.geometries.map((geometry) => geometry.positions.length),
      );
    });
  });
});

describe('paintColoursFor', () => {
  describe('negative cases', () => {
    it('returns null for a model with no row', () => {
      expect(paintColoursFor(CARCOLS, 'nosuchcar')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('resolves the first combo of a 2-colour car, extras defaulting to palette 0', () => {
      const colours = paintColoursFor(CARCOLS, 'bobcat');
      expect(colours).not.toBeNull();
      expect(colours![0]).toHaveLength(3);
      expect(colours![2]).toEqual(CARCOLS.palette[0]);
    });
  });
});
