import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readRw, RW_STRUCT, writeRw } from '@opensa/rw-codec/chunk';
import { collectGeometries } from '@opensa/rw-codec/dff';
import { decodeGeometryStruct, encodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';
import { argValue, fromCwd } from '@opensa/tool-kit/cli';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Asset } from '../../tools/map-optimizer/src/core/asset';

import { encodeDff } from '../../tools/map-optimizer/src/adapters/gta-sa/codec/dff';
import { clumpToIr } from '../../tools/map-optimizer/src/adapters/gta-sa/read';
import { loadCreaseOverrides } from '../../tools/map-optimizer/src/crease-overrides';
import { createDedupeFaces } from '../../tools/map-optimizer/src/plugins/dedupe-faces';
import { createRemoveDegenerateTriangles } from '../../tools/map-optimizer/src/plugins/degenerate-triangles';
import { createPruneVertices } from '../../tools/map-optimizer/src/plugins/prune-vertices';
import { createSmoothNormals } from '../../tools/map-optimizer/src/plugins/smooth-normals';
import { createWeldVertices } from '../../tools/map-optimizer/src/plugins/weld-vertices';
import { findArchivesWithEntry, patchImgEntry, readImgEntry } from '../lib/img-patch';

/**
 * Run ONE model through the map-optimizer GEOMETRY chain (weld → degenerate → dedupe → prune → smooth-normals,
 * exactly `optimizer.config.ts` + `run.ts`'s addNormals/crease wiring) in memory, print what changed per
 * geometry (flags / TRISTRIP / NORMALS / PRELIT / triangles / vertices / bytes), write the DFF, and optionally
 * patch it straight into a built tree's archives (`scripts/lib/img-patch.ts`, seconds — no rebuild). The
 * instrument for the normals × repeat-texture × SkyGfx question in `docs/open-issues/sa-lod-visibility-budget.md`
 * rounds 9–10.
 *
 * NOT replayed here: the world-context prelight passes (plan 019 level / seam / night) — they need a map-wide
 * pre-pass and moved 378 bytes of `cehollyhil06` without touching structure; the geometry chain is what
 * flips flags and re-encodes strips into lists.
 *
 * Variants (one build each, so a field A/B is one flag apart):
 *   (default)              the build's chain: addNormals ON — reproduces the shipped model
 *   --no-add-normals       the chain with normals creation off (what `--no-add-normals` builds ship)
 *   --strip-normals-after  the build's chain, THEN a chunk-level strip: NORMALS flag cleared, morph normals
 *                          dropped, everything else (trilist re-encode, split vertices) kept — separates "the
 *                          normals array" from "the strip→list re-encode", the question round 10 left open
 *   --raw                  the source bytes untouched (the clean control)
 *   --crease <deg>         crease override for the targets (default: the curated `crease-overrides.json`)
 *
 * Run:
 *   npx tsx scripts/debug/model-optimize.ts <model…> --src game-src/original [--patch build/bisect-nomods/sa]
 *       [--out build/model-lab] [--no-add-normals | --strip-normals-after | --raw] [--crease <deg>]
 * `--src` is any game dir whose archives hold the model's PRE-optimizer bytes (`game-src/original`, or a
 * `--exclude optimize` build such as `build/bisect-nomods-noopt/sa`). `--patch` appends into every archive
 * of that tree carrying the name; `img-patch.ts restore <model> --game <tree>` undoes it.
 */
const TRISTRIP = 0x01;
const PRELIT = 0x08;
const NORMALS = 0x10;
const LIGHT = 0x20;

interface GeometryRow {
  readonly bytes: number;
  readonly flags: number;
  readonly triangles: number;
  readonly vertices: number;
}

interface Options {
  readonly crease: number | undefined;
  readonly out: string;
  readonly patch: string | undefined;
  readonly src: string;
  readonly targets: readonly string[];
  readonly variant: Variant;
}

type Variant = 'chain' | 'no-add-normals' | 'raw' | 'strip-normals-after';

function describe(bytes: Uint8Array): GeometryRow[] {
  return collectGeometries(readRw(bytes).chunks).map((geometry) => {
    const struct = geometry.children?.find((child) => child.type === RW_STRUCT && child.data);
    if (!struct?.data) throw new Error('geometry without a Struct');
    const decoded = decodeGeometryStruct(struct.data);

    return {
      bytes: struct.data.length,
      flags: decoded.flags,
      triangles: decoded.numTriangles,
      vertices: decoded.numVertices,
    };
  });
}

