/**
 * Bake the stock vehicle audio table out of the reversed game, as a file OpenSA can read (204, 2026-09-11).
 *
 * **In the stock game this is not a file at all.** The settings are a 232-entry array compiled into the
 * executable at `0x860AF0`, indexed by model id from 400, and `data/gtasa_vehicleAudioSettings.cfg` is
 * fastman92's Limit Adjuster exposing it as a table keyed by NAME
 * ([what the columns mean](../../docs/gta-sa-original/vehicle-audio-settings.md)). So a plain copy of the
 * game does not have the file and never will — and until this script, that meant **no car on the dispatch
 * console had an engine**: `audio.vehicles` 0, every unit `unvoiced`, on any install without the adjuster.
 * The first panel-audio flight measured a 150-unit board that sounded like an empty one because of it.
 *
 * **This recovers the DATA and writes our own copy of it**, which is the project's own division: the
 * original is the source of truth for what its data MEANS, never the ceiling for how it is executed. FLA's
 * file still wins wherever one exists, and a mod's `audio.txt` row still merges over both.
 *
 * **It reads the reversed source rather than the exe**, because the exe is not ours to ship and the reversed
 * header carries the same array with its enums spelled out — which is also what makes the output reviewable.
 *
 * ```
 * npx tsx scripts/debug/bake-vehicle-audio.ts --reversed <path to gta-reversed>
 * ```
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the reversed tree keeps the headers this reads, relative to its root. */
const SOURCE = 'gta-reversed-modern/source/game_sa';

/** The array's own order: model ids from here, one row each. */
const FIRST_VEHICLE_MODEL = 400;

/**
 * The last id that is a VEHICLE — `MODEL_UTILTR1`.
 *
 * **The array is longer than the fleet.** It holds 232 entries because that is the slot count the game
 * reserves, and San Andreas ships 212 vehicles (400..611, with no gaps). Ids 612-614 name nothing and 615
 * onwards are VEGETATION, so the last twenty rows index no car: the final one is a denormal volume beside a
 * footsteps bank, which is what an unused slot looks like. Emitting them would put twenty rows in the table
 * under tree names.
 */
const LAST_VEHICLE_MODEL = 611;

/** What the array must contain, so a silently shortened parse cannot pass. */
const EXPECTED_ROWS = 232;

/** Fields of `tVehicleAudioSettings`, in DECLARATION order — which is the file's column order after the name. */
const FIELDS = [
  'VehicleAudioType',
  'PlayerBank',
  'DummyBank',
  'BassSetting',
  'BassFactor',
  'EnginePitch',
  'HornType',
  'HornPitch',
  'DoorType',
  'EngineUpgrade',
  'RadioStation',
  'RadioType',
  'VehicleAudioTypeForName',
  'EngineVolumeOffset',
] as const;

main();

/** Every name this can resolve: by enum, bare, and the bare ones that two enums disagree about. */
interface Names {
  readonly bare: Map<string, number>;
  readonly poisoned: Set<string>;
  readonly scoped: Map<string, number>;
}

/** A `--flag value` pair, or undefined. */
function argOf(flag: string): string | undefined {
  const at = process.argv.indexOf(flag);

  return at === -1 ? undefined : process.argv[at + 1];
}

/** `eBassSetting::NORMAL` → `NORMAL`. The scope carries no information the name does not. */
function bare(token: string): string {
  return token.includes('::') ? (token.split('::').pop() ?? token) : token;
}

/**
 * Record one name under its OWN enum, and under its bare spelling when that is still unambiguous.
 *
 * **A bare name is not safe and the array uses both spellings.** `TRUCK` is `eAEVehicleDoorType::TRUCK` = 3
 * and `eAEVehicleHornType::TRUCK` = 9; a single flat table would have let whichever loaded last poison the
 * other column, with every row still parsing and the file still 232 rows long. So a name claimed twice with
 * two values is POISONED: the scoped spellings both keep working, and a bare use of it is refused rather
 * than guessed.
 */
function define(into: Names, scope: string, name: string, value: number): void {
  into.scoped.set(`${scope}::${name}`, value);
  const already = into.bare.get(name);
  if (already !== undefined && already !== value) {
    into.poisoned.add(name);

    return;
  }
  into.bare.set(name, value);
}

