import { Texture } from 'three';
import { describe, expect, it } from 'vitest';

import type { RWGeometry, RWMaterial } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';
import { applyWorldWindowGlowTsl, buildWorldMaterialTsl } from './world-material-tsl';

function geometry(partial: Partial<RWGeometry> = {}): RWGeometry {
  return {
    flags: GeometryFlag.POSITIONS | GeometryFlag.PRELIT | GeometryFlag.TEXTURED,
    lights: [],
    materials: [],
    nightColors: null,
    normals: null,
    numUVLayers: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    prelitColors: new Uint8Array(12),
    triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
    uvLayers: [new Float32Array(6)],
    ...partial,
  };
}

function material(partial: Partial<RWMaterial> = {}): RWMaterial {
  return { color: [255, 255, 255, 255], texture: null, textured: false, ...partial };
}

function textureMap(hasAlpha = false): Map<string, Texture> {
  const texture = new Texture();
  texture.name = 'wall';
  texture.userData.hasAlpha = hasAlpha;

  return new Map([
    ['wall', texture],
    ['white', texture],
  ]);
}

describe('buildWorldMaterialTsl', () => {
  describe('negative cases', () => {
    it('does not set an opacity node or alpha test on opaque materials', () => {
      const built = buildWorldMaterialTsl(
        material({ texture: { maskName: '', name: 'wall' } }),
        geometry(),
        textureMap(),
      );

      expect(built.transparent).toBe(false);
      expect(built.opacityNode).toBeNull();
      expect(built.alphaTest).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('renders beams blended with their per-vertex cone alpha (no alpha test, no depth write)', () => {
      // The beam signature: `white` placeholder texture + translucent prelit alpha (plan 032).
      const built = buildWorldMaterialTsl(
        material({ texture: { maskName: '', name: 'white' } }),
        geometry({ prelitColors: new Uint8Array([255, 255, 255, 40, 255, 255, 255, 40, 255, 255, 255, 40]) }),
        textureMap(),
      );

      expect(built.transparent).toBe(true);
      expect(built.alphaTest).toBe(0); // a 0.5 test would clip the whole ~0.2-alpha cone
      expect(built.depthWrite).toBe(false);
      expect(built.opacityNode).not.toBeNull();
    });

    it('applies the window glow once, even when the shared material is treated twice', () => {
      const built = buildWorldMaterialTsl(
        material({ texture: { maskName: '', name: 'wall' } }),
        geometry(),
        textureMap(true),
      );

      const before = built.colorNode;
      applyWorldWindowGlowTsl(built);
      const glowed = built.colorNode;
      applyWorldWindowGlowTsl(built);

      expect(glowed).not.toBe(before); // the term landed…
      expect(built.colorNode).toBe(glowed); // …and a second treatment does not stack it
    });
  });
});
