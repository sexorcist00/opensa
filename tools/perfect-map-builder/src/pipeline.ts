import { parsePrelightInfo, type PrelightInfo } from '@opensa/lod-common/prelight';
/**
 * The perfect-map build pipeline (plan 001): chain every map tool via its Node API, each stage's output feeding the
 * next as a **complete** game dir (full passthrough), then split the common build into the `sa` (real game) and
 * `opensa` final LOD targets. Intermediate stages live under `<out>/.work` and are deleted as they're consumed —
 * unless `keepWork`/`until` is set, in which case every stage build is kept for step-by-step in-game debugging.
 */
import { buildProcobjLods } from '@opensa/lod-procobj-generator/build';
import { buildTreeLods } from '@opensa/lod-trees-generator/build';
import { parseOnlyList, runOptimizer } from '@opensa/map-optimizer/run';
import { SA_TREE_MODELS } from '@opensa/map-placement/vegetation';
import { install as installMods } from '@opensa/mod-installer/install';
import { buildOpensaLods } from '@opensa/opensa-lod-generator/build';
import { install as installPeds } from '@opensa/ped-installer/install';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseIde } from '@opensa/renderware/parsers/text/ide.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { buildSaLods } from '@opensa/sa-lod-generator/build';
import { editArchive } from '@opensa/tool-kit/archive/img';
import { install as installVehicles } from '@opensa/vehicle-installer/install';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BuilderConfig } from './config';

import { config as defaultConfig } from './config';

/**
 * Valid `--until <name>` values. Common-chain + `sa`/`opensa` stop after the named one; the special `lod` value
 * runs the whole pipeline (**both** sa + opensa) while keeping every intermediate for debugging.
 */
export const STAGE_NAMES = ['mods', 'vehicles', 'peds', 'optimize', 'trees', 'procobj', 'sa', 'opensa', 'lod'] as const;
export interface BuildPerfectMapOptions {
  config?: Partial<BuilderConfig>;
  /** Clean base game dir (`gta.dat` + `data/` + `models/`). */
  gamePath: string;
  /** mods-src root — one subfolder per stage (`mods/`, `vehicles/`, `peds/`, `vegetation/`, `procobj/`). */
  inPath: string;
  /** Keep all intermediate stage builds under `<out>/.work` (implied by `until`). */
  keepWork?: boolean;
  /** Output root; the builder creates `<out>/sa` and `<out>/opensa`. */
  outPath: string;
  /** Stop after this stage and keep every stage build (for step-by-step in-game debugging). */
  until?: StageName;
}

export interface BuildResult {
  /** Every produced stage build, in order (`{ name, dir }`) — testable full game dirs when kept. */
  produced: { dir: string; name: string }[];
  /** Whether the run stopped early at `until` (before the sa/opensa split). */
  stoppedEarly: boolean;
}

export type StageName = (typeof STAGE_NAMES)[number];

