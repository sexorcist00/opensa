/**
 * A MODEL's dictionary, planned from the RAW TXDs (plan opensa-pack/003 phase 5g).
 *
 * `packModelOstex` — the dictionary path vehicles, clutter and peds use — takes `buildVehicleModel`'s output,
 * and by then the mip chain is gone: `VehicleTextures` decoded level 0 and dropped the rest. That is fine for
 * a car (SA ships no mips for vehicles) and fatal for a map object: **95 % of the textures the mod packs
 * ship carry a chain**, up to 12 levels, and map-optimizer authors those chains deliberately.
 *
 * So a map object plans from the raw TXD instead — by reusing the WORLD planner, one instance per model.
 * That gets, for free and without a second implementation: the opaque-DXT pass-through that preserves the
 * source chain byte for byte, the `txdp` parent walk, the alpha pipeline for everything else, flat-colour
 * materials, and content dedup. A fresh instance numbers its arrays from 0, so `arrayRef` IS the model's
 * array index.
 */
import type { AssetFileSystem } from '@opensa/renderware';
import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { TexturePlanner } from './textures';

export interface ModelDictionary {
  /** One `.ostex` per array, indexed by the `array` field of a slot. */
  arrays: Uint8Array[];
  /** Where each of the model's material textures landed. Flat-colour materials key on their colour. */
  slotOf: Map<string, ModelTextureSlot>;
}

export interface ModelTextureSlot {
  array: number;
  layer: number;
}

/** The key a flat-colour material resolves under (it has no texture name). */
export function colorKey(color: readonly number[]): string {
  return `#${color[0]},${color[1]},${color[2]},${color[3]}`;
}

/**
 * Plan every material texture the clump references. `preferCutout` mirrors the welder's vegetation rule —
 * SA alpha-tests foliage, and a blend-classed canopy writes no depth (trees show through trees).
 */
export function planModelTextures(
  fs: AssetFileSystem,
  txdParents: Map<string, string>,
  clump: RWClump,
  txdName: string,
  preferCutout = false,
): ModelDictionary {
  const planner = new TexturePlanner(fs, txdParents);
  const slotOf = new Map<string, ModelTextureSlot>();

  for (const geometry of clump.geometries) {
    for (const material of geometry.materials) {
      const name = material.texture?.name?.toLowerCase() ?? null;
      const key = name ?? colorKey(material.color);
      if (slotOf.has(key)) {
        continue;
      }
      const resolved = planner.resolve(txdName.toLowerCase(), name, material.color, preferCutout);
      slotOf.set(key, { array: resolved.arrayRef, layer: resolved.layer });
    }
  }

  // `build()` emits in ref order, but say so rather than assume it — a mis-ordered array silently
  // retextures every submesh that indexes it.
  const built = planner.build();
  const arrays: Uint8Array[] = [];
  for (const entry of built) {
    arrays[entry.ref] = entry.bytes;
  }
  const missing = arrays.findIndex((bytes) => bytes === undefined);
  if (missing >= 0) {
    throw new Error(`model dictionary is missing array ${missing} of ${arrays.length}`);
  }

  return { arrays, slotOf };
}
