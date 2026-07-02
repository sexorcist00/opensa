import type { TextureSource } from '@opensa/lod-common/texture-source';
import type { IplTransform } from '@opensa/map-placement/ipl-text-retransform';

import { createBudgetedDecimate } from '@opensa/lod-common/budgeted-decimate';
import { buildClumpMesh } from '@opensa/lod-common/build-mesh';
import { collectClumpEffects } from '@opensa/lod-common/clump-effects';
import { encodeLodDff } from '@opensa/lod-common/encode-dff';
import { encodeHalvedTxd } from '@opensa/lod-common/encode-txd';
import { lodView } from '@opensa/lod-common/view';
import { patchGtaDat } from '@opensa/map-placement/ide';
import { retransformTextIpl } from '@opensa/map-placement/ipl-text-retransform';
import { editIdeTxd } from '@opensa/map-placement/retxd';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { build2dfxSection, stripParticleEffects } from '@opensa/rw-codec/dff';
import { editArchive } from '@opensa/tool-kit/archive/img';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LodLink } from '../../core/types';
import type { Archives } from './io';

import { perObjectLinks } from '../../core/report';
import { fillMissingLods } from './fill-holes';
import { areaKey, walk } from './resolve';

export interface BuildInput {
  archives: Archives;
  /** Budget-checked QEM for the clones (mean pixel-diff fraction per model); 0 = pure verbatim clones. */
  decimateBudget: number;
  gameDir: string;
  /** Power-of-two downscale steps for the clone TXDs (1 = ½ each side; from `texScale`). */
  halvings: number;
  /** Draw distance for the generated hole-fill LODs (plan 003). */
  holeLodDraw: number;
  /** Curated HD models (lowercased) with no LOD to give a generated far-LOD (plan 003). */
  holeModels: ReadonlySet<string>;
  links: readonly LodLink[];
  outDir: string;
  source: TextureSource;
}

export interface BuildStats {
  clonedLods: number;
  /** Clones that took the decimated mesh path (within the pixel budget); the rest stay verbatim byte-copies. */
  decimatedLods: number;
  filledHoles: number;
  filledInstances: number;
  generatedTxds: number;
  missingHd: number;
  missingTxd: number;
  /** Textures moved into the shared `salodpar.txd` txdp parent (used by ≥ 2 source atlases). */
  parentTextures: number;
  retransformedLods: number;
  skippedHoles: number;
  skippedShared: number;
}

/**
 * The clone TXD name for a source HD atlas, generating + packing it (`texScale` DXT, deduped) on first use —
 * the hole-fill path (atlases the Phase-1 partition didn't cover get a full standalone TXD, no txdp line).
 * Returns `null` if the source TXD is missing.
 */
export function ensureCloneTxd(
  hdTxd: string,
  input: BuildInput,
  img: ReturnType<typeof editArchive>,
  hdTxdToClone: Map<string, string>,
): null | string {
  const existing = hdTxdToClone.get(hdTxd);
  if (existing) {
    return existing;
  }
  const bytes = hdTxd ? input.archives.get(`${hdTxd}.txd`) : null;
  if (!bytes) {
    return null; // no source atlas → the LOD it would serve stays stock
  }
  const names = parseTxd(bytes).textures.map((texture) => texture.name);
  const cloneName = `salod${String(hdTxdToClone.size).padStart(4, '0')}`;
  img.set(`${cloneName}.txd`, encodeHalvedTxd(names, input.source, input.halvings));
  hdTxdToClone.set(hdTxd, cloneName);

  return cloneName;
}