/** Run the pipeline (optionally up to `until`). Returns each produced stage build. */
export async function buildPerfectMap(options: BuildPerfectMapOptions): Promise<BuildResult> {
  const config = { ...defaultConfig, ...options.config };
  const { gamePath, inPath, outPath, until } = options;
  const { subfolders } = config;
  const keepWork = options.keepWork || until !== undefined;

  const work = join(outPath, '.work');
  rmSync(work, { force: true, recursive: true });
  mkdirSync(work, { recursive: true });

  const source = (sub: string): string => join(inPath, sub);
  const populated = (sub: string): boolean => existsSync(source(sub)) && readdirSync(source(sub)).length > 0;

  // The common chain (installers → optimizer → LODs). Conditional stages are skipped when their source is empty.
  const chain: { name: StageName; run: (game: string, out: string) => Promise<unknown> | void }[] = [
    {
      name: 'mods',
      run: (game, out) => installMods({ gamePath: game, inPath: source(subfolders.mods), outPath: out }),
    },
  ];
  if (populated(subfolders.vehicles)) {
    chain.push({
      name: 'vehicles',
      run: (game, out) => installVehicles({ gamePath: game, inPath: source(subfolders.vehicles), outPath: out }),
    });
  }
  if (populated(subfolders.peds)) {
    chain.push({
      name: 'peds',
      run: (game, out) => installPeds({ gamePath: game, inPath: source(subfolders.peds), outPath: out }),
    });
  }
  // map-optimizer prelight FORCE list (user decision, reversing the earlier only-mode): the statistical pass
  // corrects the whole map by default, and `broken-prelight.json` (mods-src root or the mods subfolder)
  // ADDITIONALLY forces the listed models past the skip-guards — see plan 019 iterations 5/6 for the formats.
  const prelitForce = loadPrelitOnly(inPath, source(subfolders.mods));
  chain.push({
    name: 'optimize',
    run: (game, out) =>
      runOptimizer({
        gameDir: game,
        outDir: out,
        passes: config.optimizerPasses,
        ...(prelitForce ? { prelitOptions: { force: prelitForce } } : {}),
      }),
  });
  chain.push({
    name: 'trees',
    run: (game, out) =>
      buildTreeLods({
        config: { textureSize: config.treeTex },
        gamePath: game,
        inPath: source(subfolders.vegetation),
        outPath: out,
        prelight: true,
        prelightInfo: loadPrelight(source(subfolders.vegetation)),
      }),
  });
  chain.push({
    name: 'procobj',
    run: (game, out) =>
      buildProcobjLods({
        config: { textureSize: config.procobjTex },
        gamePath: game,
        inPath: source(subfolders.procobj),
        outPath: out,
        prelight: true,
      }),
  });

  const staged = new Set(chain.map((stage) => stage.name));
  for (const name of ['vehicles', 'peds'] as const) {
    if (!staged.has(name)) {
      log(`${name} — skipped (${subfolders[name]}/ empty)`);
    }
  }

  const produced: { dir: string; name: string }[] = [];
  let game = gamePath;
  for (const [index, stage] of chain.entries()) {
    log(stage.name);
    const out = join(work, `${index + 1}-${stage.name}`);
    await stage.run(game, out);
    if (!keepWork && game !== gamePath) {
      rmSync(game, { force: true, recursive: true }); // consumed → free disk
    }
    game = out;
    produced.push({ dir: out, name: stage.name });
    if (until === stage.name) {
      return { produced, stoppedEarly: true }; // stop before the split; intermediates kept
    }
  }

  // Split: the common baked build (`game`) feeds both final LOD generators. `lod` runs BOTH (keeping every step).
  // lod-trees/lod-procobj already gave their models final LODs/impostors — hand those names to both generators as
  // `excludeItems` so neither re-processes them (double far-view geometry → streaming overload; see the LOD memories).
  // User-curated LOD exclusions (`lod-exclude.json` at the mods-src root or inside mods/): models that must
  // not enter the far LODs at all — e.g. HD street-furniture replacements (a 22k-tri ELECTRICA traffic light
  // placed 729× exploded the cell bake ~50×; at 300+ u it is a few unreadable pixels anyway).
  checkTextIplSlotBudget(game);

  const userExcluded = loadLodExclude(inPath, source(subfolders.mods));
  const excludeItems = [...collectGeneratedModels(game), ...userExcluded];
  log(
    `excluding ${excludeItems.length} models from sa/opensa LODs ` +
      `(${userExcluded.length} user-curated via lod-exclude.json)`,
  );
  if (until === undefined || until === 'sa' || until === 'lod') {
    const sa = join(outPath, 'sa');
    log('sa → sa/');
    buildSaLods({ config: { excludeItems }, gameDir: game, outDir: sa });
    checkImgIdBudgets(sa);
    produced.push({ dir: sa, name: 'sa' });
  }
  if (until === undefined || until === 'opensa' || until === 'lod') {
    const opensa = join(outPath, 'opensa');
    log('opensa → opensa/ (baking cells — can take several minutes)');
    await buildOpensaLods({
      cellSize: config.cellSize,
      config: { excludeItems },
      gameDir: game,
      outDir: opensa,
      stripLods: true,
    });
    swapLinearTxds(game, opensa);
    produced.push({ dir: opensa, name: 'opensa' });
  }
  // The sidecars are split-time inputs, not game content — keep the final targets clean.
  for (const target of produced.filter(({ name }) => name === 'sa' || name === 'opensa')) {
    rmSync(join(target.dir, 'linear-txd'), { force: true, recursive: true });
  }

  if (!keepWork) {
    rmSync(work, { force: true, recursive: true });
  }

  return { produced, stoppedEarly: until !== undefined };
}

/**
 * The HD + LOD model names (lowercased) that lod-trees/lod-procobj produced in the common build — the set the final
 * sa/opensa LOD generators must skip. Sourced from the generated data files: `lodtrees.ide` (tree impostor LODs) +
 * the tree HD roster, `lod_procobj.ide` (procobj LODs), `lod_procobj.models` (converted HD species — the HD
 * placement layer is binary streams now) and `lod_procobj.ipl` (legacy monolith builds).
 * Missing files (a stage that was skipped) contribute nothing.
 */
