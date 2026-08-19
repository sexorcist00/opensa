/**
 * TUNED traffic — plan 006, the user's call.
 *
 * ModelVariations can spawn a car already wearing its mod-shop parts and one of its paint jobs. That is a
 * separate feature from "an added car appears at all" (004) and it applies to the WHOLE fleet, stock cars
 * included: it is what stops a city of factory-fresh bodies from looking like one.
 *
 *   [blade]
 *   Global=536,paintjob1,…,bnt_b_lr_bl,exh_lr_bl1,…
 *   TuningFullBodykit=1
 *   TuningChance=75
 *   ChangeOnlyParked=0
 *
 * **Everything in `Global` is read off the BUILT tree**, never authored: the model's own id from
 * `vehicles.ide`, one `paintjobN` per `<slot><N>.txd` the archives actually hold, and every part on the
 * model's `carmods.dat` line — which after 005 is the ADDED car's derived parts and after a mod install is
 * whatever bodykit the replacement car shipped. So a car nobody has seen yet is handled by the same rules.
 *
 * The three keys are tunable without touching code (`add-vehicles.json` in the source root), because how
 * often traffic should be tuned is taste, not a fact about the game. The `exclude` list is there for the
 * same reason the plugin ships its own `ExcludeModelsFromInheritance`: police, emergency and trains look
 * wrong tuned.
 */
import { parseCarmods } from '@opensa/renderware/parsers/text/carmods.parser';
import { openArchiveIndex } from '@opensa/tool-kit/archive/layout';
import { mergeIniKeys, MODEL_VARIATIONS_INI, readIniKey } from '@opensa/vehicle-installer/model-variations';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { extendGlobal } from './traffic';

/** The optional config file, beside the added cars. */
export const CONFIG_FILE = 'add-vehicles.json';

/** How ModelVariations should spawn a tuned car; the defaults are the ones the user's earlier build ran. */
export interface TunedTrafficConfig {
  /** `0` = tuned cars anywhere, `1` = only the parked ones. */
  readonly changeOnlyParked: number;
  /** Models never given a tuned section — police, emergency, trains, whatever looks wrong tuned. */
  readonly exclude: readonly string[];
  /** Percent of spawns that are tuned at all. */
  readonly tuningChance: number;
  /** Off = one part at a time, on = the whole kit. */
  readonly tuningFullBodykit: number;
}

export const DEFAULT_TUNED_TRAFFIC: TunedTrafficConfig = {
  changeOnlyParked: 0,
  exclude: [],
  tuningChance: 75,
  tuningFullBodykit: 1,
};

/**
 * How many paint-job dictionaries each model has in the archives: `<slot>1.txd`, `<slot>2.txd`, … counted
 * upward until one is missing, which is how the game numbers them. Read from the ARCHIVE rather than from
 * the mod folders, so a stock car's own paint jobs count the same as a mod's.
 */
export function countPaintjobs(gameDir: string, models: readonly string[]): Map<string, number> {
  const index = openArchiveIndex(gameDir);
  const counts = new Map<string, number>();
  for (const model of models) {
    let count = 0;
    while (index.archiveOf(`${model}${count + 1}.txd`) !== null) {
      count += 1;
    }
    if (count > 0) {
      counts.set(model, count);
    }
  }

  return counts;
}

/** Read `add-vehicles.json` from the source root; every field optional, missing file = the defaults. */
export function readTunedTrafficConfig(inPath: string): TunedTrafficConfig {
  const path = join(inPath, CONFIG_FILE);
  if (!existsSync(path)) {
    return DEFAULT_TUNED_TRAFFIC;
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<TunedTrafficConfig>;

  return {
    changeOnlyParked: parsed.changeOnlyParked ?? DEFAULT_TUNED_TRAFFIC.changeOnlyParked,
    exclude: (parsed.exclude ?? []).map((model) => model.toLowerCase()),
    tuningChance: parsed.tuningChance ?? DEFAULT_TUNED_TRAFFIC.tuningChance,
    tuningFullBodykit: parsed.tuningFullBodykit ?? DEFAULT_TUNED_TRAFFIC.tuningFullBodykit,
  };
}

/**
 * Give every model that HAS something to show — a paint job or a mod-shop part — its tuned section. Returns
 * how many were written; does nothing at all when the plugin is not in the build (004 has already refused by
 * then, and this feature alone is not worth a second refusal).
 */
export function registerTunedTraffic(
  gameDir: string,
  config: TunedTrafficConfig,
  ids: ReadonlyMap<string, number>,
): number {
  const path = join(gameDir, MODEL_VARIATIONS_INI);
  if (!existsSync(path)) {
    return 0;
  }
  const carmods = parseCarmods(readFileSync(join(gameDir, 'data', 'carmods.dat'), 'latin1'));
  const paintjobs = countPaintjobs(gameDir, [...ids.keys()]);
  let text = readFileSync(path, 'latin1');
  let written = 0;
  for (const [model, id] of [...ids].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    if (config.exclude.includes(model)) {
      continue;
    }
    const tokens = [
      ...Array.from({ length: paintjobs.get(model) ?? 0 }, (_, index) => `paintjob${index + 1}`),
      ...(carmods.mods.get(model) ?? []),
    ];
    if (tokens.length === 0) {
      continue;
    }
    text = mergeIniKeys(
      text,
      model,
      new Map([
        ['ChangeOnlyParked', String(config.changeOnlyParked)],
        ['Global', extendGlobal(readIniKey(text, model, 'Global'), id, [], tokens)],
        ['TuningChance', String(config.tuningChance)],
        ['TuningFullBodykit', String(config.tuningFullBodykit)],
      ]),
    );
    written += 1;
  }
  writeFileSync(path, text, 'latin1');

  return written;
}