/** The enum a header declares, for scoping its members. */
function enumNameOf(text: string, path: string): string {
  const match = /enum\s+(?:class\s+)?(\w+)/.exec(text);
  if (!match) {
    throw new Error(`no enum declaration in ${path}`);
  }

  return match[1] ?? '';
}

/**
 * The legend, in the marker THIS FORMAT uses.
 *
 * **`;`, not `#`.** It is fastman92's format rather than ours, and the stock file is mostly legend — a
 * header written with `#` parses as 11 broken rows, which is how the first bake was caught.
 */
function header(): string {
  return [
    '; gtasa_vehicleAudioSettings.cfg - the stock table, recovered.',
    ';',
    '; In the stock game this is not a file: it is a 232-entry array compiled into the executable at',
    '; 0x860AF0, and fastman92 Limit Adjuster is what exposes it as a table keyed by model name. This copy',
    '; is baked from the reversed source by scripts/debug/bake-vehicle-audio.ts so that a build with no',
    '; adjuster still voices its cars. A real gtasa_vehicleAudioSettings.cfg in the game dir REPLACES this.',
    ';',
    '; Columns: model, then tVehicleAudioSettings in declaration order -',
    `; ${FIELDS.join(', ')}.`,
    '; -1 means absent, and it means a different absence per column: see',
    '; docs/gta-sa-original/vehicle-audio-settings.md.',
    '',
  ].join('\n');
}

function main(): void {
  const root = argOf('--reversed') ?? '/home/user/gta-reversed';
  const out = argOf('--out') ?? 'tools/opensa-pack/data/vehicle-audio-settings.cfg';
  const source = join(root, SOURCE);

  const names: Names = { bare: new Map(), poisoned: new Set(), scoped: new Map() };
  for (const file of [
    'Audio/Enums/eSoundBank.h',
    'Audio/Enums/SoundIDs.h',
    'Audio/Enums/eAEVehicleSoundType.h',
    'Audio/Enums/eBassSetting.h',
    'Audio/Enums/eAEVehicleDoorType.h',
    'Audio/Enums/eAERadioType.h',
    'Audio/Enums/eAEVehicleAudioTypeForName.h',
    // Its aliases are read below; this pass is for the plain members, `NONE = -1` above all.
    'Audio/Enums/eAEVehicleHornType.h',
  ]) {
    readExplicit(join(source, file), names);
  }
  readSequence(join(source, 'Enums/eRadioID.h'), 'RADIO_INVALID', -1, names);
  readAliases(join(source, 'Audio/Enums/eAEVehicleHornType.h'), names);

  const models = readModels(join(source, 'Enums/eModelID.h'));
  const rows = readRows(join(source, `${'Audio/Entities'}/AEVehicleAudioEntity.VehicleAudioSettings.h`));
  if (rows.length !== EXPECTED_ROWS) {
    throw new Error(`expected ${EXPECTED_ROWS} rows in the array, parsed ${rows.length}`);
  }

  const lines = rows.slice(0, LAST_VEHICLE_MODEL - FIRST_VEHICLE_MODEL + 1).map((row, index) => {
    const id = FIRST_VEHICLE_MODEL + index;
    const model = models.get(id);
    if (model === undefined) {
      throw new Error(`no model name for id ${id}`);
    }
    if (row.length !== FIELDS.length) {
      throw new Error(`${model}: expected ${FIELDS.length} fields, got ${row.length}`);
    }

    return [model, ...row.map((cell) => valueOf(cell, names, model))].join(' ');
  });

  // latin1 like every other data file the game reads, and the header is ASCII on purpose: an em dash does
  // not survive that encoding, and a mangled byte in a file a mod author opens is a poor first impression.
  writeFileSync(out, `${header()}${lines.join('\n')}\n`, 'latin1');
  console.log(`${out}: ${lines.length} rows (${rows.length - lines.length} unused slots past the fleet)`);
}

/** `NAME = SND_OTHER,` — an alias that has to be resolved against what is already known. */
function readAliases(path: string, into: Names): void {
  const text = readFileSync(path, 'utf8');
  const scope = enumNameOf(text, path);
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*([A-Za-z][\w:]*)\s*,/.exec(line);
    const target = match ? (match[2] ?? '') : '';
    const value = match ? (into.scoped.get(target) ?? into.bare.get(bare(target))) : undefined;
    if (match && value !== undefined) {
      define(into, scope, match[1] ?? '', value);
    }
  }
}

