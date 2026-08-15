import type { AssetFailure, RunSummary } from '@opensa/map-optimizer/run';
import type { ProcObjDensityInput } from '@opensa/map-placement/procobj-density';

import { parsePrelightInfo, type PrelightInfo } from '@opensa/lod-common/prelight';
import { buildTreeLods } from '@opensa/lod-trees-generator/build';
import { parseOnlyList, runOptimizer, summarizeReport } from '@opensa/map-optimizer/run';
import { SA_TREE_MODELS } from '@opensa/map-placement/vegetation';
import { install as installMods } from '@opensa/mod-installer/install';
import { buildOpensaLods } from '@opensa/opensa-lod-generator/build';
import { packGameDir } from '@opensa/opensa-pack/pack';
import { install as installPeds } from '@opensa/ped-installer/install';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseIde } from '@opensa/renderware/parsers/text/ide.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { buildSaLods } from '@opensa/sa-lod-generator/build';
/**
 * The perfect-map build pipeline (plan 001): chain every map tool via its Node API, each stage's output feeding the
 * next as a **complete** game dir (full passthrough), then split the common build into the `sa` (real game) and
 * `opensa` final LOD targets. Intermediate stages live under `<out>/.work-<target>` (plan 005 — one dir per
 * target, so building one never destroys the other's kept stages) and are deleted as they're consumed — unless
 * `keepWork`/`until` is set, in which case every stage build is kept for step-by-step in-game debugging.
 * Each target that runs writes `<out>/report-<target>.json` at the end of its chain (plan 005).
 */
import { buildProcobjLods } from '@opensa/sa-procobj-placement/build';
import { editArchive } from '@opensa/tool-kit/archive/img';
import { type BuildTarget } from '@opensa/tool-kit/target';
import { installCutscene } from '@opensa/vehicle-cutscene/install';
import { install as installVehicles } from '@opensa/vehicle-installer/install';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BuilderConfig } from './config';

import { config as defaultConfig, PACK_RECTS } from './config';

/**
 * Valid `--until <name>` values. Common-chain + `sa`/`opensa` stop after the named one; the special `lod` value
 * runs the whole pipeline (**both** sa + opensa) while keeping every intermediate for debugging.
 */
export const STAGE_NAMES = [
  'mods',
  'vehicles',
  // The cutscene fleet is the vehicles stage's shadow (plan 002 step 11): it reads the INSTALLED game —
  // the merged carcols.dat and the mod TXDs already in gta3.img are what the conversion bakes/resolves
  // against — so it sits right after `vehicles` and shares its source folder and its populated-check.
  'cutscene',
  'peds',
  'optimize',
  'trees',
  'sa',
  // procobj is baked INSIDE the sa branch, after the LOD build (plan 014) — it is that target's layer alone, so
  // it must not reach the common build both targets share. Its place in this list is its place in the RUN order,
  // which is what `--until` reads: `--until sa` stops before the clutter, `--until procobj` includes it.
  'procobj',
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
 * {@link reportTextIplCensus} does not run here; what replaces it is a STREAMING budget whose number does not
 * exist yet (07/04 decisions 4–5 — it has to be measured in our engine, and a cap taken from SA's numbers
 * would be a guess wearing a measurement's clothes).
 *
 * **The CLUTTER half of that budget was measured 2026-08-10 and yielded no number**, which is a result and not
 * a gap: at 3× vanilla density — every candidate the current headroom generates — the layer costs less than a
 * single sweep's A/A drift on every column and never hitches, so there is no frame-time ceiling to cap it at.
 * See sa-procobj-placement plan 013, and note that its two knobs stop for different reasons (`procObjLimit` at
 * 300 because the authored SPACING column runs out; density at ×3 because `PROC_OBJ_MAX_DENSITY` is ours).
 * What remains unmeasured is the budget for everything ELSE the branch streams.
 *
 * It is announced rather than left silent because an unguarded build and a well-behaved one look exactly
 * alike from the outside — the same reason the shared-stage guard survived a fortnight.
 */
/**
 * Where the cross-compiled `perfect-map.asi` is picked up from. `dist/` is GITIGNORED, so a fresh checkout has
 * no artifact and {@link shipPerfectMapAsi} warns — which is the honest state, not a failure: the asi is built
 * by `npm run build:asi` in `asi/perfect-map` and that needs MinGW, which a map build should not.
 */
export const PERFECT_MAP_ASI = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../asi/perfect-map/dist/perfect-map.asi',
);

/**
 * Where the cross-compiled `perfect-cutscene.asi` is picked up from — same deal as {@link PERFECT_MAP_ASI}: a
 * pre-built artifact under a gitignored `dist/`, never a build step (asi/perfect-cutscene plan 001 step 7).
 */
export const PERFECT_CUTSCENE_ASI = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../asi/perfect-cutscene/dist/perfect-cutscene.asi',
);

export const OPENSA_BUDGET_NOTICE =
  "opensa: SA's row/slot ceilings do not apply here — and no streaming budget guard exists yet " +
  '(07/04 decision 5: the number must be measured in our engine, never inherited from SA). ' +
  'The clutter half is measured and does not bind: at 3x vanilla density the layer stays under one sweep of ' +
  'measurement noise and never hitches, so there is no frame-time ceiling to cap it at';