/**
 * Emit the drop-in Phase-1 build (plan 002): mirror `gameDir` → `outDir`, then in the copied `models/gta3.img`
 * replace each **per-object** LOD's `.dff` with its HD model's bytes **verbatim** (no re-encode — a known-good SA
 * clone, no format-gotcha risk — or a budget-decimated re-encode, see {@link cloneLodDff}) and add the
 * `txdp`-partitioned clone TXDs (plan 006: one shared `salodpar.txd` parent + a slim `salodNNNN` child per
 * source atlas, DXT + mips at `texScale`). Finally retarget those LODs' IDE `txd` column to the clone TXD and
 * register the `txdp` IDE. Ids, names and every IPL `lod` link are left untouched, so the map linkage never
 * moves. Shared (multi-HD) LODs are left stock — Phase 1 covers only the 1:1 majority.
 */
export function writeBuild(input: BuildInput): BuildStats {
  const perObject = perObjectLinks(input.links);
  const skippedShared = distinctLods(input.links) - distinctLods(perObject);

  cpSync(input.gameDir, input.outDir, { force: true, recursive: true });
  const img = editArchive(input.archives.gta3);

  const { hdTxdToClone, parentTextures } = packCloneTxds(perObject, input, img);
  const txdpChildren = [...hdTxdToClone.values()]; // partitioned children — hole-fill atlases added later are full TXDs
  const modelToTxd = new Map<string, string>();
  const stats: BuildStats = {
    clonedLods: 0,
    decimatedLods: 0,
    filledHoles: 0,
    filledInstances: 0,
    generatedTxds: hdTxdToClone.size,
    missingHd: 0,
    missingTxd: 0,
    parentTextures,
    retransformedLods: 0,
    skippedHoles: 0,
    skippedShared,
  };
  const decimate = input.decimateBudget > 0 ? createBudgetedDecimate({ pixelBudget: input.decimateBudget }) : null;
  for (const link of perObject) {
    const cloneTxd = hdTxdToClone.get(link.hdTxd);
    if (!cloneTxd) {
      stats.missingTxd += 1; // no usable HD atlas → leave the stock LOD intact
      continue;
    }
    const hdDff = input.archives.get(`${link.hdModel}.dff`);
    if (!hdDff) {
      stats.missingHd += 1;
      continue;
    }
    img.set(`${link.lodModel}.dff`, cloneLodDff(new Uint8Array(hdDff), link, decimate, input.source, stats));
    modelToTxd.set(link.lodModel, cloneTxd);
    stats.clonedLods += 1;
  }

  // Phase 2 (plan 003): generate a far-LOD for curated HD-without-LOD models — shares the img editor + TXD dedup,
  // and appends to the copied text IPLs before they're re-read by the Phase-1 transform retarget below.
  if (input.holeModels.size > 0) {
    const fill = fillMissingLods({
      archives: input.archives,
      ensureTxd: (hdTxd) => ensureCloneTxd(hdTxd, input, img, hdTxdToClone),
      holeLodDraw: input.holeLodDraw,
      models: input.holeModels,
      outDataDir: join(input.outDir, 'data'),
      setImg: (name, bytes) => img.set(name, bytes),
    });
    stats.filledHoles = fill.filled;
    stats.filledInstances = fill.appended;
    stats.skippedHoles = fill.skipped;
  }
  stats.generatedTxds = hdTxdToClone.size;

  writeFileSync(join(input.outDir, 'models', 'gta3.img'), img.build());
  retargetIdes(input.outDir, modelToTxd);
  if (parentTextures > 0) {
    writeTxdpIde(input.outDir, txdpChildren);
  }
  stats.retransformedLods = retargetLodTransforms(input, new Set(modelToTxd.keys()));

  return stats;
}

/**
 * One clone's DFF bytes (plan 003, Phase 5). With a decimator, the HD mesh is QEM-decimated under the pixel
 * budget and re-encoded — night prelit and tinted materials ride the mesh path, and the HD's 2dfx entries
 * (coronas etc., minus particles) are transplanted byte-for-byte with frame-transformed positions. When the
 * budget rejects every target (or decimation is off), the clone stays the **verbatim byte-copy** — keeping
 * plugins the mesh path can't carry (e.g. breakable) at zero risk.
 */
