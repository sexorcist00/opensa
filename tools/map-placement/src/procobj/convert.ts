import type { ImgArchive } from '@opensa/renderware/archive/img-archive';
import type { ProcObjCategoryName } from '@opensa/renderware/map/procobj-categories';
import type { ProcObjBatch, ProcObjPlacement } from '@opensa/renderware/map/procobj-scatter';

import { buildColliders } from '@opensa/renderware/collision/build-colliders';
import { buildCollisionIndex } from '@opensa/renderware/collision/collision-index';
import { groupRulesBySurface, PROC_OBJ_MAX_DENSITY, scatterProcObjects } from '@opensa/renderware/map/procobj-scatter';
import { parseProcObj } from '@opensa/renderware/parsers/text/procobj.parser';
import { parseSurfaceNames } from '@opensa/renderware/parsers/text/surfinfo.parser';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ProcObjDensityConfig, ProcObjDensityInput } from './density';

import { disableProcObj, stripProcObj, UNDERWATER_PROCOBJ } from '../procobj-strip';
import { buildLinkedAreas } from '../streamed-areas';
import { densityCeiling, densityFor, densityProfile, validateDensityProfile } from './density';
import { buildMapDefinitions } from './world';

/** What one category cost this build — the readable half of decision 8's displacement warning. */
export interface ProcObjCategoryCost {
  category: ProcObjCategoryName;
  /** Survivors of the cutoff that the global `procObjMax` slice then took. */
  dropped: number;
  /** Candidates the scatter produced for this category, before any cutoff. */
  generated: number;
  /** What actually shipped. */
  objects: number;
}

export interface ProcObjConvertOptions {
  archive: ImgArchive;
  /** Base name for the area IPLs (`data/maps/<areaBase><i>.ipl` + gta.dat lines + `<areaBase><i>_stream<k>.ipl`
   *  IMG entries). Keep it ≤ 10 chars: IMG VER2 caps entry names at 23 bytes — e.g. `plobj`. */
  areaBase: string;
  /**
   * Build-time density CUTOFF on the scatter lottery. Every candidate carries
   * `lottery ∈ [0, PROC_OBJ_MAX_DENSITY)`; keeping `lottery < cutoff` is what picks how many survive, so
   * **1 is vanilla** and the count scales with it until `procObjMax` binds instead.
   *
   * A plain number is the whole map; a {@link ProcObjDensityConfig} sets it per category and per
   * category×surface (plan 010 decision 1). It is a build INPUT so an A/B can state what it was configured
   * with — the self-describing-capture rule.
   */
  density?: ProcObjDensityInput;
  /** `--modloader`: emit `procobj.dat` as **disable rows** (converted species' scatter set to zero, replacing the
   *  stock rule by surface+model on additive merge) instead of a stripped whole file — so the strip survives a
   *  Modloader additive `.dat` merge (which would re-add omitted species from stock). Default (false): strip. */
  disableScatter?: boolean;
  gamePath: string;
  /** Only convert species whose HD bbox is at least this tall (excludes grass/small bushes). 0 = no gate. */
  heightThreshold: number;
  /** Base name for the emitted sidecars (`data/maps/<iplName>.models` manifest) — e.g. `lod_procobj`. */
  iplName: string;
  /** Species at least this tall (m) get a PERMANENT text LOD row + lod-link (SA hides the LOD up close);
   *  shorter species ship both rows unlinked in the binary stream — the LOD hides inside the HD, and every
   *  avoided text row protects SA's int16 building-pool index budget (see `LinkedPair.linked`). */
  linkedHeight: number;
  outPath: string;
  /** Safety cap on total placed objects (HD count); the set is thinned to the lowest-lottery survivors. */
  procObjMax: number;
  /** sourceName → registration. Only models that have a generated LOD are candidates. */
  species: ReadonlyMap<string, ProcObjSpecies>;
}

