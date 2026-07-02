import type { RwChunk } from './chunk';

import {
  readRw,
  RW_CLUMP,
  RW_EXTENSION,
  RW_GEOMETRY,
  RW_GEOMETRY_LIST,
  RW_STRUCT,
  RW_TWO_D_EFFECT,
  writeRw,
} from './chunk';

/** 2d-effect entry type for a particle emitter (an `effects.fxp` system — factory smoke, fire, fountains, vents). */
const PARTICLE_2DFX = 1;
/** A 2d-effect entry header before its type-specific data: `position` (3×f32) + `type` (u32) + `dataSize` (u32). */
const ENTRY_HEADER_BYTES = 20;

/** Every Geometry chunk, in document order (matches a clump's geometry-list order). */
export function collectGeometries(chunks: readonly RwChunk[]): RwChunk[] {
  const geometries: RwChunk[] = [];
  for (const clump of chunks) {
    if (clump.type !== RW_CLUMP) {
      continue;
    }
    for (const list of clump.children ?? []) {
      if (list.type !== RW_GEOMETRY_LIST) {
        continue;
      }
      for (const geometry of list.children ?? []) {
        if (geometry.type === RW_GEOMETRY) {
          geometries.push(geometry);
        }
      }
    }
  }

  return geometries;
}

/** The Struct leaf of every Geometry, in document order (for tests). */
export function collectGeometryStructs(chunks: readonly RwChunk[]): RwChunk[] {
  return collectGeometries(chunks)
    .map((geometry) => geometry.children?.find((child) => child.type === RW_STRUCT && child.data))
    .filter((struct): struct is RwChunk => Boolean(struct));
}

/**
 * Remove **particle** 2d-effect entries (type 1 — `effects.fxp` emitters) from every geometry's 2dfx section,
 * leaving lights/coronas, road signs, escalators and everything else byte-for-byte intact. Used when cloning an HD
 * model into a far LOD: the verbatim clone would otherwise carry the emitter, so the effect (factory smoke, fire,
 * fountains) renders from the distant LOD too — a duplicate emitter and far-view overdraw. Stripping it on the
 * clone restores stock far-view behaviour (LODs have no emitter) while the HD keeps the effect up close.
 *
 * Byte-faithful via {@link readRw}/{@link writeRw}; returns the input unchanged (identity) when there are no
 * particle entries, so it is safe to call on every clone.
 */
export function stripParticleEffects(bytes: Uint8Array): Uint8Array {
  const file = readRw(bytes);
  let removed = 0;
  for (const geometry of collectGeometries(file.chunks)) {
    const extension = geometry.children?.find((child) => child.type === RW_EXTENSION);
    const fx = extension?.children?.find((child) => child.type === RW_TWO_D_EFFECT && child.data);
    if (!fx?.data) {
      continue;
    }
    const filtered = filterParticleEntries(fx.data);
    if (filtered) {
      fx.data = filtered.data;
      removed += filtered.removed;
    }
  }

  return removed > 0 ? writeRw(file) : bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

/**
 * Rewrite a 2dfx section's raw bytes (`u32 count`, then entries of `position(12) + type(4) + dataSize(4) + data`)
 * keeping every non-particle entry verbatim. Returns `null` when there is nothing to remove (leave the leaf as-is),
 * else the new bytes + how many particle entries were dropped. Any bytes trailing the last entry are preserved.
 */
function filterParticleEntries(data: Uint8Array): null | { data: Uint8Array; removed: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  const kept: Uint8Array[] = [];
  let removed = 0;
  let pos = 4;
  for (let i = 0; i < count; i += 1) {
    if (pos + ENTRY_HEADER_BYTES > data.length) {
      return null; // malformed — don't touch it
    }
    const entryType = view.getUint32(pos + 12, true);
    const entryEnd = pos + ENTRY_HEADER_BYTES + view.getUint32(pos + 16, true);
    if (entryEnd > data.length) {
      return null;
    }
    if (entryType === PARTICLE_2DFX) {
      removed += 1;
    } else {
      kept.push(data.subarray(pos, entryEnd));
    }
    pos = entryEnd;
  }
  if (removed === 0) {
    return null;
  }
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, kept.length, true);

  return { data: concat([header, ...kept, data.subarray(pos)]), removed };
}
