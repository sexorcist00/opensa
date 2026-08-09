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
import { packGameDir } from '@opensa/opensa-pack/pack';
import { install as installPeds } from '@opensa/ped-installer/install';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseIde } from '@opensa/renderware/parsers/text/ide.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { buildSaLods } from '@opensa/sa-lod-generator/build';
import { editArchive } from '@opensa/tool-kit/archive/img';
import { type BuildTarget } from '@opensa/tool-kit/target';
import { install as installVehicles } from '@opensa/vehicle-installer/install';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import type { BuilderConfig } from './config';

import { config as defaultConfig, PACK_RECTS } from './config';

/**
 * Valid `--until <name>` values. Common-chain + `sa`/`opensa` stop after the named one; the special `lod` value
 * runs the whole pipeline (**both** sa + opensa) while keeping every intermediate for debugging.
 */
export const STAGE_NAMES = [
  'mods',
  'vehicles',
  'peds',
  'optimize',
  'trees',
  'procobj',
  'sa',
  'opensa',
  'pack',
  'lod',
] as const;

/**
 * The stages `--exclude` accepts — every real one. `lod` is not a stage but an `--until` alias for "run both
 * targets", so excluding it would name nothing.
 */
export const EXCLUDABLE_STAGES = STAGE_NAMES.filter((name): name is ExcludableStage => name !== 'lod');

/**
 * What the `opensa` target gets in place of SA's ceilings — today, an announcement that it has none. Our
 * engine has no building pool, no int16 `IplDef` index and no `IplEntityIndexArrays`, so
 * {@link checkTextIplBudgets} does not run here; what replaces it is a STREAMING budget whose number does not
 * exist yet (07/04 decisions 4–5 — it has to be measured in our engine, and a cap taken from SA's numbers
 * would be a guess wearing a measurement's clothes).
 *
 * It is announced rather than left silent because an unguarded build and a well-behaved one look exactly
 * alike from the outside — the same reason the shared-stage guard survived a fortnight.
 */
export const OPENSA_BUDGET_NOTICE =
  "opensa: SA's row/slot ceilings do not apply here — and no streaming budget guard exists yet " +
  '(07/04 decision 5: the number must be measured in our engine, never inherited from SA)';

export interface BuildPerfectMapOptions {
  /** Downgrade the int16 text-ROW budget from a build-stopping error to a warning — the 03-asi ghost-barriers
   *  repro path (an intentionally over-2^15 full build), the ONLY thing it is for now that the guard is
   *  `sa/`-only and the slot ceiling is a report. Never set for a shipping build. */
  allowTextRowOverflow?: boolean;
  config?: Partial<BuilderConfig>;
  /**
   * Stages to SKIP, whatever else the run asks for — the target-split directive. Unlike `--until` (which cuts
   * the pipeline at a point) this removes named stages and keeps everything after them, so one source tree can
   * produce a target that needs only part of the chain:
   *
   * - `sa` — no real-game LOD build, and no `checkImgIdBudgets` with it (that guard reads the `sa/` tree).
   * - `opensa` — no cell-LOD build and no convert; `pack` goes with it, being that target's tail.
   * - `pack` alone — build `opensa/` and leave it in GAME format (same result as `--until opensa`).
   * - any common-chain stage (`mods`/`vehicles`/`peds`/`optimize`/`trees`/`procobj`) — dropped from the chain.
   *
   * An excluded stage leaves whatever a previous run wrote in its place: the builder only clears `<out>/.work`,
   * so an opensa-only run does not touch a `sa/` built earlier.
   */
  exclude?: readonly ExcludableStage[];
  /** Clean base game dir (`gta.dat` + `data/` + `models/`). */
  gamePath: string;
  /** mods-src root — one subfolder per stage (`mods/`, `vehicles/`, `peds/`, `vegetation/`, `procobj/`). */
  inPath: string;
  /** Keep all intermediate stage builds under `<out>/.work` (implied by `until`). */
  keepWork?: boolean;
  /** Output root; the builder creates `<out>/sa` and `<out>/opensa`. */
  outPath: string;
  /**
   * The HOST this build is for (`--target`) — what picks every knob whose right value is a fact about the
   * host rather than about the source data. Omitted, it is DERIVED from `exclude` (see
   * {@link resolveBuildTarget}), which is what already declares a target today.
   */
  target?: BuildTarget;
  /** Stop after this stage and keep every stage build (for step-by-step in-game debugging). */
  until?: StageName;
}

