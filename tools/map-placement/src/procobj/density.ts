import type { ProcObjCategoryName } from '@opensa/renderware/map/procobj-categories';

/**
 * The build-time density profile (lod-procobj plan 010 decision 1): what the scatter's lottery cutoff is, per
 * CATEGORY and — more specifically — per category on one SURFACE. **1.0 is the authored density**, above it
 * keeps more of the candidates the scatter generated, below it thins.
 *
 * Three things this shape deliberately does NOT do:
 *
 * - **It is not keyed by target** (decision 2, the user's call 2026-08-09): `sa` and `opensa` render the same
 *   world at the same density, or they are not the same game. The target picks caps and reporting, not content.
 * - **It cannot exceed the candidate ceiling.** A cutoff above `PROC_OBJ_MAX_DENSITY` has nothing left to
 *   keep — the scatter never generated it — so it is refused at config time rather than silently doing nothing.
 * - **It is only LOCAL below the global cap** (decision 8). Every surviving placement feeds one lowest-lottery
 *   slice to `procObjMax`, so once that binds, raising one category DISPLACES the others instead of adding.
 *   The per-category cost breakdown is what makes that visible.
 */
export interface ProcObjDensityConfig {
  /** The cutoff for any category with no entry of its own. Default 1 — the authored density. */
  base?: number;
  /** Per category. Wins over {@link base}. */
  byCategory?: Partial<Record<ProcObjCategoryName, number>>;
  /** Per category ON one surface (surfinfo names, e.g. `p_mountain`). The most specific key wins. */
  bySurface?: Partial<Record<ProcObjCategoryName, Record<string, number>>>;
}

/** A plain number is the whole-profile shorthand — what `--procobj-density` has always meant. */
export type ProcObjDensityInput = number | ProcObjDensityConfig;

/**
 * Every cutoff in the profile, with the key it came from — the validation list, and what a build prints so a
 * capture states its own configuration rather than being identified by memory.
 */
export function densityEntries(config: ProcObjDensityConfig): { key: string; value: number }[] {
  const entries = [{ key: 'base', value: config.base ?? 1 }];
  for (const [category, value] of Object.entries(config.byCategory ?? {})) {
    entries.push({ key: category, value });
  }
  for (const [category, bySurface] of Object.entries(config.bySurface ?? {})) {
    for (const [surface, value] of Object.entries(bySurface)) {
      entries.push({ key: `${category}/${surface}`, value });
    }
  }

  return entries;
}

/** The cutoff for one batch: category×surface beats category beats base beats vanilla. */
export function densityFor(config: ProcObjDensityConfig, category: ProcObjCategoryName, surface: string): number {
  return config.bySurface?.[category]?.[surface] ?? config.byCategory?.[category] ?? config.base ?? 1;
}

/**
 * How a build NAMES the density it ran at (the self-describing-capture rule). A plain number prints as the
 * number it has always printed; a profile prints every key, because "density 1" would be a lie about a build
 * that doubled the rocks.
 */
export function densityLabel(input: ProcObjDensityInput = 1): string {
  return typeof input === 'number'
    ? String(input)
    : densityEntries(input)
        .map(({ key, value }) => `${key}=${value}`)
        .join(' ');
}

/** Normalise the shorthand, so callers downstream only ever see the full shape. */
export function densityProfile(input: ProcObjDensityInput = 1): ProcObjDensityConfig {
  return typeof input === 'number' ? { base: input } : input;
}

/**
 * Refuse a profile the scatter cannot serve, naming the offending KEY — a profile is written by hand, and
 * "density 4 on rocks" fails by quietly keeping every candidate rather than by looking wrong.
 *
 * NaN is the dangerous one and it passes both comparisons (`NaN <= 0` and `NaN > 3` are each false), after
 * which every `lottery < NaN` is false too — a silently EMPTY clutter layer from one mistyped entry.
 */
export function validateDensityProfile(config: ProcObjDensityConfig, maxDensity: number): void {
  for (const { key, value } of densityEntries(config)) {
    if (!Number.isFinite(value) || value <= 0 || value > maxDensity) {
      throw new Error(
        `procobj density '${key}' must be in (0, ${maxDensity}]: got ${value}. The scatter only GENERATES ` +
          `${maxDensity}× the vanilla candidate count, so a higher cutoff has nothing left to keep — raise ` +
          'PROC_OBJ_MAX_DENSITY (procobj-scatter.ts) first, which changes the runtime slider range too.',
      );
    }
  }
}
