import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { extract2dfxEntries, type Raw2dfxEntry } from '@opensa/rw-codec/dff';

import type { Vec3 } from './mesh';

import { clumpFrameTransforms } from './build-mesh';

/** A raw 2dfx entry with its position lifted into **model-local** space (the geometry's frame applied). */
export interface ClumpEffect {
  bytes: Uint8Array;
  position: Vec3;
  type: number;
}

/**
 * Lift a model's 2dfx entries out of its DFF bytes with each entry's position mapped through the owning
 * geometry's frame — the same placement {@link clumpFrameTransforms} gives vertices, so effects land exactly
 * where the encoded mesh's geometry did (plan 003, Phase 5). Everything but the 12 position bytes stays
 * verbatim (fields our parsers don't know survive). `keepTypes` filters (cells keep lights only); default =
 * everything except particles (deliberately stripped from far LODs).
 */
export function collectClumpEffects(
  dffBytes: Uint8Array,
  clump: RWClump,
  keepTypes?: ReadonlySet<number>,
): ClumpEffect[] {
  const transforms = clumpFrameTransforms(clump);

  return extract2dfxEntries(dffBytes, keepTypes).map((entry: Raw2dfxEntry) => ({
    bytes: entry.bytes,
    position:
      transforms[entry.geometryIndex]?.point(entry.position[0], entry.position[1], entry.position[2]) ?? entry.position,
    type: entry.type,
  }));
}