export interface BuildResult {
  /** Every produced stage build, in order (`{ name, dir }`) — testable full game dirs when kept. */
  produced: { dir: string; name: string }[];
  /** Whether the run stopped early at `until` (before the sa/opensa split). */
  stoppedEarly: boolean;
}

/** Every stage name except the `lod` alias — see {@link EXCLUDABLE_STAGES}. */
export type ExcludableStage = Exclude<StageName, 'lod'>;

export type StageName = (typeof STAGE_NAMES)[number];

/** Run the pipeline (optionally up to `until`). Returns each produced stage build. */
export async function buildPerfectMap(options: BuildPerfectMapOptions): Promise<BuildResult> {
  const config = { ...defaultConfig, ...options.config };
  const { gamePath, inPath, outPath, until } = options;
  const { subfolders } = config;
  const keepWork = options.keepWork || until !== undefined;
  const excluded: ReadonlySet<ExcludableStage> = new Set(options.exclude ?? []);
  const target = resolveBuildTarget(options.target, excluded);
  logTarget(target, options.target !== undefined, excluded);

  const work = join(outPath, '.work');
  refuseSourceInsideWork(work, gamePath, inPath);
  rmSync(work, { force: true, recursive: true });
  mkdirSync(work, { recursive: true });

  const source = (sub: string): string => join(inPath, sub);
  const populated = (sub: string): boolean => existsSync(source(sub)) && readdirSync(source(sub)).length > 0;

  // The common chain (installers → optimizer → LODs). Conditional stages are skipped when their source is empty.
  const chain: { name: ExcludableStage; run: (game: string, out: string) => Promise<unknown> | void }[] = [];
  if (populated(subfolders.mods)) {
    chain.push({
      name: 'mods',
      run: (game, out) => installMods({ gamePath: game, inPath: source(subfolders.mods), outPath: out }),
    });
  }
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
  if (populated(subfolders.vegetation)) {
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
  }
  // procobj stays unconditional: original ships NO procobj/ folder — the no-`--in` mode bakes the built-in
  // roster from the game's own gta3.img/procobj.dat and exits gracefully when no species matches (a TC).
  chain.push({
    name: 'procobj',
    run: (game, out) =>
      buildProcobjLods({
        config: {
          density: config.procobjDensity,
          ...(config.procobjMax !== undefined ? { procObjMax: config.procobjMax } : {}),
          textureSize: config.procobjTex,
        },
        gamePath: game,
        inPath: source(subfolders.procobj),
        outPath: out,
        prelight: true,
        target,
      }),
  });

  const runnable = planChain(chain, excluded, {
    mods: subfolders.mods,
    peds: subfolders.peds,
    trees: subfolders.vegetation,
    vehicles: subfolders.vehicles,
  });

  const produced: { dir: string; name: string }[] = [];
  const timings: StageTiming[] = [];
  // Timed per stage and logged AS EACH ONE ENDS, not only in the summary: a long build that is killed part
  // way still leaves its numbers in the log. Nothing recorded a build's duration before 2026-08-09, so the
  // first question asked of the procobj density change ("what did it cost in build time?") had no baseline.
  const timed = async <T>(name: string, run: () => Promise<T> | T): Promise<T> => {
    const started = Date.now();
    const result = await run();
    const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
    timings.push({ name, seconds });
    log(`${name} — ${seconds}s`);

    return result;
  };
  const untilIndex = until === undefined ? Infinity : STAGE_NAMES.indexOf(until);
  let game = gamePath;
  for (const [index, stage] of runnable.entries()) {
    if (STAGE_NAMES.indexOf(stage.name) > untilIndex) {
      return { produced, stoppedEarly: true }; // `until` names a skipped stage — everything before it has run
    }
    log(stage.name);
    const out = join(work, `${index + 1}-${stage.name}`);
    await timed(stage.name, () => stage.run(game, out));
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
  const userExcluded = loadLodExclude(inPath, source(subfolders.mods));
  const excludeItems = [...collectGeneratedModels(game), ...userExcluded];
  log(
    `excluding ${excludeItems.length} models from sa/opensa LODs ` +
      `(${userExcluded.length} user-curated via lod-exclude.json)`,
  );
  // Hole-fill list (plan 086 phase 5): per-GAME data, not code — stock SA's list lives in
  // mods-src/original/lod-holes.json; a TC without the file gets none (the curated names are SA's).
  const holeFillModels = loadLodHoles(inPath, source(subfolders.mods));
  // Always-on lods (plan 087, `lod-always.json`): lod-target models that ARE the content (a stub HD, the
  // real geometry behind its lod link — gostown's LODEnsemble* forests). The strip keeps them and the
  // pak welds them into BOTH levels; the cell bake still skips them (it bakes HD, i.e. the stub).
  const alwaysOnLods = loadLodAlways(inPath, source(subfolders.mods));
  if (runsStage('sa', until, excluded)) {
    const sa = join(outPath, 'sa');
    log('sa → sa/');
    await timed('sa', () => buildSaLods({ config: { excludeItems, holeFillModels }, gameDir: game, outDir: sa }));
    // Both SA ceilings are checked HERE, on the tree the real game loads — not on the shared build. The LOD
    // stage appends hole-fill instances to the copied text IPLs, so the common build undercounts the rows.
    checkTextIplBudgets(sa, options.allowTextRowOverflow);
    checkImgIdBudgets(sa);
    produced.push({ dir: sa, name: 'sa' });
  }
  if (runsStage('opensa', until, excluded)) {
    log(OPENSA_BUDGET_NOTICE);
    produced.push(
      ...(await timed('opensa', () =>
        buildOpensaTarget({
          alwaysOnLods,
          config,
          excludeItems,
          game,
          gamePath,
          holeFillModels,
          log,
          outPath,
          packing: until !== 'opensa' && !excluded.has('pack'),
          work,
        }),
      )),
    );
  }

  // The sidecars are split-time inputs, not game content — keep the final targets clean. (The opensa side
  // already dropped its own above, before the convert read the dir.)
  for (const target of produced.filter(({ name }) => name === 'sa')) {
    rmSync(join(target.dir, 'linear-txd'), { force: true, recursive: true });
  }

  if (!keepWork) {
    rmSync(work, { force: true, recursive: true });
  }
  writeStageTimings(outPath, timings, { procobjDensity: config.procobjDensity, procobjMax: config.procobjMax, target });

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
 * Every `--exclude` value on a command line, comma-separated and/or repeated, validated against
 * {@link EXCLUDABLE_STAGES}. A typo has to fail LOUDLY: silently ignoring one would produce a build missing
 * the target it was meant to keep, and nothing downstream can tell that from a target nobody asked for.
 */
export function parseExcludedStages(argv: readonly string[]): ExcludableStage[] {
  const names = argv
    .flatMap((arg, index) => (arg === '--exclude' ? (argv[index + 1] ?? '').split(',') : []))
    .map((name) => name.trim())
    .filter((name) => name !== '');
  for (const name of names) {
    if (!EXCLUDABLE_STAGES.includes(name as ExcludableStage)) {
      throw new Error(`--exclude must name one of: ${EXCLUDABLE_STAGES.join(' | ')} (got '${name}')`);
    }
  }

  return [...new Set(names as ExcludableStage[])];
}

/**
 * The host a run is building FOR — `--target`, or DERIVED from `--exclude` when it is omitted, because the
 * exclusion set is already what declares a target today (`build:game:<id>:opensa` is `--exclude sa`; see
 * `docs/restrictions/architecture.md`). A run that builds BOTH resolves to `sa`: the common chain is shared,
 * so its content has to satisfy the host that still has ceilings.
 *
 * One combination cannot be honest and is refused at CONFIG time rather than by a guard three stages later
 * (07/02 decision 3): `--target opensa` while the `sa` target is still being built would hand the real game a
 * layer priced against a host with no int16. The reverse — an opensa-only build carrying the `sa` profile —
 * is merely conservative, so it is allowed and logged.
 */
export function resolveBuildTarget(
  explicit: BuildTarget | undefined,
  excluded: ReadonlySet<ExcludableStage>,
): BuildTarget {
  if (explicit === 'opensa' && !excluded.has('sa')) {
    throw new Error(
      '--target opensa builds the `sa` target too: add --exclude sa, or build with --target sa. The common ' +
        "chain is shared, so an opensa profile would price the real game's content against a host that has " +
        'neither int16 nor a building pool.',
    );
  }

  return explicit ?? (excluded.has('sa') ? 'opensa' : 'sa');
}

/**
 * Whether a post-split target (`sa`/`opensa`) runs under the given `--until` and `--exclude`. `STAGE_NAMES` is
 * the pipeline ORDER, so `--until <stage>` means "run everything up to and including it" — `--until pack`
 * builds `sa` too, because `sa` precedes `pack`. (It used to be an explicit name list, which silently dropped
 * the whole `sa` target from `--until pack`/`--until opensa` runs: no log line, no error, just a missing
 * build.) `--exclude` overrides that ordering: an excluded target never runs, whatever `--until` says.
 */
export function runsStage(
  stage: 'opensa' | 'sa',
  until: StageName | undefined,
  exclude: ReadonlySet<ExcludableStage> = new Set(),
): boolean {
  if (exclude.has(stage)) {
    return false;
  }

  return until === undefined || until === 'lod' || STAGE_NAMES.indexOf(stage) <= STAGE_NAMES.indexOf(until);
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

/**
 * The `opensa` target: the cell-LOD build, then OUR conversion of it.
 *
 * `--until opensa` (or `--exclude pack`) asks for the LOD build itself, so it lands in the final directory and
 * stops there. Otherwise the pack stage is the last thing to touch this target, so the LOD build is an
 * intermediate and the CONVERTED dir takes the `opensa/` name — every stage still hands the next a complete
 * game tree.
 */
async function buildOpensaTarget(step: {
  /** Per-game always-on lod-target list (`lod-always.json`) — kept by the strip, welded into both levels. */
  alwaysOnLods: string[];
  config: BuilderConfig;
  excludeItems: string[];
  game: string;
  /** The run's ORIGINAL `--game` dir — the fetch game id source (plan 086); `game` above is a work stage. */
  gamePath: string;
  /** Per-game hole-fill list (`lod-holes.json`) — exempt from the cell bake's reduction tracks. */
  holeFillModels: string[];
  log: (message: string) => void;
  outPath: string;
  /** Whether the convert runs. False (`--until opensa` / `--exclude pack`) leaves `opensa/` in GAME format. */
  packing: boolean;
  work: string;
}): Promise<{ dir: string; name: string }[]> {
  const { alwaysOnLods, config, excludeItems, game, holeFillModels, log, outPath, packing, work } = step;
  const opensa = join(outPath, 'opensa');
  const lodDir = packing ? join(work, 'opensa-lod') : opensa;
  log(`opensa → ${packing ? '.work/opensa-lod' : 'opensa/'} (baking cells — can take several minutes)`);
  await buildOpensaLods({
    cellSize: config.lodCellSize,
    config: { excludeItems, holeFillModels },
    gameDir: game,
    keepLods: alwaysOnLods,
    outDir: lodDir,
    stripLods: true,
  });
  // The LOD build is the last thing that mutates the game dir, and `swapLinearTxds` rewrites the very texels
  // the pak carries — so it must run BEFORE the convert, not after it. The sidecar goes with it: it is a
  // split-time input, not game content.
  swapLinearTxds(game, lodDir);
  rmSync(join(lodDir, 'linear-txd'), { force: true, recursive: true });
  if (!packing) {
    return [{ dir: opensa, name: 'opensa' }];
  }
  log('pack → opensa/ (converting the map into our format — several minutes)');
  // The fetch game id (plan 086): the USER-FACING --game folder, not this work-stage intermediate.
  const gameId = basename(resolve(step.gamePath));
  // Per-game rect (plan 087): a run-config override wins, else the game's pinned `full` rect from
  // PACK_RECTS, else the convert auto-fits to content (a new TC without a pinned extent).
  const packRect = config.pack.rect ?? PACK_RECTS[gameId]?.full;
  const packed = await packGameDir({
    ...(alwaysOnLods.length > 0 ? { alwaysOnLods } : {}),
    ao: config.pack.ao,
    ...(config.pack.bakeWorkers !== undefined ? { bakeWorkers: config.pack.bakeWorkers } : {}),
    bakes: config.pack.bakes,
    gameDir: lodDir,
    gameId,
    log: (message) => log(`pack: ${message}`),
    // Plan 086 phase 8: the game dir is self-contained — the pak lands in `<out>/opensa/pak` (the default).
    outDir: opensa,
    ...(packRect !== undefined ? { rect: packRect } : {}),
  });
  // The pack writes its report beside the pak it belongs to (`<out>/opensa/pak/`). Mirror it at the root:
  // that is where a run's summary is looked for, and the pak-side copy stays the pak's own.
  const reportPath = join(outPath, 'report.json');
  writeFileSync(
    reportPath,
    JSON.stringify({ ...packed.report, ...(packed.models ? { models: packed.models } : {}) }, null, 2),
  );
  log(`pack: report → ${reportPath}`);

  return [
    { dir: lodDir, name: 'opensa-lod' },
    { dir: opensa, name: 'pack' },
  ];
}

/** STOCK SA's `IplEntityIndexArrays` usable capacity: one slot per gta.dat text IPL with inst rows, and the
 *  game writes past the array without a bounds check (the "ghost barriers" corruption family — lod-procobj
 *  plan 007, lod-trees plan 011). The struct is declared 40 long, but a build with EXACTLY 40 crashed in-game
 *  on the 40th slot (perfect5) — 39 was the hard line. Stock uses 30 (mod-installer compacts int_cont +
 *  gen_int1 down to 28 and folds mod IPLs into a stock host); the generators add ~9 (`plobj*`, `plotr*`).
 *
 *  **A REPORT since 2026-08-08, not a gate.** The install we target sets OLA's `EntityIpl = unlimited`, so the
 *  array does not exist there and stock is not a target (07/04) — the line stays because a plan still has to
 *  know what it would cost on a plain 1.0, and stock is a report rather than a mode. */
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

/** One stage's wall clock. `seconds` is measured, never derived from a diff of two other numbers. */
export interface StageTiming {
  name: string;
  seconds: number;
}

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

/**
 * The `sa/` target's two text-IPL ceilings, split by whether the install we ship to still HAS them (07/04):
 *
 * - **int16 permanent rows — a THROW.** The one ceiling no adjuster lifts (`0x404B4A` is byte-stock on the
 *   reference install), so it is the gate our own `perfect-map.asi` answers for. Past it the corruption is
 *   silent in the build and lands in-game as ghost barriers.
 * - **the 39 `IplEntityIndexArrays` slots — a REPORT.** OLA sets `EntityIpl = unlimited` on the target, so
 *   the array is not there to overflow. Stock is not a target; it is a line in the log
 *   (`docs/gta-sa-original/reference-install.md`).
 *
 * Runs on the BUILT `sa/` tree, like {@link checkImgIdBudgets} — never on the shared build, which both
 * rations the target that has no such ceiling and undercounts this one (the sa LOD stage appends hole-fill
 * instances to the text IPLs after the split).
 */
export function checkTextIplBudgets(gameDir: string, allowTextRowOverflow = false): void {
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
  log(`sa text-IPL rows: ${totalRows}/${TEXT_ROW_CAP} (int16), slots: ${used.length}/${TEXT_IPL_SLOT_CAP} (stock)`);
  if (used.length >= TEXT_IPL_SLOT_CAP) {
    // A report, not a gate: the target runs OLA with `EntityIpl = unlimited`. It says what this build would
    // cost on a plain 1.0, which is a thing a plan has to know — not a reason to ration the supported install.
    log(
      `  · past stock SA's ${TEXT_IPL_SLOT_CAP}-slot IplEntityIndexArrays (${used.length}) — fine on the ` +
        'target (OLA `EntityIpl = unlimited`), corrupts CIplStore on a stock install',
    );
  }
  if (totalRows > TEXT_ROW_CAP) {
    const message =
      `${totalRows} permanent text-IPL rows exceed the ${TEXT_ROW_CAP} budget: SA stores building-pool ` +
      'indexes as int16 in IplDef (CIplStore::IncludeEntity) and permanent rows past ~32.7k corrupt ' +
      'stream-out ranges — no adjuster lifts this one. Convert placements to binary streams (unlinked ' +
      'pairs), cull, or ship with perfect-map.asi.';
    if (!allowTextRowOverflow) {
      throw new Error(message);
    }
    console.warn(`  ! --allow-text-row-overflow: ${message}`);
  }
}

/**
 * The run's wall clock per stage → `<out>/build-timings.json`, plus a summary table in the log.
 *
 * **Self-describing** (the A/B rule): the file states the target and the procobj knobs it was produced with,
 * because a duration is only comparable against another run whose configuration is known. Comparing two
 * builds is otherwise a guess about what each one was told to do.
 */
export function writeStageTimings(
  outPath: string,
  timings: readonly StageTiming[],
  config: { procobjDensity: number; procobjMax?: number; target: BuildTarget },
): void {
  if (timings.length === 0) {
    return;
  }
  const total = timings.reduce((sum, stage) => sum + stage.seconds, 0);
  log('build time');
  for (const { name, seconds } of timings) {
    const share = total > 0 ? ((100 * seconds) / total).toFixed(0) : '0';
    console.log(`  ${name.padEnd(10)} ${formatMinutes(seconds).padStart(8)}  ${share.padStart(3)} %`);
  }
  console.log(`  ${'TOTAL'.padEnd(10)} ${formatMinutes(total).padStart(8)}`);
  writeFileSync(join(outPath, 'build-timings.json'), JSON.stringify({ config, stages: timings, total }, null, 2));
}

/** `1234.5` → `20m 34s` — the unit a build is actually discussed in. */
function formatMinutes(seconds: number): string {
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/** The first `lod-always.json` found among `dirs` → lowercased lod-TARGET models that are the real content
 *  behind a stub HD (plan 087, gostown `LODEnsemble*` forests): kept by the strip, welded into BOTH levels. */
function loadLodAlways(...dirs: string[]): string[] {
  for (const dir of dirs) {
    const file = join(dir, 'lod-always.json');
    if (existsSync(file)) {
      const names = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
        throw new Error(`${file} must be a JSON array of model names`);
      }
      log(`lod-always — ${names.length} always-on lod model(s) from ${file}`);

      return (names as string[]).map((name) => name.toLowerCase());
    }
  }

  return [];
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

/** The first `lod-holes.json` found among `dirs` → lowercased models that ship NO LOD and hole the far
 *  view (plan 086 phase 5 — moved out of `sa-lod-generator/lod.config.ts`, whose list was SA-specific). */
function loadLodHoles(...dirs: string[]): string[] {
  for (const dir of dirs) {
    const file = join(dir, 'lod-holes.json');
    if (existsSync(file)) {
      const names = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
        throw new Error(`${file} must be a JSON array of model names`);
      }
      log(`lod-holes — ${names.length} hole-fill model(s) from ${file}`);

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

/**
 * Drop the `--exclude`d stages from the assembled chain, first REPORTING everything this run will not do —
 * both reasons, separately: a stage whose source folder is empty, and a stage the run excluded on purpose. A
 * silently missing stage reads as a broken build, and the two causes need different fixes.
 */
/**
 * Announce the resolved target, and whether it was asked for or DERIVED — a run has to say which host it
 * priced itself against, because designing down to a ceiling the target does not have is silent (the build
 * succeeds and just carries less). The conservative mismatch is legal, so it is named rather than refused.
 */
function logTarget(target: BuildTarget, explicit: boolean, excluded: ReadonlySet<ExcludableStage>): void {
  log(`target: ${target}${explicit ? '' : ' (derived from --exclude)'}`);
  if (target === 'sa' && excluded.has('sa')) {
    log('  ! an opensa-only build carrying the sa profile — allowed, but it leaves opensa headroom unused');
  }
}

function planChain<T extends { name: ExcludableStage }>(
  chain: readonly T[],
  excluded: ReadonlySet<ExcludableStage>,
  stageSource: Readonly<Record<'mods' | 'peds' | 'trees' | 'vehicles', string>>,
): T[] {
  const staged = new Set(chain.map((stage) => stage.name));
  for (const name of ['mods', 'vehicles', 'peds', 'trees'] as const) {
    if (!staged.has(name) && !excluded.has(name)) {
      log(`${name} — skipped (${stageSource[name]}/ empty)`);
    }
  }
  for (const name of EXCLUDABLE_STAGES) {
    if (excluded.has(name)) {
      log(`${name} — excluded (--exclude)`);
    }
  }

  return chain.filter((stage) => !excluded.has(stage.name));
}

/**
 * `<out>/.work` is wiped unconditionally before any stage reads `--game`/`--in`, so a source pointing INTO it
 * (the obvious fast path for re-running one stage: `--game <out>/.work/5-trees`) is deleted before it is
 * read. Silent otherwise — the run dies on a missing `gta3.img` seconds after the intermediates are already
 * gone, naming the symptom and never the cause. It cost a full rebuild on 2026-08-09.
 */
function refuseSourceInsideWork(work: string, gamePath: string, inPath: string): void {
  for (const [flag, path] of [
    ['--game', gamePath],
    ['--in', inPath],
  ] as const) {
    if (resolve(path).startsWith(resolve(work))) {
      throw new Error(
        `${flag} ${path} is inside ${work}, which this run wipes before it reads anything. Copy the ` +
          'intermediate out of `.work` first, or point --out somewhere else.',
      );
    }
  }
}
