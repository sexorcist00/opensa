import { parsePrelightInfo, type PrelightInfo } from '@opensa/lod-common/prelight';
/**
 * The perfect-map build pipeline (plan 001): chain every map tool via its Node API, each stage's output feeding the
 * next as a **complete** game dir (full passthrough), then split the common build into the `sa` (real game) and
 * `opensa` final LOD targets. Intermediate stages live under `<out>/.work` and are deleted as they're consumed —
 * unless `keepWork`/`until` is set, in which case every stage build is kept for step-by-step in-game debugging.
 */
import { buildProcobjLods } from '@opensa/lod-procobj-generator/build';
import { buildTreeLods } from '@opensa/lod-trees-generator/build';
import { runOptimizer } from '@opensa/map-optimizer/run';
import { SA_TREE_MODELS } from '@opensa/map-placement/vegetation';
import { install as installMods } from '@opensa/mod-installer/install';
import { buildOpensaLods } from '@opensa/opensa-lod-generator/build';
import { install as installPeds } from '@opensa/ped-installer/install';
import { parseIde } from '@opensa/renderware/parsers/text/ide.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { buildSaLods } from '@opensa/sa-lod-generator/build';
import { install as installVehicles } from '@opensa/vehicle-installer/install';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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

type PrelitOnly = NonNullable<NonNullable<Parameters<typeof runOptimizer>[0]['prelitOptions']>['only']>;

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
  // map-optimizer prelight ONLY-mode: a `broken-prelight.json` at the mods-src root (or inside the mods
  // subfolder) is the curated list — see map-optimizer plan 019 iteration 5/6 for the entry formats.
  const prelitOnly = loadPrelitOnly(inPath, source(subfolders.mods));
  chain.push({
    name: 'optimize',
    run: (game, out) =>
      runOptimizer({
        gameDir: game,
        outDir: out,
        passes: config.optimizerPasses,
        ...(prelitOnly ? { prelitOptions: { only: prelitOnly } } : {}),
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
  const excludeItems = collectGeneratedModels(game);
  log(`excluding ${excludeItems.length} sibling-generated HD/LOD models from sa/opensa`);
  if (until === undefined || until === 'sa' || until === 'lod') {
    const sa = join(outPath, 'sa');
    log('sa → sa/');
    buildSaLods({ config: { excludeItems }, gameDir: game, outDir: sa });
    produced.push({ dir: sa, name: 'sa' });
  }
  if (until === undefined || until === 'opensa' || until === 'lod') {
    const opensa = join(outPath, 'opensa');
    log('opensa → opensa/ (baking cells — can take several minutes)');
    buildOpensaLods({
      cellSize: config.cellSize,
      config: { excludeItems },
      gameDir: game,
      outDir: opensa,
      stripLods: true,
    });
    produced.push({ dir: opensa, name: 'opensa' });
  }

  if (!keepWork) {
    rmSync(work, { force: true, recursive: true });
  }

  return { produced, stoppedEarly: until !== undefined };
}

/**
 * The HD + LOD model names (lowercased) that lod-trees/lod-procobj produced in the common build — the set the final
 * sa/opensa LOD generators must skip. Sourced from the generated data files: `lodtrees.ide` (tree impostor LODs) +
 * the tree HD roster, `lod_procobj.ide` (procobj LODs) and `lod_procobj.ipl` (its HD species + LOD placements).
 * Missing files (a stage that was skipped) contribute nothing.
 */
function collectGeneratedModels(gameDir: string): string[] {
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
  addIpl('lod_procobj.ipl');

  return [...names];
}

/** Parse `<vegetation>/prelight.json` if present (per-model prelight-skip overrides), else undefined. */
function loadPrelight(vegetationDir: string): PrelightInfo | undefined {
  const file = join(vegetationDir, 'prelight.json');

  return existsSync(file) ? parsePrelightInfo(readFileSync(file, 'utf8')) : undefined;
}

/** The first `broken-prelight.json` found among `dirs` → map-optimizer prelight ONLY-mode list, else null. */
function loadPrelitOnly(...dirs: string[]): null | PrelitOnly {
  for (const dir of dirs) {
    const file = join(dir, 'broken-prelight.json');
    if (existsSync(file)) {
      log(`optimize — prelight ONLY-mode from ${file}`);

      return JSON.parse(readFileSync(file, 'utf8')) as PrelitOnly;
    }
  }

  return null;
}

function log(message: string): void {
  console.log(`· ${message}`);
}
