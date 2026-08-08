import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { extract2dfxEntries } from '@opensa/rw-codec/dff';

import type { VertexTransform } from './build-mesh';
import type { Vec3 } from './mesh';

import { clumpFrameTransforms } from './build-mesh';
import { transform2dfxEntry } from './two-dfx-transform';

/** A geometry with no atomic of its own keeps the entry where it was authored. */
const IDENTITY_TRANSFORM: VertexTransform = {
  normal: (x, y, z): Vec3 => [x, y, z],
  point: (x, y, z): Vec3 => [x, y, z],
};

/** A raw 2dfx entry with its position lifted into **model-local** space (the geometry's frame applied). */
export interface ClumpEffect {
  bytes: Uint8Array;
  position: Vec3;
  type: number;
}

/**
 * Lift a model's 2dfx entries out of its DFF bytes, each carried through the owning geometry's frame by
 * {@link transform2dfxEntry} — the same placement {@link clumpFrameTransforms} gives vertices, so effects land
 * exactly where the encoded mesh's geometry did (plan 003, Phase 5). An opaque payload stays byte-verbatim;
 * a spatial one (a plate's rotation, an escalator's step path) is carried too. `keepTypes` filters (cells keep
 * lights only); default = everything except particles.
 */
export function collectClumpEffects(
  dffBytes: Uint8Array,
  clump: RWClump,
  keepTypes?: ReadonlySet<number>,
): ClumpEffect[] {
  const transforms = clumpFrameTransforms(clump);

  return extract2dfxEntries(dffBytes, keepTypes).map((entry) =>
    transform2dfxEntry(entry, transforms[entry.geometryIndex] ?? IDENTITY_TRANSFORM),
  );
}