function cloneLodDff(
  hdDff: Uint8Array,
  link: LodLink,
  decimate: null | ReturnType<typeof createBudgetedDecimate>,
  textures: TextureSource,
  stats: BuildStats,
): Uint8Array {
  if (decimate) {
    const clump = parseDff(toArrayBuffer(hdDff));
    const mesh = buildClumpMesh(clump);
    const ctx = { textures, view: lodView(link.hdDrawDistance || 300) };
    const decimated = decimate(mesh, ctx);
    if (decimated !== mesh) {
      stats.decimatedLods += 1;
      const effects = build2dfxSection(collectClumpEffects(hdDff, clump));

      return encodeLodDff(decimated, link.lodModel, { ...(effects ? { effects } : {}) });
    }
  }

  return stripParticleEffects(hdDff);
}

/** Distinct LOD models across the given links. */
function distinctLods(links: readonly LodLink[]): number {
  return new Set(links.map((link) => link.lodModel)).size;
}

/** The shared `txdp` parent dictionary every partitioned clone TXD points at (plan 006). */
export const PARENT_TXD = 'salodpar';

/**
 * Partition the clone atlases' texture names for the `txdp` parent scheme (plan 006): a name used by **≥ 2**
 * atlases goes to the shared parent; the rest stay in their child. Safe by construction — the build's
 * {@link TextureSource} is name-keyed ("first TXD wins"), so every clone TXD already receives identical pixels
 * for a given name; the parent changes packaging, not pixels.
 */
