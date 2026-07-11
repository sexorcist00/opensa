import type { Texture } from 'three';

import {
  CompressedTexture,
  DataTexture,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT3_Format,
  RGBA_S3TC_DXT5_Format,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';

import type { RWTexture, RWTextureDictionary } from '../parsers/binary/types';

import { decodeDxt, type DxtFormat } from '../textures/dxt';

const DXT_FORMAT = {
  dxt1: RGBA_S3TC_DXT1_Format,
  dxt3: RGBA_S3TC_DXT3_Format,
  dxt5: RGBA_S3TC_DXT5_Format,
} as const;

/** A TXD's textures by lowercased name — the shape every texture consumer works with. */
export type TextureDictionary = Map<string, Texture>;

/** WebGPU mode (plan 073/08 memory): free each texture's CPU-side pixel payload right after its GPU upload
 *  (`texture.onUpdate` fires then). The Texture OBJECT survives — material/pipeline sharing (keyed by texture
 *  identity) is untouched — but the JS heap stops holding every mip of every texture ever streamed (field:
 *  3–6 GB heap → unified-memory pressure → GPU collapse on Apple Silicon). Off on WebGL: its context-restore
 *  path re-uploads from this data. Never re-set `needsUpdate` on a freed texture. */
let freeTextureData = false;
/** Build a name-keyed (lowercased) map of three.js textures from a TXD. */
export function buildTextureMap(dict: RWTextureDictionary): TextureDictionary {
  const map = new Map<string, Texture>();
  for (const rw of dict.textures) {
    map.set(rw.name.toLowerCase(), buildTexture(rw));
  }

  return map;
}

export function setTextureDataFreeing(enabled: boolean): void {
  freeTextureData = enabled;
}

function buildCompressedTexture(rw: RWTexture): CompressedTexture {
  const format = DXT_FORMAT[rw.format as keyof typeof DXT_FORMAT];
  const mipmaps = rw.mipmaps.map((m) => ({ data: m.data, height: m.height, width: m.width }));
  const texture = new CompressedTexture(mipmaps, rw.width, rw.height, format, UnsignedByteType);
  // Only enable trilinear mipmapping when the chain is actually present.
  texture.minFilter = mipmaps.length > 1 ? LinearMipmapLinearFilter : texture.magFilter;

  return texture;
}

function buildDataTexture(rw: RWTexture): DataTexture {
  const base = rw.mipmaps[0];

  return new DataTexture(base.data, base.width, base.height, RGBAFormat, UnsignedByteType);
}

/** DXT with non-block-aligned dimensions (SA has 62×62 etc.): WebGL tolerated them, WebGPU REJECTS the texture
 *  (BC width/height must be multiples of 4) — decode the base level to RGBA instead and let mips regenerate. */
function buildDecodedTexture(rw: RWTexture): DataTexture {
  const base = rw.mipmaps[0];
  const rgba = decodeDxt(rw.format as DxtFormat, base.data, base.width, base.height);
  const texture = new DataTexture(rgba, base.width, base.height, RGBAFormat, UnsignedByteType);
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;

  return texture;
}

function buildTexture(rw: RWTexture): Texture {
  const blockAligned = rw.width % 4 === 0 && rw.height % 4 === 0;
  const texture =
    rw.format === 'rgba8888'
      ? buildDataTexture(rw)
      : blockAligned
        ? buildCompressedTexture(rw)
        : buildDecodedTexture(rw);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false; // compressed textures cannot be flipped; keep DDS-style orientation
  texture.name = rw.name;
  texture.userData.hasAlpha = rw.hasAlpha;
  texture.needsUpdate = true;
  if (freeTextureData) {
    freeOnUpload(texture);
  }

  return texture;
}

/** Release the CPU copies once the GPU has the texture (see {@link setTextureDataFreeing}). */
function freeOnUpload(texture: Texture): void {
  texture.onUpdate = (): void => {
    texture.onUpdate = null;
    texture.mipmaps = [];
    const image = texture.image as { data?: null | Uint8Array };
    if (image && image.data) {
      image.data = null;
    }
  };
}