export function collectGeneratedModels(gameDir: string): string[] {
  const names = new Set<string>();
  const maps = join(gameDir, 'data', 'maps');
  const addIde = (rel: string): boolean => {
    const file = join(maps, rel);
    if (!existsSync(file)) {
      return false;
    }
    for (const def of parseIde(readFileSync(file, 'utf8'))) {
      names.add(def.modelName.toLowerCase());
    }

    return true;
  };
  const addIpl = (rel: string): void => {
    const file = join(maps, rel);
    if (existsSync(file)) {
      for (const inst of parseIpl(readFileSync(file, 'utf8'))) {
        names.add(inst.modelName.toLowerCase());
      }
    }
  };
  if (addIde('lodtrees.ide')) {
    for (const tree of SA_TREE_MODELS) {
      names.add(tree); // swapped HD trees — their impostors are the far-LOD, don't re-clone/re-bake the HD
    }
  }
  addIde('lod_procobj.ide');
  addIpl('lod_procobj.ipl'); // legacy monolith layout (pre-binary-streams builds)
  // Binary-streams layout: HD species live in `<area>_streamN.ipl` (id-only), so their names come from the
  // manifest convertProcObj writes alongside the area IPLs.
  const manifest = join(maps, 'lod_procobj.models');
  if (existsSync(manifest)) {
    for (const line of readFileSync(manifest, 'utf8').split(/\r?\n/)) {
      if (line.trim()) {
        names.add(line.trim().toLowerCase());
      }
    }
  }

  return [...names];
}

/**
 * Swap the linear-convention TXD sidecars (`<common build>/linear-txd/*.txd`) into the opensa target's
 * `gta3.img` (lod-trees plan 012): the common build's generated TXDs (impostor atlas, lod_procobj) are
 * encoded in the real-SA **gamma** convention — every bootable `.work` stage stays SA-correct — while
 * OpenSA's linear pipeline needs the linear encoding of the same texels. One placement, two texel codings.
 */
export function swapLinearTxds(commonDir: string, opensaDir: string): void {
  const sidecarDir = join(commonDir, 'linear-txd');
  if (!existsSync(sidecarDir)) {
    return;
  }
  const names = readdirSync(sidecarDir).filter((file) => file.toLowerCase().endsWith('.txd'));
  if (names.length === 0) {
    return;
  }
  const imgPath = join(opensaDir, 'models', 'gta3.img');
  const buffer = readFileSync(imgPath);
  const img = editArchive(openArchive(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)));
  for (const name of names) {
    const bytes = readFileSync(join(sidecarDir, name));
    img.set(name.toLowerCase(), new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  }
  writeFileSync(imgPath, img.build());
  log(`opensa: swapped ${names.length} linear-convention TXD(s) (${names.join(', ')})`);
}

/** SA's `IplEntityIndexArrays` usable capacity: one slot per gta.dat text IPL with inst rows, and the game
 *  writes past the array without a bounds check (the "ghost barriers" corruption family — lod-procobj plan
 *  007, lod-trees plan 011). The struct is declared 40 long, but a build with EXACTLY 40 crashed in-game on
 *  the 40th slot (perfect5) — treat 39 as the hard line. Stock uses 30 (mod-installer compacts int_cont +
 *  gen_int1 down to 28 and folds mod IPLs into a stock host); the generators add ~9 (`plobj*`, `plotr*`). */
const TEXT_IPL_SLOT_CAP = 39;

/** SA truncates building-pool indexes to **int16** in `IplDef::firstBuilding/lastBuilding`
 *  (`CIplStore::IncludeEntity`) — permanent text-IPL instances fill the pool's low indexes, and once they
 *  push streamed binary instances past index 32,767 the wrap corrupts CIplStore's stream-out ranges (the
 *  FINAL "ghost barriers" root cause; bisected to exactly 32,768 total rows). Cap at 30k to leave headroom
 *  for the runtime-resident binary instances that share the pool. */
const TEXT_ROW_CAP = 30000;

/** Fail the build when the baked game registers more inst-bearing text IPLs than SA can hold. */

/** FLA ID-pool budgets for the real-SA build — mirrors the operative FILE_TYPE_* values in the target
 *  install's fastman92limitAdjuster_GTASA.ini (TXD 6000, COL 275, IPL 280; stock pools: 5000/255/256).
 *  Each counts ARCHIVE FILES = ID slots. The margins leave room for SA's runtime slots (script/generic/
 *  ped-remap TXDs etc.) — exhausting a pool corrupts the heap during data load with a crash right after
 *  `shopping.dat` (field-diagnosed 2026-07: FILE_TYPE_IPL exhaustion; raising the ini fixed the boot). */
const IMG_ID_BUDGETS = [
  { ext: '.txd', label: 'TXD archives', limit: 6000, margin: 50 },
  { ext: '.col', label: 'COL archives', limit: 275, margin: 8 },
  { ext: '.ipl', label: 'binary IPL files', limit: 280, margin: 8 },
] as const;