export function partitionCloneTextures(atlasNames: ReadonlyMap<string, readonly string[]>): {
  perAtlasUnique: Map<string, string[]>;
  shared: string[];
} {
  const counts = new Map<string, number>();
  for (const names of atlasNames.values()) {
    for (const name of new Set(names)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const shared = new Set([...counts].filter(([, count]) => count >= 2).map(([name]) => name));
  const perAtlasUnique = new Map<string, string[]>();
  for (const [atlas, names] of atlasNames) {
    perAtlasUnique.set(atlas, [...new Set(names)].filter((name) => !shared.has(name)).sort());
  }

  return { perAtlasUnique, shared: [...shared].sort() };
}

/**
 * The clone TXDs, `txdp`-partitioned (plan 006): one shared `salodpar.txd` for every texture used by ≥ 2 source
 * atlases + one slim `salodNNNN` child per atlas holding only its unique textures (a child may be empty — it
 * must still exist for the game to bind, and the parent chain supplies the rest). Returns `hdTxd → child name`
 * and the shared-texture count for the stats/report.
 */
function packCloneTxds(
  perObject: readonly LodLink[],
  input: BuildInput,
  img: ReturnType<typeof editArchive>,
): { hdTxdToClone: Map<string, string>; parentTextures: number } {
  const atlasNames = new Map<string, string[]>();
  for (const hdTxd of [...new Set(perObject.map((link) => link.hdTxd))].sort()) {
    const bytes = hdTxd ? input.archives.get(`${hdTxd}.txd`) : null;
    if (!bytes) {
      continue; // no source atlas → the LODs it would serve stay stock (counted as missingTxd per link)
    }
    try {
      atlasNames.set(
        hdTxd,
        parseTxd(bytes).textures.map((texture) => texture.name.toLowerCase()),
      );
    } catch {
      // unreadable atlas — same as missing
    }
  }

  const { perAtlasUnique, shared } = partitionCloneTextures(atlasNames);
  if (shared.length > 0) {
    img.set(`${PARENT_TXD}.txd`, encodeHalvedTxd(shared, input.source, input.halvings));
  }
  const hdTxdToClone = new Map<string, string>();
  for (const [hdTxd, unique] of perAtlasUnique) {
    const cloneName = `salod${String(hdTxdToClone.size).padStart(4, '0')}`;
    img.set(`${cloneName}.txd`, encodeHalvedTxd(unique, input.source, input.halvings));
    hdTxdToClone.set(hdTxd, cloneName);
  }

  return { hdTxdToClone, parentTextures: shared.length };
}

/** Retarget every IDE `txd` column of a cloned LOD to its clone TXD (drop-in — no other IDE/IPL change). */
function retargetIdes(outDir: string, modelToTxd: ReadonlyMap<string, string>): void {
  if (modelToTxd.size === 0) {
    return;
  }
  for (const file of walk(join(outDir, 'data')).filter((path) => path.toLowerCase().endsWith('.ide'))) {
    const result = editIdeTxd(readFileSync(file, 'utf8'), modelToTxd);
    if (result.changed) {
      writeFileSync(file, result.text);
    }
  }
}

/**
 * A clone LOD is now its HD's geometry, so its instance must sit under the **HD instance's** transform — the stock
 * LOD instance's rotation/position compensated for the stock LOD's differently-baked local frame and would skew the
 * clone (see the `ipl-lod-index-coupling` memory: the pointed-to LOD instance always lives in a **text** IPL, so
 * only text IPLs are rewritten). For every cloned LOD instance, copy its owning HD instance's transform — from the
 * same text file (text HD) or the area's binary streams (binary HD → companion text). Returns the rows rewritten.
 */
function retargetLodTransforms(input: BuildInput, clonedLods: ReadonlySet<string>): number {
  const areas = new Map<string, { file: string; instances: ReturnType<typeof parseIpl> }>();
  for (const file of walk(join(input.outDir, 'data'))) {
    if (!file.toLowerCase().endsWith('.ipl') || /[/\\]interior[/\\]/i.test(file)) {
      continue;
    }
    areas.set(areaKey(file), { file, instances: parseIpl(readFileSync(file, 'utf8')) });
  }

  const perFile = new Map<string, Map<number, IplTransform>>();
  const record = (file: string, lodRow: number, transform: IplTransform): void => {
    const map = perFile.get(file) ?? new Map<number, IplTransform>();
    map.set(lodRow, transform);
    perFile.set(file, map);
  };
  for (const { file, instances } of areas.values()) {
    instances.forEach((inst) => {
      const lod = instances[inst.lod];
      if (inst.lod >= 0 && inst.lod < instances.length && clonedLods.has(lod.modelName.toLowerCase())) {
        record(file, inst.lod, { pos: inst.position, rot: inst.rotation });
      }
    });
  }
  for (const name of input.archives.gta3.names) {
    const area = name.endsWith('.ipl') ? areas.get(areaKey(name)) : undefined;
    const buffer = area ? input.archives.gta3.get(name) : null;
    if (!area || !buffer) {
      continue;
    }
    for (const inst of parseBinaryIpl(buffer)) {
      const lod = area.instances[inst.lod];
      if (inst.lod >= 0 && inst.lod < area.instances.length && clonedLods.has(lod.modelName.toLowerCase())) {
        record(area.file, inst.lod, { pos: inst.position, rot: inst.rotation });
      }
    }
  }

  let rewritten = 0;
  for (const [file, transforms] of perFile) {
    const result = retransformTextIpl(readFileSync(file, 'utf8'), transforms);
    if (result.changed) {
      writeFileSync(file, result.text);
      rewritten += transforms.size;
    }
  }

  return rewritten;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Write the `txdp` IDE (child → parent per clone TXD) and register it in `gta.dat` before the first IPL. */
function writeTxdpIde(outDir: string, children: readonly string[]): void {
  if (children.length === 0) {
    return;
  }
  const rel = join('maps', 'salod-txdp.ide');
  const rows = children.map((child) => `${child}, ${PARENT_TXD}`);
  writeFileSync(join(outDir, 'data', rel), `txdp\n${rows.join('\n')}\nend\n`);
  const datPath = join(outDir, 'data', 'gta.dat');
  writeFileSync(datPath, patchGtaDat(readFileSync(datPath, 'utf8'), 'DATA\\MAPS\\salod-txdp.ide'));
}
