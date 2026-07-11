/**
 * `.ospak` — the archive (plan 074/02): a JSON manifest + one binary pak of 4 KiB-aligned entries. The runtime
 * reads RANGES only (Cache API / HTTP Range) — the pak is never whole in JS (the 073 memory lesson). Entry
 * hashes (FNV-1a) make converter re-runs incremental and delivery cache-friendly.
 */
import { fnv1a } from './binary';

export const OSPAK_VERSION = 1;
export const OSPAK_ALIGN = 4096;

export interface OspakEntry {
  hash: number;
  length: number;
  offset: number;
}

export interface OspakInput {
  bytes: Uint8Array;
  key: string;
  kind: 'cell' | 'texture';
  /** Texture meta (required for kind 'texture'). */
  meta?: { format: number; height: number; layers: number; width: number };
}

export interface OspakManifest {
  /** Byte size of the pak file (sanity for range readers). */
  byteLength: number;
  /** Cell entries: `"x,y,hd"` / `"x,y,lod"` → range. */
  cells: Record<string, OspakEntry>;
  /** Texture-array entries: `"array-<id>"` → range; meta mirrors the .ostex headers for scheduling. */
  textures: Record<string, OspakEntry & { format: number; height: number; layers: number; width: number }>;
  version: number;
}

/** Assemble a pak deterministically: entries sorted by key, 4 KiB aligned, zero-padded. */
export function buildOspak(inputs: readonly OspakInput[]): { manifest: OspakManifest; pak: Uint8Array } {
  const sorted = [...inputs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const cells: OspakManifest['cells'] = {};
  const textures: OspakManifest['textures'] = {};
  let offset = 0;
  const spans: { bytes: Uint8Array; offset: number }[] = [];
  for (const input of sorted) {
    const entry: OspakEntry = { hash: fnv1a(input.bytes), length: input.bytes.byteLength, offset };
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

  return { manifest: { byteLength: pak.byteLength, cells, textures, version: OSPAK_VERSION }, pak };
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