export interface ProcObjConvertResult {
  /** Per-category cost, sorted by category — see {@link ProcObjCategoryCost}. */
  categories: ProcObjCategoryCost[];
  datLines: string[];
  /** Placements the global `procObjMax` slice took, all categories. */
  dropped: number;
  imgFiles: [string, Uint8Array][];
  /** HD objects shipped. */
  objects: number;
  /** Permanent text-IPL rows the linked pairs cost — the layer's price. */
  rows: number;
}

/** Per converted species: the stock HD model id + its generated LOD (id/model name) + bbox height (the gate). */
export interface ProcObjSpecies {
  hdId: number;
  height: number;
  lodId: number;
  lodModel: string;
}

/** One placement that survived the density cutoff, with the category it was judged under. */
export interface SelectedPlacement {
  category: ProcObjCategoryName;
  model: string;
  placement: ProcObjPlacement;
}

/**
 * Emit the static HD+LOD pairs as **streamed areas** (see `buildLinkedAreas`): per area a small text IPL with
 * the permanent LOD rows + binary streams with the HD instances, `lod`-linked to their LOD row.
 *
 * `rows` is the layer's PRICE — the permanent text rows the linked pairs cost. It is the number every density
 * profile moves and the one the `sa` target's int16 ceiling is spent on, so it is counted here (where the
 * link is decided) rather than re-derived by a reader of the emitted files.
 */
export function buildStreamedIpl(
  final: readonly { model: string; placement: ProcObjPlacement }[],
  species: ReadonlyMap<string, ProcObjSpecies>,
  areaBase: string,
  linkedHeight = 0,
): { datLines: string[]; files: [string, string][]; imgFiles: [string, Uint8Array][]; rows: number } {
  const pairs = final.map(({ model, placement }) => {
    const s = species.get(model)!;

    return {
      hd: { id: s.hdId, interior: 0, position: placement.position, rotation: iplQuaternion(placement.rotation) },
      linked: s.height >= linkedHeight,
      lod: { id: s.lodId, model: s.lodModel },
    };
  });

  return { ...buildLinkedAreas(pairs, areaBase), rows: pairs.filter((pair) => pair.linked).length };
}

export function convertProcObj(options: ProcObjConvertOptions): null | ProcObjConvertResult {
  const {
    archive,
    areaBase,
    density = 1,
    disableScatter,
    gamePath,
    heightThreshold,
    iplName,
    linkedHeight,
    outPath,
    procObjMax,
    species,
  } = options;
  const profile = densityProfile(density);
  validateDensityProfile(profile, PROC_OBJ_MAX_DENSITY);
  // The scatter must GENERATE against the same headroom the cutoffs are read against, or a cutoff above the
  // default would keep candidates that were never rolled.
  const ceiling = densityCeiling(profile, PROC_OBJ_MAX_DENSITY);
  const procObjText = readFileSync(join(gamePath, 'data', 'procobj.dat'), 'utf8');

  // Candidate species: have a LOD, clear the optional height gate, and are not the never-touch underwater set.
  const eligible = new Set(
    [...species]
      .filter(([model, s]) => s.height >= heightThreshold && !UNDERWATER_PROCOBJ.has(model.toLowerCase()))
      .map(([model]) => model),
  );
  const rules = parseProcObj(procObjText).filter((rule) => eligible.has(rule.model));
  if (rules.length === 0) {
    return null;
  }
  const converted = new Set(rules.map((rule) => rule.model));

  // Scatter over the whole map at `density`, then a global lowest-lottery cap. Nothing thins by MINDIST: the
  // column is a camera radius, not an inter-object spacing (`docs/gta-sa-original/procedural-objects.md`).
  const defs = buildMapDefinitions(gamePath, archive);
  const colliders = buildColliders(buildCollisionIndex(archive), defs, { center: [0, 0, 0], radius: Infinity });
  const surfaceNames = parseSurfaceNames(readFileSync(join(gamePath, 'data', 'surfinfo.dat'), 'utf8'));
  const batches = scatterProcObjects(colliders, groupRulesBySurface(rules), surfaceNames, 0, 0, ceiling);
  const { categories, dropped, final } = selectPlacements(batches, profile, procObjMax);

  const { datLines, files, imgFiles, rows } = buildStreamedIpl(final, species, areaBase, linkedHeight);
  for (const [file, text] of files) {
    writeText(join(outPath, 'data', 'maps', file), text);
  }
  // Model-name manifest for downstream generators (pmb `collectGeneratedModels`): the HD placement layer now
  // lives in binary streams (id-only records), so the converted species names are no longer greppable from IPLs.
  const placedModels = [...new Set(final.map(({ model }) => model))].sort();
  writeText(join(outPath, 'data', 'maps', `${iplName}.models`), placedModels.join('\r\n') + '\r\n');

  // Stop the converted species scattering at runtime (they're now static). `--out` strips them from a whole-file
  // procobj.dat; `--modloader` emits disable rows instead, so a Modloader additive `.dat` merge can't re-add them.
  writeText(
    join(outPath, 'data', 'procobj.dat'),
    disableScatter
      ? disableProcObj(procObjText, (m) => converted.has(m))
      : stripProcObj(procObjText, (m) => !converted.has(m.toLowerCase())).text,
  );

  return { categories, datLines, dropped, imgFiles, objects: final.length, rows };
}

