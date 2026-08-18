import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readRw, type RwChunk, writeRw } from '@opensa/rw-codec/chunk';
import { collectGeometries } from '@opensa/rw-codec/dff';

/** What the copy did — the CLI prints it, because a run that changes nothing has to say so. */
export interface CopyEffectsResult {
  bytes: Uint8Array;
  /** Materials whose reference value came from a SHARED TEXTURE NAME rather than the median. */
  byTexture: number;
  /** Env-map coefficients written. */
  coefficients: number;
  /** Reflection intensities written. */
  intensities: number;
  /** Materials seen in the target. */
  materials: number;
  /** Materials touched at all. */
  patched: number;
  /** The prototype's representative (median) value, used wherever no texture name matched. */
  reference: ReflectionValue;
}

/**
 * Transfer **only the reflection strength** — the MatFX env-map `coefficient` and the SA reflection plugin's
 * `intensity` — from a well-tuned reference (prototype) vehicle onto a target whose reflection is overdone
 * (plan 003). Nothing else changes: textures, colour, geometry, even *which* materials reflect are left
 * alone — we only retune the numbers on the target's **existing** reflective materials, so the worst case is
 * a part a touch too shiny/matte.
 *
 * **Both chunks count, and that was a real defect** (2026-08-18): the gate used to be "has an env-map", so a
 * material carrying only the reflection plugin was skipped entirely — on the user's yankee that was **83 of
 * 116 materials**, and every stock fixture has the same shape (infernus 46, admiral 24, walton 123). The
 * prototype side had the same gate, so a reference's reflection-only materials never entered the median
 * either. A run therefore reported success and changed almost nothing.
 *
 * A value of **0 is "not reflective" and stays 0** on both sides: it is neither retuned on the target nor
 * counted into the reference median, so the copy can never make a matte part shiny.
 *
 * The prototype is read with the engine `parseDff` (read-only) — so it works even for anti-rip-locked
 * references like `walton.dff`. The target is read+patched with map-optimizer's byte codec (a standard DFF
 * being fixed), writing the new floats straight into its env-map / reflection plugin chunks.
 *
 * **Matching cascade** (per target reflective material): by shared base **texture name**, else the
 * prototype's **representative** value (median across its reflective materials) — so it works across
 * different vehicles with different material counts, never throwing on a mismatch.
 */
export function copyMaterialEffects(targetBytes: Uint8Array, prototypeBytes: Uint8Array): CopyEffectsResult {
  const reference = readReflectionProfiles(prototypeBytes);
  if (!reference) {
    throw new Error(
      'the prototype DFF has no reflective materials (no env-map coefficient and no reflection intensity above ' +
        '0) — nothing to copy; pick a reference whose reflection is the look you want',
    );
  }

  const file = readRw(targetBytes);
  const lists = materialLists(file);
  const summary = { byTexture: 0, coefficients: 0, intensities: 0, materials: 0, patched: 0 };
  for (const { chunks } of lists) {
    for (const material of chunks.filter((chunk) => chunk.type === MATERIAL)) {
      summary.materials += 1;
      patchReflection(material, reference, summary);
    }
  }
  if (summary.patched === 0) {
    throw new Error(
      "the target DFF has no reflective materials to retune — it doesn't parse as a standard SA vehicle DFF, " +
        'or every one of its materials has a zero env-map coefficient and a zero reflection intensity',
    );
  }

  for (const { chunks, leaf } of lists) {
    leaf.data = writeChunks(chunks);
  }

  return { bytes: writeRw(file), reference: reference.representative, ...summary };
}

const MATERIAL_LIST = 0x08;
const MATERIAL = 0x07;
const TEXTURE = 0x06;
const STRING = 0x02;
const EXTENSION = 0x03;
const MATERIAL_CONTAINERS = new Set([EXTENSION, MATERIAL, TEXTURE]);
/** MatFX env-map (0x120): effectType, slotType, then `coefficient` f32 at offset 8. */
const ENVMAP = 0x120;
const ENVMAP_COEFFICIENT_OFFSET = 8;
/** SA reflection (0x253f2fc): scale.xy, offset.xy, then `intensity` f32 at offset 16. */
const REFLECTION = 0x253f2fc;
const REFLECTION_INTENSITY_OFFSET = 16;
const HEADER_BYTES = 12;

/** A re-parsed chunk inside a Material List (container ⇒ `children`, leaf ⇒ `data`). */
interface MatChunk {
  children?: MatChunk[];
  data?: Uint8Array;
  type: number;
  version: number;
}
/** Running counts {@link patchReflection} fills in. */
interface PatchSummary {
  byTexture: number;
  coefficients: number;
  intensities: number;
  materials: number;
  patched: number;
}

/** The reflection values to apply, plus a per-texture lookup for name matching. */
interface ReflectionProfiles {
  byTexture: ReadonlyMap<string, ReflectionValue>;
  representative: ReflectionValue;
}