function parseArgs(): Options {
  const src = argValue('--src');
  if (!src) throw new Error('need --src <game dir with the pre-optimizer archives>');
  const flagValues = new Set([argValue('--crease'), argValue('--out'), argValue('--patch'), src]);
  const targets = process.argv.slice(2).filter((arg) => !arg.startsWith('--') && !flagValues.has(arg));
  if (targets.length === 0) throw new Error('usage: model-optimize.ts <model…> --src <dir> [--patch <dir>] …');
  const flags = process.argv.filter((arg) => ['--no-add-normals', '--raw', '--strip-normals-after'].includes(arg));
  if (flags.length > 1) throw new Error(`pick one variant, not ${flags.join(' + ')}`);
  const variant: Variant =
    flags[0] === '--raw'
      ? 'raw'
      : flags[0] === '--no-add-normals'
        ? 'no-add-normals'
        : flags[0] === '--strip-normals-after'
          ? 'strip-normals-after'
          : 'chain';
  const creaseArg = argValue('--crease');
  const patch = argValue('--patch');

  return {
    crease: creaseArg === undefined ? undefined : Number(creaseArg),
    out: fromCwd(argValue('--out') ?? 'build/model-lab'),
    patch: patch === undefined ? undefined : fromCwd(patch),
    src: fromCwd(src),
    targets: targets.map((name) => name.toLowerCase()),
    variant,
  };
}

/** The build's geometry chain over one model's bytes; returns the re-encoded DFF (source when nothing moved). */
function runGeometryChain(
  name: string,
  source: Uint8Array,
  addNormals: boolean,
  crease: number | undefined,
): Uint8Array {
  const clump = parseDff(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer);
  const asset: Asset = { dirty: false, ir: clumpToIr(clump), log: [], meta: {}, name, source };
  const curated = loadCreaseOverrides();
  const creaseFor = (model: string): number | undefined => crease ?? curated?.get(model);
  const plugins = [
    createWeldVertices(),
    createRemoveDegenerateTriangles(),
    createDedupeFaces(),
    createPruneVertices(),
    createSmoothNormals({ addWhereAbsent: addNormals, creaseFor }),
  ];
  const context = { game: 'lab', log: (): void => undefined };
  for (const plugin of plugins) void plugin.transform(asset, context);

  return asset.dirty ? encodeDff(source, asset.ir) : source;
}

/** Chunk-level normals strip: clear the NORMALS flag and drop every morph target's normals array; nothing
 *  else in the file moves (the BinMeshPLG, split vertices and prelit stay as the chain left them). */
function stripNormals(bytes: Uint8Array): Uint8Array {
  const file = readRw(bytes);
  for (const geometry of collectGeometries(file.chunks)) {
    const struct = geometry.children?.find((child) => child.type === RW_STRUCT && child.data);
    if (!struct?.data) continue;
    const decoded = decodeGeometryStruct(struct.data);
    decoded.flags &= ~NORMALS;
    for (const morph of decoded.morphs) morph.normals = null;
    struct.data = encodeGeometryStruct(decoded);
  }

  return writeRw(file);
}

const flagWord = (flags: number): string =>
  `0x${flags.toString(16).padStart(5, '0')} ${flags & TRISTRIP ? 'STRIP' : 'LIST '} ${flags & NORMALS ? 'N' : '-'}${flags & PRELIT ? 'P' : '-'}${flags & LIGHT ? 'L' : '-'}`;

function main(): void {
  const options = parseArgs();
  mkdirSync(options.out, { recursive: true });
  for (const name of options.targets) {
    const archives = findArchivesWithEntry(options.src, `${name}.dff`);
    if (archives.length === 0) throw new Error(`${name}.dff is in no archive of ${options.src}`);
    // The last-registered archive is the one SA reads the model from.
    const source = readImgEntry(archives[archives.length - 1], `${name}.dff`);
    let result: Uint8Array;
    switch (options.variant) {
      case 'chain':
        result = runGeometryChain(name, source, true, options.crease);
        break;
      case 'no-add-normals':
        result = runGeometryChain(name, source, false, options.crease);
        break;
      case 'raw':
        result = source;
        break;
      case 'strip-normals-after':
        result = stripNormals(runGeometryChain(name, source, true, options.crease));
        break;
    }
    printDiff(`${name} [${options.variant}]`, source, result);
    const outPath = join(options.out, `${name}.${options.variant}.dff`);
    writeFileSync(outPath, result);
    console.log(`  → ${outPath}`);
    if (options.patch) {
      const targets = findArchivesWithEntry(options.patch, `${name}.dff`);
      if (targets.length === 0) throw new Error(`${name}.dff is in no archive of ${options.patch}`);
      for (const img of targets) {
        const { appendedAt } = patchImgEntry(img, `${name}.dff`, result);
        console.log(`  patched ${img} (appended at ${appendedAt})`);
      }
    }
  }
}

function printDiff(name: string, before: Uint8Array, after: Uint8Array): void {
  const from = describe(before);
  const to = describe(after);
  console.log(
    `${name}: ${before.length} → ${after.length} B, ${from.length} geometr${from.length === 1 ? 'y' : 'ies'}`,
  );
  from.forEach((a, i) => {
    const b = to[i] ?? a;
    console.log(
      `  [${i}] ${flagWord(a.flags)} → ${flagWord(b.flags)}  tris ${a.triangles} → ${b.triangles}  verts ${a.vertices} → ${b.vertices}  struct ${a.bytes} → ${b.bytes} B`,
    );
  });
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