/** GTA IPL rotation quaternion for a yaw around Z (conjugated, the IPL convention; align is unused). */
export function iplQuaternion(yaw: number): [number, number, number, number] {
  return [0, 0, -Math.sin(yaw / 2), Math.cos(yaw / 2)];
}

/**
 * Apply the density profile to the scattered batches, then the global `procObjMax` slice — the whole of what a
 * profile DOES, with no file or collision work in it, which is what makes it testable without a game dir.
 *
 * `dropped` is the honest half of the cap (decision 7): once `procObjMax` binds, raising a cutoff stops adding
 * objects and starts DISPLACING them, because the slice keeps the lowest lotteries across every category at
 * once. A measurement that does not state the drop is measuring the cap and calling it the density — and the
 * per-category breakdown is what makes displacement readable, since "bushes +8 000, rocks −8 000" and
 * "+0 objects" are the same total.
 */
export function selectPlacements(
  batches: readonly ProcObjBatch[],
  profile: ProcObjDensityConfig,
  procObjMax: number,
): { categories: ProcObjCategoryCost[]; dropped: number; final: SelectedPlacement[] } {
  const generated = new Map<ProcObjCategoryName, number>();
  const placed: SelectedPlacement[] = [];
  for (const batch of batches) {
    // A batch is one model on one SURFACE, so `densityFor` can answer on either axis without the converter
    // knowing which one a profile used.
    const cutoff = densityFor(profile, batch.category, batch.surface);
    generated.set(batch.category, (generated.get(batch.category) ?? 0) + batch.placements.length);
    for (const placement of batch.placements) {
      if (placement.lottery < cutoff) {
        placed.push({ category: batch.category, model: batch.model, placement });
      }
    }
  }
  placed.sort((a, b) => a.placement.lottery - b.placement.lottery);
  const final = placed.slice(0, procObjMax);

  return { categories: categoryCosts(generated, placed, final), dropped: placed.length - final.length, final };
}

/** Per category: candidates generated, survivors of the cutoff, and how many of those the global cap took. */
function categoryCosts(
  generated: ReadonlyMap<ProcObjCategoryName, number>,
  placed: readonly { category: ProcObjCategoryName }[],
  final: readonly { category: ProcObjCategoryName }[],
): ProcObjCategoryCost[] {
  const kept = new Map<ProcObjCategoryName, number>();
  for (const entry of placed) {
    kept.set(entry.category, (kept.get(entry.category) ?? 0) + 1);
  }
  const shipped = new Map<ProcObjCategoryName, number>();
  for (const entry of final) {
    shipped.set(entry.category, (shipped.get(entry.category) ?? 0) + 1);
  }

  return [...generated.keys()].sort().map((category) => ({
    category,
    dropped: (kept.get(category) ?? 0) - (shipped.get(category) ?? 0),
    generated: generated.get(category) ?? 0,
    objects: shipped.get(category) ?? 0,
  }));
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