/**
 * `NAME = <number>,` — every enum that spells its values out.
 *
 * Names are kept UNSCOPED, because that is how the array writes some of them; a name that two enums define
 * differently would therefore be a silent mis-bake, so one is refused by {@link define} instead.
 */
function readExplicit(path: string, into: Names): void {
  const text = readFileSync(path, 'utf8');
  let scope = enumNameOf(text, path);
  for (const line of text.split('\n')) {
    // One header can declare several enums (`SoundIDs.h` declares one a bank), so the scope follows along.
    const declared = /^\s*enum\s+(?:class\s+)?(\w+)/.exec(line);
    if (declared) {
      scope = declared[1] ?? scope;
      continue;
    }
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(-?\d+)\s*,/.exec(line);
    if (match) {
      define(into, scope, match[1] ?? '', Number(match[2]));
    }
  }
}

/** Vehicle model ids → their lowercase names, which is what the file is keyed by. */
function readModels(path: string): Map<number, string> {
  const models = new Map<number, string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*MODEL_([A-Z0-9_]+)\s*=\s*(\d+)\s*,/.exec(line);
    if (match) {
      const id = Number(match[2]);
      // The first vehicle also has an alias line (`MODEL_LANDSTAL = MODEL_VEHICLE_FIRST`) which this misses
      // on purpose: it names no number, and the numbered line for 400 is `MODEL_VEHICLE_FIRST` itself.
      if (id >= FIRST_VEHICLE_MODEL && !models.has(id)) {
        models.set(id, (match[1] ?? '').toLowerCase());
      }
    }
  }
  models.set(FIRST_VEHICLE_MODEL, 'landstal');

  return models;
}

/** The array's 232 initializer rows, each split into its fields. */
function readRows(path: string): string[][] {
  const text = readFileSync(path, 'utf8');
  const start = text.indexOf('VehicleAudioSettings = {{');
  if (start === -1) {
    throw new Error('the settings array is not in that header');
  }
  const rows: string[][] = [];
  for (const line of text.slice(start).split('\n')) {
    // The trailing comma is OPTIONAL: C++ lets the last element go without one, and the array's does.
    const match = /^\s*\{(.+)\}\s*(?:,\s*)?$/.exec(line);
    if (match) {
      rows.push(splitFields(match[1] ?? ''));
    }
  }

  return rows;
}

/** `NAME,` with no value — an enum that counts up from a stated first. */
function readSequence(path: string, first: string, firstValue: number, into: Names): void {
  const text = readFileSync(path, 'utf8');
  const scope = enumNameOf(text, path);
  let next: null | number = null;
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*(?:=\s*(-?\d+)\s*)?,/.exec(line);
    if (!match) {
      continue;
    }
    const name = match[1] ?? '';
    if (name === first) {
      define(into, scope, name, firstValue);
      next = firstValue + 1;
      continue;
    }
    if (next === null) {
      continue;
    }
    const stated = match[2] === undefined ? null : Number(match[2]);
    const value: number = stated ?? next;
    define(into, scope, name, value);
    next = value + 1;
  }
}

/** Split an initializer's fields on top-level commas. */
function splitFields(body: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of body) {
    if (character === '{' || character === '(') {
      depth += 1;
    } else if (character === '}' || character === ')') {
      depth -= 1;
    }
    if (character === ',' && depth === 0) {
      fields.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim() !== '') {
    fields.push(current.trim());
  }

  return fields;
}

/** One cell as a number: a literal as written, a name looked up. */
function valueOf(cell: string, names: Names, model: string): string {
  // Exponent form is in the array — one row's volume offset is a denormal, `2.3694278e-38`, which is what
  // the executable had at that slot. It is kept as written rather than rounded to zero: this is the
  // authored data, and a reader that wants zero can have zero from it.
  if (/^-?[\d.]+(?:e[+-]?\d+)?$/i.test(cell)) {
    // Floats keep the source's own digits rather than being re-rounded: the table IS the authored data.
    return cell.includes('.') ? String(Number(cell)) : cell;
  }
  if (!cell.includes('::') && names.poisoned.has(cell)) {
    throw new Error(`${model}: '${cell}' means two different things — the array must spell out which enum`);
  }
  const value = names.scoped.get(cell) ?? names.bare.get(bare(cell));
  if (value === undefined) {
    throw new Error(`${model}: '${cell}' is not a name this script resolved`);
  }

  return String(value);
}
