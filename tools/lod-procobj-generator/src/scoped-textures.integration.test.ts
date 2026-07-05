import type { RWClump, RWGeometry } from '@opensa/renderware/parsers/binary/types';

import { encodeLodTxd } from '@opensa/lod-common/encode-txd';
import { type ScopedRegistry, scopedSource } from '@opensa/lod-common/scoped-texture';
import { createTextureSource, type SourceTexture, type TextureSource } from '@opensa/lod-common/texture-source';
import { buildArchiveBuffer, openArchive } from '@opensa/renderware/archive/img-archive';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { decodeDxt } from '@opensa/rw-codec/dxt';
import { describe, expect, it } from 'vitest';

import { buildSpeciesLod } from './build';

/**
 * The `sm_bush_large_1` / `sand_josh1` regression (lod-common plan 004): two species whose textures share a
 * NAME but live in different TXDs with different pixels. The shared `lod_procobj.txd` must carry BOTH variants
 * under scoped names, and each species' LOD mesh must reference its own.
 */

/** A one-quad clump (two triangles, 1m tall) textured with `texture`. */
function clumpWith(texture: string): RWClump {
  const geometry: RWGeometry = {
    flags: 0,
    lights: [],
    materials: [{ color: [255, 255, 255, 255], texture: { maskName: '', name: texture }, textured: true }],
    nightColors: null,
    normals: null,
    numUVLayers: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
    prelitColors: null,
    triangles: [
      { a: 0, b: 1, c: 2, materialIndex: 0 },
      { a: 0, b: 2, c: 3, materialIndex: 0 },
    ],
    uvLayers: [new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])],
  };

  return {
    atomics: [{ frameIndex: 0, geometryIndex: 0 }],
    frames: [{ name: 'quad', parentIndex: -1, position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }],
    geometries: [geometry],
  };
}

function solid(r: number, g: number, b: number): SourceTexture {
  const rgba = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }

  return { hasAlpha: false, height: 16, rgba, width: 16 };
}

function txdBytes(textures: Record<string, SourceTexture>): Uint8Array {
  const direct: TextureSource = { get: (name) => textures[name.toLowerCase()] ?? null };

  return encodeLodTxd(Object.keys(textures), direct, 64);
}

describe('scoped LOD textures (plan 004 regression)', () => {
  describe('positive cases', () => {
    it('two species sharing a texture NAME each keep their own TXD variant in the shared LOD TXD', () => {
      // `leaves` is GREEN in gta_proc_bush.txd but RED in badlands.txd (the def TXD of the second species).
      const archive = openArchive(
        buildArchiveBuffer([
          { data: txdBytes({ leaves: solid(0, 200, 0) }), name: 'gta_proc_bush.txd' },
          { data: txdBytes({ leaves: solid(200, 0, 0) }), name: 'badlands.txd' },
        ]),
      );
      const source = createTextureSource([archive]);
      const registry: ScopedRegistry = new Map();
      const config = { procObjHeight: 0, tris: 200 };

      const bushLike = buildSpeciesLod('greenbush', clumpWith('leaves'), 'gta_proc_bush', config, registry)!;
      const badlandsBush = buildSpeciesLod('graybush', clumpWith('leaves'), 'badlands', config, registry)!;

      // Each mesh references its OWN scoped name — no bare-name sharing.
      expect(bushLike.textures).toEqual(['gta_proc_bush_leaves']);
      expect(badlandsBush.textures).toEqual(['badlands_leaves']);

      // The shared TXD carries BOTH variants with their own pixels.
      const shared = encodeLodTxd([...bushLike.textures, ...badlandsBush.textures], scopedSource(source, registry), 64);
      const parsed = parseTxd(toArrayBuffer(shared)).textures;
      expect(parsed.map((t) => t.name).sort()).toEqual(['badlands_leaves', 'gta_proc_bush_leaves']);

      const pixel = (name: string): number[] => {
        const texture = parsed.find((t) => t.name === name)!;
        const rgba = decodeDxt('dxt1', texture.mipmaps[0].data, texture.width, texture.height);

        return [rgba[0], rgba[1], rgba[2]];
      };
      expect(pixel('gta_proc_bush_leaves')[1]).toBeGreaterThan(150); // green species stayed green
      expect(pixel('badlands_leaves')[0]).toBeGreaterThan(150); // badlands species stayed red
      expect(pixel('badlands_leaves')[1]).toBeLessThan(60);
    });
  });
});