interface ReflectionValue {
  coefficient: null | number;
  intensity: null | number;
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

/** Each geometry's Material List leaf + its re-parsed chunk tree (edit in place, then re-serialize the leaf). */
function materialLists(file: ReturnType<typeof readRw>): { chunks: MatChunk[]; leaf: RwChunk }[] {
  const lists: { chunks: MatChunk[]; leaf: RwChunk }[] = [];
  for (const geometry of collectGeometries(file.chunks)) {
    const leaf = geometry.children?.find((child) => child.type === MATERIAL_LIST && child.data);
    if (leaf?.data) {
      lists.push({ chunks: parseChunks(leaf.data), leaf });
    }
  }

  return lists;
}

/** The base texture name on a parsed Material chunk (Texture → first String), lowercased; '' if untextured. */
function materialTexture(material: MatChunk): string {
  const texture = material.children?.find((child) => child.type === TEXTURE);
  const name = texture?.children?.find((child) => child.type === STRING)?.data;

  return name ? readCString(name) : '';
}

/** The median of a non-empty list (lower-middle for an even count) — a robust "typical" reflection value. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function parseChunks(bytes: Uint8Array): MatChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: MatChunk[] = [];
  let pos = 0;
  while (pos + HEADER_BYTES <= bytes.length) {
    const type = view.getUint32(pos, true);
    const size = view.getUint32(pos + 4, true);
    const version = view.getUint32(pos + 8, true);
    const bodyStart = pos + HEADER_BYTES;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > bytes.length) {
      break;
    }
    const body = bytes.subarray(bodyStart, bodyEnd);
    chunks.push(
      MATERIAL_CONTAINERS.has(type) ? { children: parseChunks(body), type, version } : { data: body, type, version },
    );
    pos = bodyEnd;
  }

  return chunks;
}

/**
 * Retune one target material's reflection strength in place. A material counts as reflective when it carries a
 * NON-ZERO env-map coefficient or a non-zero reflection intensity — either chunk on its own is enough, and a
 * zero is left as the author wrote it. The reference value comes from a shared texture name when there is one,
 * else from the prototype's median, and each of the two floats is written only where both sides have it.
 */
function patchReflection(material: MatChunk, reference: ReflectionProfiles, summary: PatchSummary): void {
  const extension = material.children?.find((child) => child.type === EXTENSION);
  const envMap = extension?.children?.find((child) => child.type === ENVMAP)?.data;
  const reflection = extension?.children?.find((child) => child.type === REFLECTION)?.data;
  const envView = envMap ? new DataView(envMap.buffer, envMap.byteOffset, envMap.byteLength) : undefined;
  const reflView = reflection
    ? new DataView(reflection.buffer, reflection.byteOffset, reflection.byteLength)
    : undefined;
  // A zero is the author saying "this part does not reflect" — retuning it would ADD reflection.
  const hasEnv = envView !== undefined && envView.getFloat32(ENVMAP_COEFFICIENT_OFFSET, true) !== 0;
  const hasRefl = reflView !== undefined && reflView.getFloat32(REFLECTION_INTENSITY_OFFSET, true) !== 0;
  if (!hasEnv && !hasRefl) {
    return;
  }

  const texture = materialTexture(material);
  const matched = reference.byTexture.get(texture);
  const value = matched ?? reference.representative;
  let wrote = false;
  if (hasEnv && envView !== undefined && value.coefficient !== null) {
    envView.setFloat32(ENVMAP_COEFFICIENT_OFFSET, value.coefficient, true);
    summary.coefficients += 1;
    wrote = true;
  }
  if (hasRefl && reflView !== undefined && value.intensity !== null) {
    reflView.setFloat32(REFLECTION_INTENSITY_OFFSET, value.intensity, true);
    summary.intensities += 1;
    wrote = true;
  }
  if (wrote) {
    summary.patched += 1;
    summary.byTexture += matched === undefined ? 0 : 1;
  }
}

/** Read a null-terminated, lowercased string from raw chunk bytes. */
function readCString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);

  return new TextDecoder().decode(bytes.subarray(0, end === -1 ? bytes.length : end)).toLowerCase();
}

/**
 * Read the prototype's reflective materials via the engine parser (handles anti-rip-locked references):
 * per material with an env-map, its `coefficient` (+ optional reflection `intensity`), keyed by base texture
 * name, plus a representative (median) value for materials with no name match. Null when none are reflective.
 */
function readReflectionProfiles(bytes: Uint8Array): null | ReflectionProfiles {
  const clump = parseDff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const byTexture = new Map<string, ReflectionValue>();
  const coefficients: number[] = [];
  const intensities: number[] = [];
  for (const geometry of clump.geometries) {
    for (const material of geometry.materials) {
      const value = referenceValue(material);
      if (value === null) {
        continue;
      }
      if (value.coefficient !== null) {
        coefficients.push(value.coefficient);
      }
      if (value.intensity !== null) {
        intensities.push(value.intensity);
      }
      const texture = material.texture?.name?.toLowerCase();
      if (texture && !byTexture.has(texture)) {
        byTexture.set(texture, value);
      }
    }
  }
  if (coefficients.length === 0 && intensities.length === 0) {
    return null;
  }

  return {
    byTexture,
    representative: {
      coefficient: coefficients.length > 0 ? median(coefficients) : null,
      intensity: intensities.length > 0 ? median(intensities) : null,
    },
  };
}

/**
 * What one prototype material contributes to the reference, or null when it does not reflect at all. Zero on
 * either channel means "not reflective": it must not enter the median, or one matte part would drag the whole
 * target's shine down.
 */
function referenceValue(material: {
  effects?: { envMap?: { coefficient: number }; reflection?: { intensity: number } };
}): null | ReflectionValue {
  const coefficient = material.effects?.envMap?.coefficient ?? 0;
  const intensity = material.effects?.reflection?.intensity ?? 0;
  if (coefficient === 0 && intensity === 0) {
    return null;
  }

  return { coefficient: coefficient === 0 ? null : coefficient, intensity: intensity === 0 ? null : intensity };
}

function writeChunks(chunks: readonly MatChunk[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const chunk of chunks) {
    const body = chunk.children ? writeChunks(chunk.children) : (chunk.data ?? new Uint8Array(0));
    const header = new Uint8Array(HEADER_BYTES);
    const view = new DataView(header.buffer);
    view.setUint32(0, chunk.type, true);
    view.setUint32(4, body.length, true);
    view.setUint32(8, chunk.version, true);
    parts.push(header, body);
  }

  return concat(parts);
}