export interface BuildPerfectMapOptions {
  config?: Partial<BuilderConfig>;
  /**
   * Stages to SKIP, whatever else the run asks for — the target-split directive. Unlike `--until` (which cuts
   * the pipeline at a point) this removes named stages and keeps everything after them, so one source tree can
   * produce a target that needs only part of the chain:
   *
   * - `sa` — no real-game LOD build, and no `checkImgIdBudgets` with it (that guard reads the `sa/` tree).
   * - `opensa` — no cell-LOD build and no convert; `pack` goes with it, being that target's tail.
   * - `pack` alone — build `opensa/` and leave it in GAME format (same result as `--until opensa`).
   * - any common-chain stage (`mods`/`vehicles`/`cutscene`/`peds`/`optimize`/`trees`/`procobj`) — dropped
   *   from the chain.
   *
   * An excluded stage leaves whatever a previous run wrote in its place: the builder only clears its own
   * `<out>/.work-<target>` (plus the legacy shared `.work`), so an opensa-only run does not touch a `sa/`
   * built earlier — nor the other target's kept `.work-<target>`.
   */
  exclude?: readonly ExcludableStage[];
  /** Clean base game dir (`gta.dat` + `data/` + `models/`). */
  gamePath: string;
  /** mods-src root — one subfolder per stage (`mods/`, `vehicles/`, `peds/`, `vegetation/`, `procobj/`). */
  inPath: string;
  /** Keep all intermediate stage builds under `<out>/.work-<target>` (implied by `until`). */
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

/** The cutscene stage's summary (plan `vehicle-cutscene` 002 step 11) — per-slot errors FAIL the stage,
 *  so a report only ever carries the converted/skipped/warning shape of a build that succeeded. */
export interface CutsceneFragment {
  converted: string[];
  imgBytesAfter: number;
  /** Slots that got a baked readable plate pair (vehicle-cutscene plan 003). */
  plates: { csName: string; text: string }[];
  skipped: { csName: string; reason: string }[];
  txdBytes: number;
  warnings: { csName: string; message: string }[];
}

/** Every stage name except the `lod` alias — see {@link EXCLUDABLE_STAGES}. */
export type ExcludableStage = Exclude<StageName, 'lod'>;

/** The optimize stage's totals + isolated failures. The per-asset list lives and dies with the stage build. */
export interface OptimizeFragment {
  failures: AssetFailure[];
  summary: RunSummary;
}

/** The pack stage's summary. `report` POINTS at the pack's own full report beside its pak — never a copy. */
export interface PackFragment {
  cells: number;
  pakBytes: number;
  report: string;
}

/** The `sa` branch's ceilings, read off the tree the real game loads — console-only before plan 005. */
export interface SaFragment {
  census: { instBearingIpls: number; largestIpl: number; rows: number };
  imgBudgets: Record<string, number>;
  /** Set only when this build carries a converted cutscene fleet — the two ship together or not at all. */
  perfectCutsceneAsiSha256: null | string;
  perfectMapAsiSha256: null | string;
  requirements: InstallRequirement[];
}

export type StageName = (typeof STAGE_NAMES)[number];

/**
 * One target's build report — `<out>/report-<target>.json`, assembled at the end of the target's chain (plan
 * 005). The NAME is the target: two targets share one `--out`, so a single unnamed `report.json` was a
 * summary of whichever run finished last. Fragments are typed per stage — a stage that learned nothing
 * contributes nothing.
 */
export interface TargetReport {
  builtAt: string;
  fragments: TargetReportFragments;
  /** The fetch game id — basename of the run's `--game`. */
  game: string;
  gamePath: string;
  target: 'opensa' | 'sa';
  timings: StageTiming[];
}

export interface TargetReportFragments {
  cutscene?: CutsceneFragment;
  optimize?: OptimizeFragment;
  pack?: PackFragment;
  sa?: SaFragment;
}

/** What a common-chain stage may hand the report assembler (plan 005); most stages produce nothing. */
type ChainOutcome =
  | undefined
  | void
  | { fragment: CutsceneFragment; stage: 'cutscene' }
  | { fragment: OptimizeFragment; stage: 'optimize' };

/** Run the pipeline (optionally up to `until`). Returns each produced stage build. */
export async function buildPerfectMap(options: BuildPerfectMapOptions): Promise<BuildResult> {
  const config = { ...defaultConfig, ...options.config };
  const { gamePath, inPath, outPath, until } = options;
  const { subfolders } = config;
  const keepWork = options.keepWork || until !== undefined;
  const excluded: ReadonlySet<ExcludableStage> = new Set(options.exclude ?? []);
  const target = resolveBuildTarget(options.target, excluded);
  logTarget(target, options.target !== undefined, excluded);

  // One work dir per resolved target (plan 005): under --keepWork a `sa` run used to silently delete
  // everything a previous opensa run was keeping, because both shared `<out>/.work`.
  const work = join(outPath, `.work-${target}`);
  // The pre-005 shared dir is still cleared: it was wiped at the start of every run by contract, and left
  // alone it is multi-GB garbage no new build will ever read.
  const legacyWork = join(outPath, '.work');
  refuseSourceInsideWork(work, gamePath, inPath);
  refuseSourceInsideWork(legacyWork, gamePath, inPath);
  rmSync(legacyWork, { force: true, recursive: true });
  rmSync(work, { force: true, recursive: true });
  mkdirSync(work, { recursive: true });

  const source = (sub: string): string => join(inPath, sub);
  const populated = (sub: string): boolean => existsSync(source(sub)) && readdirSync(source(sub)).length > 0;

  // The common chain (installers → optimizer → LODs). Conditional stages are skipped when their source is empty.
  // A stage may RETURN a fragment for the target report (plan 005) — the runner collects them, keyed by stage.
  const chain: { name: ExcludableStage; run: (game: string, out: string) => ChainOutcome | Promise<ChainOutcome> }[] =
    [];
  if (populated(subfolders.mods)) {
    chain.push({
      name: 'mods',
      run: (game, out) => installMods({ gamePath: game, inPath: source(subfolders.mods), outPath: out }),
    });
  }
  if (populated(subfolders.vehicles)) {
    chain.push({
      name: 'vehicles',
      // The installer returns the archive FAMILY it wrote (one file, or numbered siblings once the cap
      // bites). Registering a sibling in `gta.dat` belongs to the split stage, not here — img-splitter plan
      // 001 step 4 — so this stage contributes no fragment yet and the installer warns if one appears.
      run: (game, out) => void installVehicles({ gamePath: game, inPath: source(subfolders.vehicles), outPath: out }),
    });
  }
  // The cutscene stage exists only downstream of a RUN vehicles stage: the conversion reads the installed
  // game (merged carcols, mod TXDs as txdp parents), so on a tree without them every slot fails closure.
  // `--exclude vehicles` therefore drops this stage too — loudly, because a silently missing stage reads
  // as a broken build (build:game:original:sa excludes vehicles today).
  stageCutscene(chain, excluded, populated(subfolders.vehicles), source(subfolders.vehicles));
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
    // The per-asset report would sit in `.work/<n>-optimize`, which is deleted as the stage is consumed —
    // so the fragment carries the totals and the isolated failures, the two things a build summary needs.
    run: async (game, out) => {
      const report = await runOptimizer({
        gameDir: game,
        outDir: out,
        passes: config.optimizerPasses,
        ...(prelitForce ? { prelitOptions: { force: prelitForce } } : {}),
      });

      return { fragment: { failures: report.failures, summary: summarizeReport(report) }, stage: 'optimize' as const };
    },
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
  const runnable = planChain(chain, excluded, {
    cutscene: subfolders.vehicles,
    mods: subfolders.mods,
    peds: subfolders.peds,
    trees: subfolders.vegetation,
    vehicles: subfolders.vehicles,
  });

  const produced: { dir: string; name: string }[] = [];
  const timings: StageTiming[] = [];
  /** The fetch game id — the user-facing `--game` folder name, stamped into each target report. */
  const gameId = basename(resolve(gamePath));
  /** Fragments the COMMON chain produced — shared by every target report this run writes (plan 005). */
  const common: TargetReportFragments = {};
  /** The asi shipped beside this map, for the manifest — a map at this density is correct only with it. */
  let shippedAsi: null | { sha256: string } = null;
  /** The asi shipped beside the cutscene fleet, same manifest reasoning — null when no fleet was converted. */
  let shippedCutsceneAsi: null | { sha256: string } = null;
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
    collectFragment(common, await timed(stage.name, () => stage.run(game, out)));
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
    const built = await buildSaTarget({
      config,
      cutsceneFleet: common.cutscene !== undefined,
      excluded,
      excludeItems,
      game,
      holeFillModels,
      outPath,
      procobjIn: source(subfolders.procobj),
      timed,
      until,
    });
    shippedAsi = built.shippedAsi;
    shippedCutsceneAsi = built.shippedCutsceneAsi;
    produced.push(built.produced);
    // The report this target never had (plan 005): the census, the FLA pools and the lift requirements used
    // to exist only as console output nobody could diff.
    writeTargetReport(outPath, {
      builtAt: new Date().toISOString(),
      fragments: { ...common, sa: built.fragment },
      game: gameId,
      gamePath,
      target: 'sa',
      timings: [...timings],
    });
  }
  if (runsStage('opensa', until, excluded)) {
    log(OPENSA_BUDGET_NOTICE);
    const built = await timed('opensa', () =>
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
    );
    produced.push(...built.produced);
    writeTargetReport(outPath, {
      builtAt: new Date().toISOString(),
      fragments: { ...common, ...(built.pack ? { pack: built.pack } : {}) },
      game: gameId,
      gamePath,
      target: 'opensa',
      timings: [...timings],
    });
  }

