import { describe, expect, it } from 'vitest';

import type { RWMaterial } from '../parsers/binary/types';

import { VehicleTextures } from './textures';

/** No TXDs at all — every lookup misses, which is the interesting boundary. */
function empty(): VehicleTextures {
  return new VehicleTextures([]);
}

function material(name: null | string): RWMaterial {
  return {
    color: [255, 255, 255, 255],
    texture: name === null ? null : ({ name } as RWMaterial['texture']),
    textured: name !== null,
  };
}

describe('VehicleTextures', () => {
  describe('negative cases', () => {
    it('an untextured material resolves to the built-in white layer (the paint carries the colour)', () => {
      const textures = empty();

      expect(textures.resolve(material(null))).toBe(0);
      expect(textures.pack().names[0]).toBe('white');
    });

    it('a material whose texture is missing does not blow up the array', () => {
      const textures = empty();

      const layer = textures.resolve(material('nosuchtexture'));
      const packed = textures.pack();

      expect(packed.names[layer]).toBe('nosuchtexture');
      expect(packed.rgba.byteLength).toBe(packed.layers * packed.width * packed.height * 4);
    });

    it('a material with no lamp twin reports layer 0 — the "none" sentinel', () => {
      // Layer 0 is always claimed by the first body material, so it can never itself BE a twin.
      expect(empty().resolveNightTwin(material('vehiclegeneric256'))).toBe(0);
      expect(empty().resolveNightTwin(material('vehiclelightson128'))).toBe(0); // already the lit one
    });

    it('a texture the TXD never carried has no alpha to speak of', () => {
      expect(empty().hasAlpha(material('vehiclescratch64'))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('resolving the same texture twice reuses its layer', () => {
      const textures = empty();

      expect(textures.resolve(material('body'))).toBe(0);
      expect(textures.resolve(material('body'))).toBe(0);
      expect(textures.resolve(material('glass'))).toBe(1);
      expect(textures.pack().layers).toBe(2);
    });

    it('every layer is packed at the SAME size (a texture array demands it)', () => {
      const textures = empty();
      textures.resolve(material('a'));
      textures.resolve(material('b'));

      const packed = textures.pack();

      expect(packed.rgba.byteLength).toBe(2 * packed.width * packed.height * 4);
    });
  });
});
