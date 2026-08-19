/**
 * Why an added car is ever SEEN — plan 004.
 *
 * Nothing in the game references a new model id: no `cargrp` row, no car generator, no mission. What puts it
 * on the street is **ModelVariations 10.7** (mod `11` of the `sa` layer), which swaps a spawning stock car
 * for one of the ids its section lists. So each added car is registered as a variation of the stock slot its
 * folder names as its base:
 *
 *   [manana]
 *   Global=410,19001
 *
 * The base's own id comes first, so the stock car still spawns; every added car naming that base follows, by
 * id and in ascending order, so the list is a function of the fleet and not of the run.
 *
 * **One section per model, keyed by its NAME.** The plugin takes either a name or an id in a header but only
 * ids in a value (its own error string: `invalid model id %s`). The user's earlier tool wrote the tuning keys
 * into `[voodoo]` and the variation list into `[412]` — the same model addressed two ways, in two sections,
 * and whichever the plugin reads last is the one that survives. We write one section per model and merge by
 * KEY, so 004's `Global` and 006's tuning keys compose in it instead of overwriting each other. That this
 * is the better reading is not yet field-proven; it is a row in the plan-102 field round.
 */
import { mergeIniKeys, MODEL_VARIATIONS_INI, readIniKey } from '@opensa/vehicle-installer/model-variations';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LedgerRow } from './ledger';

/** The key whose value is the list of models the plugin may spawn in this slot's place. */
const GLOBAL_KEY = 'Global';

/**
 * The section's `Global` with our ids added, everything it already listed KEPT and in place.
 *
 * That "kept" is the whole point: eight of the fleet's own trucks author a `Global=Trailers1` — a reference
 * to the `Trailers1` key beside it — and `petro` and `towtruck` are ALSO the base of an added car. Writing
 * `Global` outright left `Trailers1` defined and referenced by nothing, which is a trailer behaviour that
 * silently stops happening. A token may be an id, a `paintjobN`, a part name or another key's name; we only
 * ever append ids that are not already in the list.
 */
export function extendGlobal(current: string | undefined, baseId: number, ids: readonly number[]): string {
  const tokens = (current ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '');
  for (const id of [baseId, ...ids]) {
    if (!tokens.includes(String(id))) {
      tokens.push(String(id));
    }
  }

  return tokens.join(',');
}

/**
 * Register every installed car as a variation of its base(s) in the built ModelVariations ini. Returns
 * warnings; refuses when the plugin is not in the build, because an added car nothing spawns is a car
 * nobody will ever see and that must not be silent.
 */
export function registerTraffic(
  gameDir: string,
  installed: readonly LedgerRow[],
  stockIds: ReadonlyMap<string, number>,
): string[] {
  if (installed.length === 0) {
    return [];
  }
  const path = join(gameDir, MODEL_VARIATIONS_INI);
  if (!existsSync(path)) {
    throw new Error(
      `${MODEL_VARIATIONS_INI} is not in the tree — ModelVariations 10.7 (mod 11 of the sa layer) is what ` +
        `puts an added car into traffic, and without it ${installed.length} car(s) would be installed and ` +
        `never seen`,
    );
  }
  const warnings: string[] = [];
  let text = readFileSync(path, 'latin1');
  for (const [base, ids] of variationsByBase(installed, warnings)) {
    const baseId = stockIds.get(base);
    if (baseId === undefined) {
      warnings.push(`no vehicles.ide row for base '${base}' — ${ids.length} car(s) not registered in traffic`);
      continue;
    }
    const global = extendGlobal(readIniKey(text, base, GLOBAL_KEY), baseId, ids);
    text = mergeIniKeys(text, base, new Map([[GLOBAL_KEY, global]]));
  }
  writeFileSync(path, text, 'latin1');

  return warnings;
}

/**
 * base slot → the added ids that vary it, ascending. A car naming several bases appears under each; a car
 * with no base at all is reported (the resolver already refuses one, so this is the belt).
 */
export function variationsByBase(installed: readonly LedgerRow[], warnings: string[]): Map<string, number[]> {
  const byBase = new Map<string, number[]>();
  for (const row of installed) {
    if (row.kind !== 'car') {
      continue;
    }
    if (row.bases.length === 0) {
      warnings.push(`${row.slot} names no base — it is installed but nothing will spawn it`);
      continue;
    }
    for (const base of row.bases) {
      byBase.set(base, [...(byBase.get(base) ?? []), row.id]);
    }
  }
  for (const ids of byBase.values()) {
    ids.sort((a, b) => a - b);
  }

  return new Map([...byBase].sort(([a], [b]) => a.localeCompare(b, 'en')));
}
