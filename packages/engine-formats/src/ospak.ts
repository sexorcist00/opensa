/**
 * `.ospak` — the archive (plan 074/02): a JSON manifest + one binary pak of 4 KiB-aligned entries. The runtime
 * reads RANGES only (Cache API / HTTP Range) — the pak is never whole in JS (the 073 memory lesson). Entry
 * hashes (FNV-1a) make converter re-runs incremental and delivery cache-friendly.
 */
import { fnv1a } from './binary';

export const OSPAK_VERSION = 1;
export const OSPAK_ALIGN = 4096;

/**
 * A cell's range plus the texture arrays it needs.
 *
 * `textures` is what makes per-ring texture laziness possible: without it the runtime cannot know which
 * arrays a cell will bind until it has decoded the cell, so the only safe policy was "upload every array in
 * the district before the first cell". With it, the driver loads an array when the first cell that draws
 * with it streams in, and releases it when the last one leaves.
 *
 * **Measured, and smaller than it sounds** (003 phase 4, whole-map convert): a focus keeps a median 84 % of
 * the district's texture bytes resident, because the planner packs arrays GLOBALLY — 17 of 99 arrays are
 * touched by more than a quarter of all cells. Laziness cannot evict a map-wide atlas. The lever for real
 * residency is spatial locality in `TexturePlanner`, not the loading policy.
 *
 * Absent on paks built before this field existed — the runtime then falls back to the eager policy, so old
 * paks keep working unchanged.
 */
export interface OspakCellEntry extends OspakEntry {
  textures?: number[];
}

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
  /** Texture-array refs this CELL draws with (kind 'cell') — see {@link OspakCellEntry.textures}. */
  textures?: number[];
}

export interface OspakManifest {
  /** Wall-clock build time stamped by opensa-pack (`HH:mm DD-MM-YYYY`, local) — shown in the debugger so the
   *  running pak version is visible at a glance. Absent for a pak built before the field existed. It makes
   *  `manifest.json` non-reproducible by design (the pak `world.ospak` stays byte-identical). */
  buildTime?: string;
  /** Byte size of the pak file (sanity for range readers). */
  byteLength: number;
  /** Cell entries: `"x,y,hd"` / `"x,y,lod"` → range + the texture arrays the cell draws with. */
  cells: Record<string, OspakCellEntry>;
  /** World-grid cell size (engine units) — key "cx,cy,…" → engine-space centre mapping for streaming. */
  cellSize: number;
  /** Colour stand-in layers the planner minted for MISSING textures (plan 085 row B): 4×4 RGBA8 layers the
   *  runtime can repaint magenta when the missing-texture highlight is on. `color` is the PACKED texel, so
   *  toggling off restores the quiet material colour without re-fetching the array. Absent when the whole
   *  map resolved. */
  missingLayers?: { array: number; color: [number, number, number, number]; layer: number }[];
  /** Texture-array entries: `"array-<id>"` → range; meta mirrors the .ostex headers for scheduling. */
  textures: Record<string, OspakEntry & { format: number; height: number; layers: number; width: number }>;
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
    missingLayers?: OspakManifest['missingLayers'];
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
      addCell(cells, input, entry);
    } else {
      addTexture(textures, input, entry);
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
      ...(options.missingLayers !== undefined && options.missingLayers.length > 0
        ? { missingLayers: options.missingLayers }
        : {}),
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

/** One cell entry: its range plus the de-duplicated, sorted refs of the arrays it draws with. */
function addCell(cells: OspakManifest['cells'], input: OspakInput, entry: OspakEntry): void {
  if (cells[input.key]) {
    throw new Error(`duplicate cell key ${input.key}`);
  }
  cells[input.key] = {
    ...entry,
    ...(input.textures !== undefined ? { textures: [...new Set(input.textures)].sort((a, b) => a - b) } : {}),
  };
}

/** One texture entry: its range plus the `.ostex` header meta the runtime schedules uploads with. */
function addTexture(textures: OspakManifest['textures'], input: OspakInput, entry: OspakEntry): void {
  if (!input.meta) {
    throw new Error(`texture entry ${input.key} missing meta`);
  }
  if (textures[input.key]) {
    throw new Error(`duplicate texture key ${input.key}`);
  }
  textures[input.key] = { ...entry, ...input.meta };
}
