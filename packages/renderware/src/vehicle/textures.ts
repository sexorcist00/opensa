/**
 * Vehicle texture array (074/08 B5): the model's TXD first, the shared `vehicle.txd` as fallback, decoded
 * into ONE RGBA8 array whose layers all share a size. Ported from the B2 probe's `TextureSet` — same lore,
 * now browser-callable (no node:fs, no tool-side resampler).
 */
import type { RWMaterial } from '../parsers/binary/types';
import type { VehicleTextureArray } from './types';

import { parseTxd } from '../parsers/binary/txd';
import { decodeDxt } from '../textures/dxt';

interface DecodedTexture {
  /** True when the decoded texels actually carry transparency (not merely an alpha-capable format). */
  alpha: boolean;
  height: number;
  rgba: Uint8Array;
  width: number;
}

/** Below this a texel counts as see-through — the same 250 cut the material-alpha check uses. */
const ALPHA_CUT = 250;

export class VehicleTextures {
  /**
   * True when NOT ONE source dictionary carried a texture — stock SA ships 11 empty TXDs, and the game
   * renders their materials with the material colour over a white stand-in. Callers that plan their own
   * dictionary need to know, or they would mark every one of those materials as a MISSING texture.
   */
  get empty(): boolean {
    return this.sources.size === 0;
  }
  private readonly layers: string[] = [];
  private readonly picked = new Map<string, DecodedTexture>();

  private readonly sources = new Map<string, DecodedTexture>();

  /** `txds` are raw TXD bytes, highest priority first (model TXD, then the generic `vehicle.txd`). */
  constructor(txds: readonly ArrayBuffer[]) {
    for (const bytes of txds) {
      for (const texture of parseTxd(bytes).textures) {
        const key = texture.name.toLowerCase();
        if (this.sources.has(key)) {
          continue; // first TXD wins — the model's own overrides the generic set
        }
        const base = texture.mipmaps[0];
        const rgba =
          texture.format === 'rgba8888'
            ? new Uint8Array(base.data)
            : decodeDxt(texture.format, base.data, base.width, base.height);
        this.sources.set(key, { alpha: hasTransparency(rgba), height: base.height, rgba, width: base.width });
      }
    }
  }

  /**
   * Whether a material's TEXTURE carries real transparency. SA vehicles put decals on the body — scratch and
   * crack overlays, badges — whose alpha is in the texels, not in the material colour. Miss this and the
   * decal renders opaque: its transparent (black) texels paint a black panel over the door.
   */
  hasAlpha(material: RWMaterial): boolean {
    const name = material.texture?.name.toLowerCase() ?? '';

    return this.sources.get(name)?.alpha ?? false;
  }

  pack(): VehicleTextureArray {
    let width = 4;
    let height = 4;
    for (const name of this.layers) {
      const source = this.picked.get(name);
      if (source) {
        width = Math.max(width, source.width);
        height = Math.max(height, source.height);
      }
    }
    if (this.layers.length === 0) {
      this.layers.push('white');
      this.picked.set('white', { alpha: false, height: 4, rgba: whiteTexel(4, 4), width: 4 });
    }
    const rgba = new Uint8Array(this.layers.length * width * height * 4);
    this.layers.forEach((name, layer) => {
      const source = this.picked.get(name);
      const scaled = source ? resample(source, width, height) : whiteTexel(width, height);
      rgba.set(scaled, layer * width * height * 4);
    });

    return { height, layers: this.layers.length, names: [...this.layers], rgba, width };
  }

  /** Layer index for a material (layer for 'white' when untextured — the paint carries the colour). */
  resolve(material: RWMaterial): number {
    return this.ensureLayer(material.texture?.name.toLowerCase() ?? 'white');
  }

  /** Layer index for a texture named by a MATERIAL EFFECT (env map, specular map) rather than the material. */
  resolveNamed(name: string): number {
    return this.ensureLayer(name.toLowerCase());
  }

  /**
   * Lamp textures have a lamps-on TWIN (`vehiclelights128` → `vehiclelightson128` — SA swaps the texture at
   * night). Returns its layer, or 0 for "none": layer 0 is always claimed by the first body material, so it
   * can never itself BE a twin, which makes 0 a safe sentinel.
   */
  resolveNightTwin(material: RWMaterial): number {
    const name = material.texture?.name.toLowerCase() ?? '';
    if (!name.includes('lights') || name.includes('lightson')) {
      return 0;
    }
    const twin = name.replace('lights', 'lightson');

    return this.sources.has(twin) ? this.ensureLayer(twin) : 0;
  }

  private ensureLayer(name: string): number {
    const existing = this.layers.indexOf(name);
    if (existing >= 0) {
      return existing;
    }
    const source = name === 'white' ? null : (this.sources.get(name) ?? null);
    this.picked.set(name, source ?? { alpha: false, height: 4, rgba: whiteTexel(4, 4), width: 4 });
    this.layers.push(name);

    return this.layers.length - 1;
  }
}

/** Scan the decoded texels: an alpha-CAPABLE format (DXT3/5, RGBA) is common on fully opaque textures too. */
function hasTransparency(rgba: Uint8Array): boolean {
  for (let at = 3; at < rgba.length; at += 4) {
    if (rgba[at] < ALPHA_CUT) {
      return true;
    }
  }

  return false;
}

/** Nearest-sample resize onto the array's common size (vehicle textures are small and already pow2). */
function resample(source: DecodedTexture, width: number, height: number): Uint8Array {
  if (source.width === width && source.height === height) {
    return source.rgba;
  }
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(source.height - 1, Math.floor((y / height) * source.height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(source.width - 1, Math.floor((x / width) * source.width));
      for (let channel = 0; channel < 4; channel += 1) {
        out[(y * width + x) * 4 + channel] = source.rgba[(sy * source.width + sx) * 4 + channel];
      }
    }
  }

  return out;
}

function whiteTexel(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 4).fill(255);
}
