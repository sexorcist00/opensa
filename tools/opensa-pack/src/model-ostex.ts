/**
 * A MODEL's texture dictionary → `.ostex` (plan opensa-pack/003 phase 2).
 *
 * No new format was needed: `.ostex` is already "one `texture2d_array`, every layer the same size, full mip
 * chain baked offline" — exactly what a vehicle's or a ped's dictionary is once the builder has bucketed it.
 * The world planner's layers and these go through the same alpha pipeline and the same row packing, so an
 * optimized model's textures behave like every other texture we ship.
 */
import type { VehicleTextureArray } from '@opensa/renderware/vehicle/types';

import { encodeOstex, fnv1a, type Ostex, OstexAlphaClass, OstexFormat, ostexMaxMips } from '@opensa/engine-formats';

import { type AlphaClass, classifyAlpha, processAlphaTexture } from './alpha';
import { packOstexPayload } from './ostex-payload';

/** Alpha-to-coverage reference for cutouts — the world planner's value, kept identical on purpose. */
const CUTOUT_REF = 128;

const ALPHA_TO_OSTEX: Record<AlphaClass, number> = {
  cutout: OstexAlphaClass.CUTOUT,
  opaque: OstexAlphaClass.OPAQUE,
  softBlend: OstexAlphaClass.SOFT_BLEND,
};

/**
 * Whether to bake a mip chain. **Required, with no default** — the right answer differs by asset class and
 * a silent default would be inherited by the wrong one:
 *
 * - `'none'` — vehicles and peds. The engine uploads their arrays with no `mipLevelCount`
 *   (`engine.ts:728-736`), so it is 1 and nothing would ever sample a generated level. Close-range assets.
 * - `'full'` — MAP objects (breakables, clutter, animated objects). They are seen at distance and at
 *   grazing angles, the world planner generates chains for exactly this reason, and coverage-preserving
 *   mips are load-bearing for A2C foliage.
 *
 * Note that neither case inherits mips from the source: SA ships almost none (2 % of textures in a
 * 360-TXD map sample, none at all across the 210 vehicle TXDs). Chains are ours to generate or skip.
 */
export type ModelMipPolicy = 'full' | 'none';

/** Encode a built model's texture array as a `.ostex` file. */
export function packModelOstex(texture: VehicleTextureArray, mips: ModelMipPolicy): Uint8Array {
  const { height, layers: layerCount, names, rgba, width } = texture;
  const texelBytes = width * height * 4;
  const mipCount = mips === 'full' ? ostexMaxMips(OstexFormat.RGBA8, width, height) : 1;

  const classes: AlphaClass[] = [];
  const layerMips: { data: Uint8Array }[][] = [];
  for (let layer = 0; layer < layerCount; layer += 1) {
    const texels = rgba.subarray(layer * texelBytes, (layer + 1) * texelBytes);
    const alphaClass = classifyAlpha(texels, hasAlpha(texels));
    classes.push(alphaClass);
    // sharpen=false: a model's dictionary is authored art, not a foliage scan the welder had to upgrade.
    layerMips.push(
      processAlphaTexture(texels, width, height, alphaClass, CUTOUT_REF, mipCount, false).map((data) => ({ data })),
    );
  }

  const tex: Ostex = {
    format: OstexFormat.RGBA8,
    height,
    layers: classes.map((alphaClass, index) => ({
      alphaClass: ALPHA_TO_OSTEX[alphaClass],
      cutoutRef: alphaClass === 'cutout' ? CUTOUT_REF : 0,
      nameHash: fnv1a((names[index] ?? '').toLowerCase()),
      wrap: 0,
    })),
    mipCount,
    payload: packOstexPayload(OstexFormat.RGBA8, width, height, mipCount, layerMips),
    premultiplied: true,
    width,
  };

  return encodeOstex(tex);
}

/** Whether any texel is non-opaque — the RW `hasAlpha` flag is gone by the time the builder is done. */
function hasAlpha(rgba: Uint8Array): boolean {
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] < 255) {
      return true;
    }
  }

  return false;
}