/**
 * Fail the build when a real-SA ID pool is at (or within `margin` of) its cap — loud at build time instead of
 * heap corruption at boot. Counts every entry across the build's IMG archives.
 */
export function checkImgIdBudgets(gameDir: string): void {
  const names: string[] = [];
  for (const img of ['gta3.img', 'gta_int.img', 'player.img', 'cutscene.img']) {
    const path = join(gameDir, 'models', img);
    if (!existsSync(path)) {
      continue;
    }
    const buffer = readFileSync(path);
    const archive = openArchive(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    names.push(...archive.names.map((name) => name.toLowerCase()));
  }
  for (const budget of IMG_ID_BUDGETS) {
    const count = names.filter((name) => name.endsWith(budget.ext)).length;
    const message = `${budget.label}: ${count} of ${budget.limit} ID slots (margin ${budget.margin} for SA's runtime slots)`;
    if (count > budget.limit - budget.margin) {
      throw new Error(
        `real-SA ID pool nearly exhausted — ${message}. Raise the FLA limit in fastman92limitAdjuster_GTASA.ini ` +
          'or trim the build (the salod txdp partition is the biggest TXD consumer).',
      );
    }
    log(`  id budget — ${message}`);
  }
}

export function checkTextIplSlotBudget(gameDir: string): void {
  const datPath = join(gameDir, 'data', 'gta.dat');
  if (!existsSync(datPath)) {
    return;
  }
  const used: string[] = [];
  let totalRows = 0;
  for (const line of readFileSync(datPath, 'utf8').split(/\r?\n/)) {
    const match = /^IPL\s+(\S.*)$/i.exec(line.trim());
    if (!match || match[1].toLowerCase().endsWith('.zon')) {
      continue;
    }
    const file = join(gameDir, match[1].replace(/\\/g, '/'));
    const rows = existsSync(file) ? parseIpl(readFileSync(file, 'utf8')).length : 0;
    if (rows > 0) {
      used.push(match[1]);
      totalRows += rows;
    }
  }
  log(`text-IPL slots: ${used.length}/${TEXT_IPL_SLOT_CAP} (IplEntityIndexArrays), rows: ${totalRows}/${TEXT_ROW_CAP}`);
  if (totalRows > TEXT_ROW_CAP) {
    throw new Error(
      `${totalRows} permanent text-IPL rows exceed the ${TEXT_ROW_CAP} budget: SA stores building-pool ` +
        'indexes as int16 in IplDef (CIplStore::IncludeEntity) and permanent rows past ~32.7k corrupt ' +
        'stream-out ranges. Convert placements to binary streams (unlinked pairs) or cull.',
    );
  }
  if (used.length === TEXT_IPL_SLOT_CAP) {
    console.warn(
      '  ! zero slot headroom: any modloader mod adding a text IPL with inst rows will overflow ' +
        'IplEntityIndexArrays in-game',
    );
  }
  if (used.length > TEXT_IPL_SLOT_CAP) {
    throw new Error(
      `${used.length} text IPLs with inst rows exceed SA's ${TEXT_IPL_SLOT_CAP}-slot IplEntityIndexArrays ` +
        `(unbounded — overflowing corrupts CIplStore). Merge or drop mod IPLs:\n  ${used.join('\n  ')}`,
    );
  }
}

/** The first `lod-exclude.json` found among `dirs` → lowercased model names kept out of the LOD bakes. */
function loadLodExclude(...dirs: string[]): string[] {
  for (const dir of dirs) {
    const file = join(dir, 'lod-exclude.json');
    if (existsSync(file)) {
      const names = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
        throw new Error(`${file} must be a JSON array of model names`);
      }
      log(`lod-exclude — ${names.length} model(s) from ${file}`);

      return (names as string[]).map((name) => name.toLowerCase());
    }
  }

  return [];
}

/** Parse `<vegetation>/prelight.json` if present (per-model prelight-skip overrides), else undefined. */
function loadPrelight(vegetationDir: string): PrelightInfo | undefined {
  const file = join(vegetationDir, 'prelight.json');

  return existsSync(file) ? parsePrelightInfo(readFileSync(file, 'utf8')) : undefined;
}

/** The first `broken-prelight.json` found among `dirs` → the map-optimizer prelight FORCE list, else null. */
function loadPrelitOnly(...dirs: string[]): null | ReturnType<typeof parseOnlyList> {
  for (const dir of dirs) {
    const file = join(dir, 'broken-prelight.json');
    if (existsSync(file)) {
      log(`optimize — prelight force-list from ${file}`);

      return parseOnlyList(JSON.parse(readFileSync(file, 'utf8')));
    }
  }

  return null;
}

function log(message: string): void {
  console.log(`· ${message}`);
}
