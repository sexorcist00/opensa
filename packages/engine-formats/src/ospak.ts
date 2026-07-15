/**
 * `.ospak` — the archive (plan 074/02): a JSON manifest + one binary pak of 4 KiB-aligned entries. The runtime
 * reads RANGES only (Cache API / HTTP Range) — the pak is never whole in JS (the 073 memory lesson). Entry
 * hashes (FNV-1a) make converter re-runs incremental and delivery cache-friendly.
 */
import { fnv1a } from './binary';

export const OSPAK_VERSION = 1;
export const OSPAK_ALIGN = 4096;

export interface OspakEntry {
  /** Wire encoding of the stored bytes (074/10 A1): absent = raw payload. */
  enc?: OspakWireEnc;
  hash: number;
  length: number;
  offset: number;
  /** Decoded payload size when `enc` is set (progress/validation on the reader side). */
  rawLength?: number;
}

export interface OspakInput {
  bytes: Uint8Array;
  /** Wire encoding the producer applied to `bytes` (the reader inflates before use). */
  enc?: OspakWireEnc;
  key: string;
  kind: 'cell' | 'texture';
  /** Texture meta (required for kind 'texture'). */
  meta?: { format: number; height: number; layers: number; width: number };
  /** Decoded size of `bytes` when `enc` is set. */
  rawLength?: number;
}

export interface OspakManifest {
  /** Byte size of the pak file (sanity for range readers). */
  byteLength: number;
  /** Cell entries: `"x,y,hd"` / `"x,y,lod"` → range. */
  cells: Record<string, OspakEntry>;
  /** World-grid cell size (engine units) — key "cx,cy,…" → engine-space centre mapping for streaming. */
  cellSize: number;
  /** Cloud dome layer (074/06 row 15): SA weather id → texture key; textures are LOOSE RGBA files next to
   *  the manifest (lazy per-weather fetch — folding them into the pak is a later step). */
  clouds?: {
    textures: Record<string, { file: string; height: number; width: number }>;
    weathers: Record<string, string>;
  };
  /** Texture-array entries: `"array-<id>"` → range; meta mirrors the .ostex headers for scheduling. */
  textures: Record<string, OspakEntry & { format: number; height: number; layers: number; width: number }>;
  /** Raw `timecyc.dat` text (row 14) — the runtime samples it with the same renderware parser as prod. */
  timecyc?: string;
  /** True when `timecyc` is already the 24-hour variant (`timecyc_24h.dat`). */
  timecyc24?: boolean;
  /** UV-scroll animations (B7·c / plan 074/18): the whole map's UVAnimDict entries, de-duped by name in
   *  encounter order. A cell's kind-4 objectTable entry stores an INDEX into this array; the runtime advances
   *  them globally in sync (SA's dict names are global identifiers) and feeds each visible scroller its
   *  current transform. Absent when no converted model carries the plugin. */
  uvAnimations?: OspakUvAnimation[];
  version: number;
  /** Water mesh (074/06 row 12 v2): a LOOSE binary next to the manifest — tessellated water.dat polygons
   *  with the baked per-vertex shore-distance field ([u32 V][u32 I][f32×4 × V: x,y,z,shore][u32 × I]). */
  water?: { file: string; indexCount: number; vertexCount: number };
}

/**
 * One UV-scroll animation from a DFF UVAnimDict (B7·c / plan 074/18). Stored verbatim from the parser so the
 * runtime lerp matches prod exactly: keyframe `uv` params are `[rotation, scaleX, scaleY, skew, tX, tY]`
 * (only translate/scale are consumed by known SA assets). Global by `name` — every material referencing it,
 * in any cell, scrolls together.
 */
export interface OspakUvAnimation {
  /** Loop duration in seconds. */
  duration: number;
  keyframes: { time: number; uv: number[] }[];
  /** Dict-entry name the objectTable slot resolves to. */
  name: string;
}

/** Wire encodings a pak entry can carry (074/10 A1 / 074/14 stage 2). */
export type OspakWireEnc = 'deflate-raw' | 'oswire-deflate-raw';

/** Assemble a pak deterministically: entries sorted by key, 4 KiB aligned, zero-padded. */
export function buildOspak(
  inputs: readonly OspakInput[],
  options: {
    cellSize?: number;
    timecyc?: string;
    timecyc24?: boolean;
    uvAnimations?: OspakUvAnimation[];
  } = {},
): { manifest: OspakManifest; pak: Uint8Array } {
  const sorted = [...inputs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const cells: OspakManifest['cells'] = {};
  const textures: OspakManifest['textures'] = {};
  let offset = 0;
  const spans: { bytes: Uint8Array; offset: number }[] = [];
  for (const input of sorted) {
    const entry: OspakEntry = {
      ...(input.enc !== undefined ? { enc: input.enc, rawLength: input.rawLength ?? 0 } : {}),
      hash: fnv1a(input.bytes),
      length: input.bytes.byteLength,
      offset,
    };
    if (input.kind === 'cell') {
      if (cells[input.key]) {
        throw new Error(`duplicate cell key ${input.key}`);
      }
      cells[input.key] = entry;
    } else {
      if (!input.meta) {
        throw new Error(`texture entry ${input.key} missing meta`);
      }
      if (textures[input.key]) {
        throw new Error(`duplicate texture key ${input.key}`);
      }
      textures[input.key] = { ...entry, ...input.meta };
    }
    spans.push({ bytes: input.bytes, offset });
    offset += Math.ceil(input.bytes.byteLength / OSPAK_ALIGN) * OSPAK_ALIGN;
  }
  const pak = new Uint8Array(offset);
  for (const span of spans) {
    pak.set(span.bytes, span.offset);
  }

  return {
    manifest: {
      byteLength: pak.byteLength,
      cells,
      cellSize: options.cellSize ?? 250,
      textures,
      ...(options.timecyc !== undefined ? { timecyc: options.timecyc, timecyc24: options.timecyc24 ?? false } : {}),
      ...(options.uvAnimations !== undefined && options.uvAnimations.length > 0
        ? { uvAnimations: options.uvAnimations }
        : {}),
      version: OSPAK_VERSION,
    },
    pak,
  };
}

/** Validate a manifest a runtime just fetched (shape + version + range sanity). Throws with specifics. */
export function validateOspakManifest(manifest: OspakManifest): void {
  if (manifest.version !== OSPAK_VERSION) {
    throw new Error(`unsupported .ospak manifest version ${manifest.version} (reader supports ${OSPAK_VERSION})`);
  }
  const all: [string, OspakEntry][] = [...Object.entries(manifest.cells), ...Object.entries(manifest.textures)];
  for (const [key, entry] of all) {
    if (entry.offset % OSPAK_ALIGN !== 0) {
      throw new Error(`entry ${key} offset ${entry.offset} not ${OSPAK_ALIGN}-aligned`);
    }
    if (entry.offset + entry.length > manifest.byteLength) {
      throw new Error(`entry ${key} range overruns pak (${entry.offset}+${entry.length}>${manifest.byteLength})`);
    }
  }
}