  // The sidecars are split-time inputs, not game content — keep the final targets clean. (The opensa side
  // already dropped its own above, before the convert read the dir.)
  for (const target of produced.filter(({ name }) => name === 'sa')) {
    rmSync(join(target.dir, 'linear-txd'), { force: true, recursive: true });
  }

  if (!keepWork) {
    rmSync(work, { force: true, recursive: true });
  }
  writeStageTimings(outPath, timings, {
    ...asiPairings(shippedAsi, shippedCutsceneAsi),
    procobjDensity: config.procobjDensity,
    procobjMax: config.procobjMax,
    target,
  });

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
 * layer priced against a host with no building pool and no RenderWare streaming at all. The reverse — an
 * opensa-only build carrying the `sa` profile — is merely conservative, so it is allowed and logged.
 *
 * The differences that remain are the HOST's, not a ceiling's: SA's `CBuilding` pool and its particle policy.
 * int16 stopped being one of them on 2026-08-09 (see {@link reportTextIplCensus}) — the target lifts it.
 */
export function resolveBuildTarget(
  explicit: BuildTarget | undefined,
  excluded: ReadonlySet<ExcludableStage>,
): BuildTarget {
  if (explicit === 'opensa' && !excluded.has('sa')) {
    throw new Error(
      '--target opensa builds the `sa` target too: add --exclude sa, or build with --target sa. The common ' +
        "chain is shared, so an opensa profile would price the real game's content against a host that has no " +
        'building pool and no RenderWare streaming.',
    );
  }

  return explicit ?? (excluded.has('sa') ? 'opensa' : 'sa');
}

/**
 * Whether a POST-SPLIT stage runs under the given `--until` and `--exclude` — the two targets, and `procobj`,
 * which is baked inside the `sa` branch since plan 014. `STAGE_NAMES` is the pipeline ORDER, so
 * `--until <stage>` means "run everything up to and including it" — `--until pack` builds `sa` too, because
 * `sa` precedes `pack`. (It used to be an explicit name list, which silently dropped the whole `sa` target from
 * `--until pack`/`--until opensa` runs: no log line, no error, just a missing build.) `--exclude` overrides that
 * ordering: an excluded stage never runs, whatever `--until` says.
 */
export function runsStage(
  stage: 'opensa' | 'procobj' | 'sa',
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
 * Written whenever the target's branch RAN — `--until opensa` / `--exclude pack` still get a (pack-less)
 * `report-opensa.json`; a run stopped in the common chain writes none, deliberately: no target finished.
 */
export function writeTargetReport(outPath: string, report: TargetReport): void {
  const path = join(outPath, `report-${report.target}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  log(`${report.target}: report → ${path}`);
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
}): Promise<{ pack: null | PackFragment; produced: { dir: string; name: string }[] }> {
  const { alwaysOnLods, config, excludeItems, game, holeFillModels, log, outPath, packing, work } = step;
  const opensa = join(outPath, 'opensa');
  const lodDir = packing ? join(work, 'opensa-lod') : opensa;
  log(`opensa → ${packing ? `${basename(work)}/opensa-lod` : 'opensa/'} (baking cells — can take several minutes)`);
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
    return { pack: null, produced: [{ dir: opensa, name: 'opensa' }] };
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

  // The pack's FULL report stays beside its pak (`<out>/opensa/pak/report.json`) — the fragment is a summary
  // plus that pointer, never a root-level copy of the pack's report wearing the run's name (plan 005).
  return {
    pack: {
      cells: packed.report.cells.length,
      pakBytes: packed.report.pakBytes,
      report: join('opensa', 'pak', 'report.json'),
    },
    produced: [
      { dir: lodDir, name: 'opensa-lod' },
      { dir: opensa, name: 'pack' },
    ],
  };
}

/**
 * The `sa` (real game) target: the LOD build, the in-place procobj bake, every ceiling gate on the FINISHED
 * tree, and the asi shipped beside the map. Returns the tree it produced and its report fragment (plan 005).
 */
async function buildSaTarget(step: {
  config: BuilderConfig;
  /** Whether the cutscene stage ran — the gate on shipping `perfect-cutscene.asi` beside the fleet it needs. */
  cutsceneFleet: boolean;
  excluded: ReadonlySet<ExcludableStage>;
  excludeItems: string[];
  /** The common baked build both targets are fed from. */
  game: string;
  holeFillModels: string[];
  outPath: string;
  /** The mods-src `procobj/` subfolder (may be absent — the bake falls back to the built-in roster). */
  procobjIn: string;
  timed: <T>(name: string, run: () => Promise<T> | T) => Promise<T>;
  until: StageName | undefined;
}): Promise<{
  fragment: SaFragment;
  produced: { dir: string; name: string };
  shippedAsi: null | { sha256: string };
  shippedCutsceneAsi: null | { sha256: string };
}> {
  const { config, cutsceneFleet, excluded, excludeItems, game, holeFillModels, outPath, procobjIn, timed, until } =
    step;
  const sa = join(outPath, 'sa');
  log('sa → sa/');
  await timed('sa', () => buildSaLods({ config: { excludeItems, holeFillModels }, gameDir: game, outDir: sa }));
  // The procobj clutter is baked into the FINISHED sa tree, in place (plan 014). It belongs to this target
  // alone: OpenSA scatters the same species at runtime, where draw distance is a setting and none of SA's
  // ceilings exist, so baking it into the common build would cost that target a stripped `procobj.dat` (9
  // rules of 96 survived it) and 91 092 vertex-duplicated instances in its pak for nothing.
  //
  // After `buildSaLods`, not before: the LOD generators work from placements, so clutter that does not exist
  // yet gets no far-LODs — which is what we want for objects whose range now comes from their IDE row.
  if (runsStage('procobj', until, excluded)) {
    log('procobj → sa/');
    await timed('procobj', () =>
      buildProcobjLods({
        config: {
          density: config.procobjDensity,
          ...(config.procobjMax !== undefined ? { procObjMax: config.procobjMax } : {}),
        },
        gamePath: sa,
        inPath: procobjIn,
        outPath: sa,
        prelight: true,
        target: 'sa',
      }),
    );
  }
  // Every SA ceiling is checked HERE, on the tree the real game loads — not on the shared build. The LOD
  // stage appends hole-fill instances to the copied text IPLs, so the common build undercounts the rows.
  const census = reportTextIplCensus(sa);
  checkInstBearingIplSlots(census.instBearingIpls);
  const imgBudgets = checkImgIdBudgets(sa);
  reportInstallRequirements(census, imgBudgets);
  // Ship the fix beside the map that needs it — stating a requirement and not satisfying it is half a job.
  const shippedAsi = shipPerfectMapAsi(sa, PERFECT_MAP_ASI);
  // Same rule for the fleet: a build that converted the cutscene cars ships the plugin they were swept with.
  const shippedCutsceneAsi = cutsceneFleet ? shipPerfectCutsceneAsi(sa, PERFECT_CUTSCENE_ASI) : null;

  return {
    fragment: {
      census,
      imgBudgets,
      perfectCutsceneAsiSha256: shippedCutsceneAsi?.sha256 ?? null,
      perfectMapAsiSha256: shippedAsi?.sha256 ?? null,
      requirements: installRequirements(census, imgBudgets),
    },
    produced: { dir: sa, name: 'sa' },
    shippedAsi,
    shippedCutsceneAsi,
  };
}

/** File a stage's outcome under its stage name — the runner-side half of the fragment contract (plan 005). */
function collectFragment(fragments: TargetReportFragments, outcome: ChainOutcome): void {
  if (!outcome) {
    return;
  }
  if (outcome.stage === 'cutscene') {
    fragments.cutscene = outcome.fragment;
  } else {
    fragments.optimize = outcome.fragment;
  }
}

/**
 * The cutscene stage (vehicle-cutscene plan 002 step 11): reads the INSTALLED game the vehicles stage
 * produced — merged carcols for the paint bake, mod TXDs in gta3.img as the empty-TXD route's txdp
 * parents. A slot error here is a broken build, not a per-slot condition to carry: with the parents
 * installed, a closure miss means the vehicle install itself is incomplete — fail loudly, every slot named.
 */
function runCutsceneStage(
  game: string,
  inPath: string,
  out: string,
): { fragment: CutsceneFragment; stage: 'cutscene' } {
  const summary = installCutscene({ gamePath: game, inPath, outPath: out });
  if (summary.errors.length > 0) {
    const named = summary.errors.map((error) => `${error.csName}: ${error.message}`).join('\n  ');
    throw new Error(`cutscene conversion failed for ${summary.errors.length} slot(s):\n  ${named}`);
  }
  log(
    `  cutscene — ${summary.converted.length} converted, ${summary.skipped.length} skipped, ` +
      `${summary.plates.length} plate(s) baked, ` +
      `img ${(summary.imgBytesBefore / 1e6).toFixed(1)} → ${(summary.imgBytesAfter / 1e6).toFixed(1)} MB, ` +
      `${summary.txdBytes} B of cs TXDs`,
  );

  return {
    fragment: {
      converted: summary.converted,
      imgBytesAfter: summary.imgBytesAfter,
      plates: summary.plates,
      skipped: summary.skipped,
      txdBytes: summary.txdBytes,
      warnings: summary.warnings,
    },
    stage: 'cutscene',
  };
}

/**
 * Stage the cutscene conversion — only downstream of a RUN vehicles stage: on a tree without the
 * installed parents every slot fails closure, so `--exclude vehicles` drops this stage too, loudly (a
 * silently missing stage reads as a broken build; `build:game:original:sa` excludes vehicles today).
 */
function stageCutscene(
  chain: { name: ExcludableStage; run: (game: string, out: string) => ChainOutcome | Promise<ChainOutcome> }[],
  excluded: ReadonlySet<ExcludableStage>,
  vehiclesPopulated: boolean,
  vehiclesSource: string,
): void {
  if (!vehiclesPopulated) {
    return;
  }
  if (excluded.has('vehicles')) {
    if (!excluded.has('cutscene')) {
      log('cutscene — skipped (vehicles stage excluded; the conversion needs the INSTALLED game)');
    }

    return;
  }
  chain.push({ name: 'cutscene', run: (game, out) => runCutsceneStage(game, vehiclesSource, out) });
}

/** FLA ID-pool budgets for the real-SA build — mirrors the operative FILE_TYPE_* values in the target
 *  install's fastman92limitAdjuster_GTASA.ini (stock pools: 5000/255/256). Each counts ARCHIVE FILES = ID
 *  slots. The margins leave room for SA's runtime slots (script/generic/ped-remap TXDs etc.) — exhausting a
 *  pool corrupts the heap during data load with a crash right after `shopping.dat` (field-diagnosed 2026-07:
 *  FILE_TYPE_IPL exhaustion; raising the ini fixed the boot).
 *
 *  **Raised 2026-08-10 after the first `sa` build at the recovered procobj density (91 092 objects) hit the
 *  IPL pool: 522 binary IPL files of 280.** The layer's `plobj*_stream*` tiles went 50 → 331 across the
 *  column fix, which is what a 5.96× object count buys at `STREAM_MAX_INST = 512`. Per the target rule in
 *  `CLAUDE.md`, an FLA pool is a configured NUMBER — raised in the ini rather than designed down to.
 *
 *  **And TXD was never 6000 here.** These constants claimed it from the start, while the install's ini leaves
 *  `#FILE_TYPE_TXD` commented — FLA's own log reports the pool it actually built: `20000 - 24999 (5000)`. The
 *  build sat at 4999 of a real 5000 while this guard called it 4999 of 6000, so the one pool nothing warned
 *  about was the one a single archive would have burst. Evidence and the new values:
 *  `docs/gta-sa-original/reference-install-config.md`. */
const IMG_ID_BUDGETS = [
  { ext: '.txd', label: 'TXD archives', limit: 6000, margin: 50 },
  { ext: '.col', label: 'COL archives', limit: 400, margin: 8 },
  { ext: '.ipl', label: 'binary IPL files', limit: 1024, margin: 8 },
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
export function checkImgIdBudgets(gameDir: string): Record<string, number> {
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
  const counted: Record<string, number> = {};
  for (const budget of IMG_ID_BUDGETS) {
    const count = names.filter((name) => name.endsWith(budget.ext)).length;
    counted[budget.ext] = count;
    const message = `${budget.label}: ${count} of ${budget.limit} ID slots (margin ${budget.margin} for SA's runtime slots)`;
    if (count > budget.limit - budget.margin) {
      throw new Error(
        `real-SA ID pool nearly exhausted — ${message}. Raise the FLA limit in fastman92limitAdjuster_GTASA.ini ` +
          'or trim the build (the salod txdp partition is the biggest TXD consumer).',
      );
    }
    log(`  id budget — ${message}`);
  }

  return counted;
}

/**
 * **Stock ceilings this artifact would breach** — plan 013 decision 8, and the honest replacement for the
 * int16 throw deleted on 2026-08-09. The build stopped shaping its output down to a stock 1.0 that we do not
 * ship to; what it owes instead is a plain statement of the install it DOES require, printed every run so the
 * requirement is read off the artifact rather than remembered.
 *
 * Every number here is one the build already has. Each row is a stock ceiling, what we spend against it, and
 * the setting that lifts it — the third column is the whole point: a breach is an instruction, not a fault.
 */
export const STOCK_CEILINGS = {
  /** `CPool<CBuilding>` — every permanent row spends one, before anything streams. */
  buildings: 13_000,
  /** `gpLoadedBuildings`, per text IPL plus its boot streams. */
  rowsPerIpl: 4_096,
  /** `CIplStore::IncludeEntity` truncates the building-pool index to int16, map-wide. */
  rowsTotal: 32_767,
} as const;

/** One stock ceiling this build crosses, and the setting that lifts it. */
export interface InstallRequirement {
  ceiling: number;
  lift: string;
  spent: number;
  what: string;
}

/** The requirement list for a built tree — pure, so the wording is testable without a game dir. */
export function installRequirements(
  census: { largestIpl: number; rows: number },
  imgCounts: Record<string, number>,
): InstallRequirement[] {
  const rows: InstallRequirement[] = [
    {
      ceiling: STOCK_CEILINGS.rowsTotal,
      lift: 'perfect-map.asi (no adjuster provides it — measured 2026-08-07)',
      spent: census.rows,
      what: 'permanent text-IPL rows, map-wide',
    },
    {
      ceiling: STOCK_CEILINGS.buildings,
      lift: 'OLA `Buildings`',
      spent: census.rows,
      what: 'CPool<CBuilding> entries',
    },
    {
      ceiling: STOCK_CEILINGS.rowsPerIpl,
      lift: 'OLA `EntitiesPerIpl`',
      spent: census.largestIpl,
      what: 'rows in one text IPL',
    },
    ...IMG_ID_BUDGETS.map((budget) => ({
      ceiling: budget.ext === '.txd' ? 5000 : budget.ext === '.col' ? 255 : 256,
      lift: `FLA ${budget.label.split(' ')[0]} id pool`,
      spent: imgCounts[budget.ext] ?? 0,
      what: budget.label,
    })),
  ];

  return rows.filter((row) => row.spent > row.ceiling);
}

/** Print it. A LINE, never a throw — the guards above own the ceilings that are real on the target. */
export function reportInstallRequirements(
  census: { largestIpl: number; rows: number },
  imgCounts: Record<string, number>,
): void {
  const needed = installRequirements(census, imgCounts);
  if (needed.length === 0) {
    log('sa install requirements: none — this build fits a stock 1.0 unaided');

    return;
  }
  log(`sa install requirements: ${needed.length} stock ceiling(s) crossed, each lifted by a setting:`);
  for (const row of needed) {
    log(`  needs ${row.lift} — ${row.what}: ${row.spent} over stock's ${row.ceiling}`);
  }
}

/**
 * What the built `sa/` tree COSTS in permanent text-IPL rows and inst-bearing IPL slots. **A census for the
 * ROWS, a gate for the SLOTS** — the row half stayed a census on 2026-08-09 (the user's call: `perfect-map.asi`
 * lifts the int16 pool index where our data lands, so it is not a limit our content is designed against —
 * `docs/project-goals.md` directive 3). The slot half became {@link checkInstBearingIplSlots} on 2026-08-10,
 * when the field killed the belief that OLA lifts it too. The two halves of this function are now the two sides
 * of the same rule: **delete the museum pieces, keep the gates** — and which is which is answered by the
 * target, never by an ini.
 *
 * What died with the gate, and why it was never a gate worth having:
 *
 * - **the throw** failed every `sa` build to ration an install we do not build for. Past the 2026-08-09
 *   procobj column fix the layer alone costs 39 219 rows, so the condition was constant — and a condition that
 *   is always true is a print statement wearing a guard's clothes.
 * - **the `TEXT_ROW_CAP = 30000` budget** under it, 2 767 of unmeasured headroom below a ceiling that is itself
 *   lifted. It never shaped content: nothing culled to fit it. (What DOES shape rows is `linkedHeight` — short
 *   species ride binary streams at zero permanent rows — and lod-trees' per-area `AREA_ROW_CAP` migration.)
 * - **`--allow-text-row-overflow`**, which had nothing left to permit.
 * - **int16's 32 767 as printed scale** (field-bisected to exactly 2^15: 31 300 rows clean, 33 210 corrupt) —
 *   lifted by our asi, so printing it measured our build against a machine it never runs on. It lives in
 *   `docs/gta-sa-original/reference-install.md` and `docs/open-issues/fixed/ghost-barriers.md`.
 *   **`IplEntityIndexArrays` was dropped alongside it on the same reasoning and that was WRONG** — it is real,
 *   and it is back as a gate. The lesson is not "keep every ceiling": it is that "lifted" needs the artifact
 *   that enforces the limit to say so, and for this one nothing ever had.
 *
 * **This is not "guards are bad".** {@link checkImgIdBudgets} beside it still THROWS, and correctly: FLA's
 * pools are what the target is actually configured with — real numbers, not `unlimited` — and exhausting one
 * corrupts the heap during data load. It proved that on the first `sa` build after the density fix, which is
 * the difference between the two: a ceiling the target HAS is a gate, a ceiling it lifted is a museum piece.
 * A gate is answered by raising the number in the install's ini, never by shaping the build down to it.
 *
 * **The census names its own scope**, because both halves of it used to read a missing file as zero rows: an
 * IPL listed in `gta.dat` but absent on disk silently subtracted its rows, and an absent `gta.dat` skipped the
 * whole thing without a line. The error only ever ran DOWNWARD, so the count could only ever be falsely quiet —
 * and it is the number that prices the `CBuilding` pool (013's deferred task), so a lower bound sold as a total
 * is a wrong answer to a question we have not asked yet.
 *
 * Runs on the BUILT `sa/` tree, like {@link checkImgIdBudgets} — never on the shared build, which undercounts
 * it (the sa LOD stage appends hole-fill instances to the text IPLs after the split).
 */
export function reportTextIplCensus(gameDir: string): { instBearingIpls: number; largestIpl: number; rows: number } {
  const datPath = join(gameDir, 'data', 'gta.dat');
  if (!existsSync(datPath)) {
    console.warn(`  ! sa text-IPL census SKIPPED — no data/gta.dat under ${gameDir}; this build's row cost is unknown`);

    return { instBearingIpls: 0, largestIpl: 0, rows: 0 };
  }
  const listed: string[] = [];
  const missing: string[] = [];
  const used: string[] = [];
  let totalRows = 0;
  let largestIpl = 0;
  for (const line of readFileSync(datPath, 'utf8').split(/\r?\n/)) {
    const match = /^IPL\s+(\S.*)$/i.exec(line.trim());
    if (!match || match[1].toLowerCase().endsWith('.zon')) {
      continue;
    }
    listed.push(match[1]);
    const file = join(gameDir, match[1].replace(/\\/g, '/'));
    if (!existsSync(file)) {
      missing.push(match[1]);
      continue;
    }
    const rows = parseIpl(readFileSync(file, 'utf8')).length;
    if (rows > 0) {
      used.push(match[1]);
      totalRows += rows;
      largestIpl = Math.max(largestIpl, rows);
    }
  }
  log(
    `sa map cost: ${totalRows} permanent text-IPL rows, ${used.length} inst-bearing IPLs, ` +
      `read ${listed.length - missing.length}/${listed.length} listed`,
  );
  if (missing.length > 0) {
    const named = missing.slice(0, 3).join(', ');
    console.warn(
      `  ! ${missing.length} of ${listed.length} IPLs listed in gta.dat are MISSING on disk (${named}` +
        `${missing.length > 3 ? ', …' : ''}) — ${totalRows} is a LOWER BOUND, not this build's row cost`,
    );
  }

  return { instBearingIpls: used.length, largestIpl, rows: totalRows };
}

/**
 * The SECOND asi the `sa` target ships (asi/perfect-cutscene plan 001 step 7) — and it is shipped only when
 * the cutscene stage RAN, because that is when it is required and when its effect is one we have measured.
 *
 * **The fleet and the plugin are COUPLED.** A converted cutscene car carries real translucent atomics where
 * vanilla ships almost none, and a `CCutsceneObject` is rendered inline in world-sector scan order, so
 * without the deferral a pane z-writes over whichever actor the scan visited later — the roulette the whole
 * plugin exists to end. The 35-scene sweep was taken on fleet + plugin together; either half alone is a
 * configuration nobody has measured.
 *
 * **Which is also why it does not ship on a build WITHOUT the fleet**: the deferred path renders at
 * `RenderEntity`'s alpha-test ref (100, or 0 in an interior) instead of the outdoor pass's 140, so on vanilla
 * cutscene models it could start drawing glass the main pass had always discarded. Shipping it there would be
 * an unmeasured look change bought for nothing.
 */
export function shipPerfectCutsceneAsi(saDir: string, asiPath: string): null | { sha256: string } {
  return shipAsi(
    saDir,
    asiPath,
    'perfect-cutscene.asi',
    'This build carries a CONVERTED cutscene fleet and the two are coupled; build it with `npm run build:asi` ' +
      'in asi/perfect-cutscene, or install it by hand. Without it a scene actor is erased by whichever car ' +
      'pane the sector scan happened to draw later.',
  );
}

/**
 * The asi this build's map REQUIRES, shipped beside it — plan 006 task 1, and the whole of what that plan
 * still is. The build already emits maps a plain install cannot run (110 055 permanent rows against a stock
 * 32 767), and until now nothing put the fix in the tree: the requirement was stated and then left to be
 * satisfied by hand.
 *
 * **A pre-built artifact, not a build step.** `perfect-map.asi` is cross-compiled macOS→Win32 with MinGW
 * (`npm run build:asi` in `asi/perfect-map`), and a map build has no business requiring a cross-compiler. So
 * this copies what is there and **warns loudly when it is not** — `dist/` is gitignored, so absent is the
 * common case on a fresh checkout and it must never be quiet: a `sa/` tree without it is a map that corrupts
 * exactly as it did before the fix (decision 5, fallback honesty).
 *
 * Returns the pairing for the build manifest: a map built at this density is only correct with THIS asi, and
 * a sha256 is what makes a mismatch detectable rather than a mystery crash (decision 4).
 */
export function shipPerfectMapAsi(saDir: string, asiPath: string): null | { sha256: string } {
  return shipAsi(
    saDir,
    asiPath,
    'perfect-map.asi',
    "This build's map needs it (see the install requirements above); build it with `npm run build:asi` in " +
      'asi/perfect-map, or install it by hand. Without it the game corrupts exactly as it did before the fix.',
  );
}

/** The two asi pairings in the shape `build-timings.json` carries — each absent when nothing was shipped, so
 *  a run states which plugins its output is paired with and never invents a hash it does not have. */
function asiPairings(
  map: null | { sha256: string },
  cutscene: null | { sha256: string },
): { perfectCutsceneAsiSha256?: string; perfectMapAsiSha256?: string } {
  return {
    ...(cutscene ? { perfectCutsceneAsiSha256: cutscene.sha256 } : {}),
    ...(map ? { perfectMapAsiSha256: map.sha256 } : {}),
  };
}

/**
 * Copy one pre-built `.asi` into the game ROOT — where the reference install's 23 plugins live
 * (`gta-sa-original/reference-install-config.md`), not `scripts/`, though the loader accepts both — and
 * return its sha256 for the build manifest.
 *
 * `absentAdvice` is the caller's own answer to "so what?": each asi is required for a different reason and a
 * warning that does not say which is a warning nobody acts on.
 */
function shipAsi(saDir: string, asiPath: string, fileName: string, absentAdvice: string): null | { sha256: string } {
  if (!existsSync(asiPath)) {
    console.warn(`  ! ${fileName} NOT SHIPPED — no artifact at ${asiPath}. ${absentAdvice}`);

    return null;
  }
  const bytes = readFileSync(asiPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(saDir, fileName), bytes);
  log(`sa asi: ${fileName} shipped into the game root (sha256 ${sha256.slice(0, 12)}…, ${bytes.length} B)`);

  return { sha256 };
}

/** SA's `IplEntityIndexArrays` — one slot per text IPL that carries `inst` rows, written past without a bounds
 *  check. **Real on the target**, twice-measured 2026-08-10 (see {@link checkInstBearingIplSlots}). */
export const INST_BEARING_IPL_SLOTS = 40;

/**
 * Fail the build when the tree carries more inst-bearing text IPLs than SA has slots for.
 *
 * **This one was a museum piece until the field made it a gate.** The census above used to print the 39/40
 * `IplEntityIndexArrays` figure and then stopped, on the grounds that OLA lifts it — `EntityIpl = unlimited` is
 * set in the reference install and documents itself as *"Maximum number of IPL files that creates entities"*.
 * The lift does not work. The `sa` build at the shipped density ships **75** inst-bearing IPLs and the game dies
 * loading the **40th** (`plobj10.ipl`), measured twice: with the shipping `perfect-map.asi` and with an
 * `-DPM_FIX_INT16=0` probe of it, so our own asi is not the cause.
 *
 * A ceiling nobody had crossed was not a ceiling anyone had lifted, and the reference install carries only 36 —
 * which is why nothing caught this for a month. The number a plan writes down has to be READ by something:
 * plan 007 budgeted *"stock 30 + 8 = 38 ≤ the 40-slot array"* at 15 283 objects, the density fix took the layer's
 * areas 8 → 46, and no code re-checked it. Pure so it is testable without a game dir — the layer's own share is
 * reported at emit time by `buildLinkedAreas`.
 */
export function checkInstBearingIplSlots(instBearingIpls: number): void {
  if (instBearingIpls <= INST_BEARING_IPL_SLOTS) {
    return;
  }
  throw new Error(
    `${instBearingIpls} inst-bearing text IPLs of ${INST_BEARING_IPL_SLOTS} SA slots ` +
      "(IplEntityIndexArrays) — the game crashes loading the slot past the last, and OLA's EntityIpl " +
      "lift does not work (measured 2026-08-10). Group the layer's permanent rows into FEWER areas: a text " +
      'IPL with no inst rows costs no slot, and rows inside one file are cheap (the field runs 9 627 of them). ' +
      'See tools/map-placement/docs/plans/002-ipl-slot-budget.md.',
  );
}

/**
 * The run's wall clock per stage → `<out>/build-timings.json`, plus a summary table in the log.
 *
 * **Self-describing** (the A/B rule): the file states the target, the procobj knobs and the asi it was
 * produced with, because a duration is only comparable against another run whose configuration is known.
 * Comparing two builds is otherwise a guess about what each one was told to do — and the asi hash is what
 * turns "this map crashes" into "this map is paired with a different asi".
 */
export function writeStageTimings(
  outPath: string,
  timings: readonly StageTiming[],
  config: {
    /** sha256 of the `perfect-cutscene.asi` shipped into `sa/` — the fleet↔asi pairing, same reasoning.
     *  Absent when this build converted no fleet, or when no artifact was available. */
    perfectCutsceneAsiSha256?: string;
    /** sha256 of the `perfect-map.asi` shipped into `sa/` — the map↔asi pairing (006 decision 4). Absent when
     *  no artifact was available, which the run also warns about. */
    perfectMapAsiSha256?: string;
    procobjDensity: ProcObjDensityInput;
    procobjMax?: number;
    target: BuildTarget;
  },
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
  stageSource: Readonly<Record<'cutscene' | 'mods' | 'peds' | 'trees' | 'vehicles', string>>,
): T[] {
  const staged = new Set(chain.map((stage) => stage.name));
  for (const name of ['mods', 'vehicles', 'cutscene', 'peds', 'trees'] as const) {
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
 * The run's work dir (`.work-<target>`, plus the legacy shared `.work`) is wiped before any stage reads
 * `--game`/`--in`, so a source pointing INTO it (the obvious fast path for re-running one stage:
 * `--game <out>/.work-sa/5-trees`) is deleted before it is read. Silent otherwise — the run dies on a missing
 * `gta3.img` seconds after the intermediates are already gone, naming the symptom and never the cause. It
 * cost a full rebuild on 2026-08-09. The OTHER target's work dir is not touched, so a source there is safe.
 */
function refuseSourceInsideWork(work: string, gamePath: string, inPath: string): void {
  for (const [flag, path] of [
    ['--game', gamePath],
    ['--in', inPath],
  ] as const) {
    // Segment-aware: `.work-opensa` must not read as inside `.work` — only that dir itself or its children.
    if (resolve(path) === resolve(work) || resolve(path).startsWith(`${resolve(work)}/`)) {
      throw new Error(
        `${flag} ${path} is inside ${work}, which this run wipes before it reads anything. Copy the ` +
          'intermediate out of `.work` first, or point --out somewhere else.',
      );
    }
  }
}
