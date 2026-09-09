/**
 * `data/gtasa_vehicleAudioSettings.cfg` — what a car's engine sounds like, as authored data (203/5-02).
 *
 * **This is the one consumer that has a table rather than code**, and it is why the vertical slice starts
 * here. In San Andreas the vehicle audio settings are a 232-entry array COMPILED INTO THE EXECUTABLE
 * (`tVehicleAudioSettings` at `0x860AF0`, ordered by model id from 400) — there is no stock data file to
 * read. **fastman92's Limit Adjuster exposes it as one**, and the `sa` target always runs FLA
 * (`Enable vehicle audio loader = 1`, [the reference install](../../../../../docs/gta-sa-original/reference-install.md)),
 * so on the build we ship to, a car's sound is a row a mod author can write. This repository's own
 * `vehicle-installer` has been merging rows into it since its plan 013, and
 * [`docs/contracts/vehicles.md`](../../../../../docs/contracts/vehicles.md) already documents `audio.txt` as
 * the mod-author half of the same contract.
 *
 * ```text
 * ; A        B  C   D   E  F     G    H   I    J   K  L   M  N   O
 * 106veh     9  -1  -1  0  0.7   1.0  -1  1.0  -1  0  13  1  -1  0.0
 * landstal   0  99  98  0  0.78  1.0  7   1.0  2   0  8   0  0   0.0
 * ```
 *
 * **Fifteen columns, and the fourteen after the model name are `tVehicleAudioSettings` in struct order.**
 * That correspondence is what makes the file readable at all, and it is checked rather than assumed: the
 * struct has exactly fourteen fields, the file's own legend runs `A`..`O`, and every value of the example
 * row above is in range for the field it lands on (`0` is `NORMAL` bass, `-1` is a horn of `NONE`, `13` is
 * a radio station id). The names come from
 * [gta-reversed](../../../../../docs/links.md), read for what the DATA means — the entities that consume it
 * per frame are 2004 logic and are not ours to port ([directive 1](../../../../../docs/project-goals.md)).
 *
 * **Rows are dropped, never guessed.** A row whose column count is not fifteen would be read past its end
 * into the next line's fields — which is precisely what `writeAudioRows` in `vehicle-installer` already
 * refuses to write — and a car played at a `NaN` pitch is a noise nobody can explain.
 */
import { splitRow } from './text-lines';

/** A row that could not be read, kept so a loader can say WHICH line rather than how many. */
export interface VehicleAudioProblem {
  readonly line: number;
  readonly reason: string;
  readonly text: string;
}

/** One car's sound, as the author wrote it. */
export interface VehicleAudioRow {
  /** How much of the bass treatment is applied, 0..1 as authored. */
  readonly bassFactor: number;
  readonly bassSetting: VehicleBassSetting;
  readonly doorType: VehicleDoorKind;
  /** Bank played when the player is NOT in the car — the one a dispatch console ever hears. `null` = none. */
  readonly dummyBank: null | number;
  /** Multiplier on the engine sample's authored pitch, 1 being the sample as recorded. */
  readonly enginePitch: number;
  /** Unused by the game as far as the reverse can tell; carried verbatim rather than dropped. */
  readonly engineUpgrade: number;
  /** The engine's base volume offset, in dB. Positive is louder — trucks author +5 and +6. */
  readonly engineVolumeOffset: number;
  readonly hornPitch: number;
  /** Sound id of the horn within its bank, or `null` for a vehicle with no horn. */
  readonly hornSound: null | number;
  /** The model name the row is keyed by, lower-cased — the loader matches by NAME, not by id. */
  readonly model: string;
  /** Bank played when the player IS in the car. `null` = none (aircraft author one bank, not two). */
  readonly playerBank: null | number;
  /**
   * The station the car starts on, as an `eRadioID`. **A radio switched OFF is the id 13, not an absence** —
   * `null` here means the row said -1, which is `RADIO_INVALID`.
   */
  readonly radioStation: null | number;
  readonly radioType: VehicleRadioKind;
  readonly soundType: VehicleSoundKind;
  /** `eAEVehicleAudioTypeForName` — 40-odd ids used to NAME the kind of car, carried as the number. */
  readonly typeForName: number;
}

/** What one file turned out to be. */
export interface VehicleAudioSettings {
  readonly problems: readonly VehicleAudioProblem[];
  readonly rows: readonly VehicleAudioRow[];
}

/** The bass treatment the author asked for. */
export type VehicleBassSetting = 'boost' | 'cut' | 'normal' | 'unknown';

/** Which door sound set the car uses. */
export type VehicleDoorKind = 'light' | 'new' | 'old' | 'truck' | 'unknown' | 'unset' | 'van';

/** What kind of radio the car carries, which decides whether a station is even chosen. */
export type VehicleRadioKind = 'civilian' | 'disabled' | 'emergency' | 'special' | 'unknown';

/** How the engine is voiced, and the field a consumer branches on. `unknown` is a value the file gave us. */
export type VehicleSoundKind =
  | 'aircraft-helicopter'
  | 'aircraft-plane'
  | 'aircraft-seaplane'
  | 'bike'
  | 'bmx'
  | 'boat'
  | 'car'
  | 'no-vehicle'
  | 'one-gear'
  | 'special'
  | 'train'
  | 'unknown';

/** Columns a row must have: the model name plus `tVehicleAudioSettings`' own fourteen fields. */
export const VEHICLE_AUDIO_COLUMNS = 15;

/**
 * Read the table. Never throws: a broken file is the rows that could be read plus what was wrong with the
 * rest.
 *
 * **A model named twice takes the LAST row**, which is what the loader itself does when a mod appends
 * instead of replacing — and the shadowed row is reported, because a car whose sound nobody can predict is
 * worse than a refusal.
 */
export function parseVehicleAudioSettings(text: string): VehicleAudioSettings {
  const problems: VehicleAudioProblem[] = [];
  const rows: VehicleAudioRow[] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/u).forEach((raw, index) => {
    const line = raw.trim();
    // `;` is this file's comment marker, the way `#` is `audio-events.dat`'s — it is fastman92's format,
    // not ours, and the stock file is mostly legend.
    if (line.length === 0 || line.startsWith(';')) {
      return;
    }
    const cells = splitRow(line);
    const problem = (reason: string): void => {
      problems.push({ line: index + 1, reason, text: line });
    };
    if (cells.length !== VEHICLE_AUDIO_COLUMNS) {
      problem(
        `a row has ${VEHICLE_AUDIO_COLUMNS} columns, this one has ${cells.length} — the loader would ` +
          `read it past its end`,
      );

      return;
    }
    const model = (cells[0] ?? '').toLowerCase();
    const numbers = cells.slice(1).map(Number);
    const bad = numbers.findIndex((value) => !Number.isFinite(value));
    if (bad !== -1) {
      problem(`column ${bad + 2} ('${cells[bad + 1] ?? ''}') is not a number`);

      return;
    }
    if (seen.has(model)) {
      problem(`'${model}' is set more than once — this row wins and the earlier one is dropped`);
    }
    seen.add(model);
    const [
      soundType,
      playerBank,
      dummyBank,
      bassSetting,
      bassFactor,
      enginePitch,
      hornSound,
      hornPitch,
      doorType,
      engineUpgrade,
      radioStation,
      radioType,
      typeForName,
      engineVolumeOffset,
    ] = numbers;
    if (soundType !== undefined && SOUND_KINDS[soundType] === undefined) {
      problem(`sound type ${soundType} is not one of the game's own — the row is kept and read as 'unknown'`);
    }
    rows.push({
      bassFactor: bassFactor ?? 0,
      bassSetting: BASS_SETTINGS[bassSetting ?? -1] ?? 'unknown',
      doorType: DOOR_KINDS[doorType ?? -2] ?? 'unknown',
      dummyBank: absent(dummyBank),
      enginePitch: enginePitch ?? 1,
      engineUpgrade: engineUpgrade ?? 0,
      engineVolumeOffset: engineVolumeOffset ?? 0,
      hornPitch: hornPitch ?? 1,
      hornSound: absent(hornSound),
      model,
      playerBank: absent(playerBank),
      radioStation: absent(radioStation),
      radioType: RADIO_KINDS[radioType ?? -2] ?? 'unknown',
      soundType: SOUND_KINDS[soundType ?? -1] ?? 'unknown',
      typeForName: typeForName ?? -1,
    });
  });

  return { problems, rows: dedupe(rows) };
}

/** `eAEVehicleSoundType`, by its own numbering. */
const SOUND_KINDS: Readonly<Record<number, VehicleSoundKind>> = {
  0: 'car',
  1: 'bike',
  2: 'bmx',
  3: 'boat',
  4: 'aircraft-helicopter',
  5: 'aircraft-plane',
  6: 'aircraft-seaplane',
  7: 'one-gear',
  8: 'train',
  9: 'special',
  10: 'no-vehicle',
};

/** `eBassSetting`. */
const BASS_SETTINGS: Readonly<Record<number, VehicleBassSetting>> = { 0: 'normal', 1: 'boost', 2: 'cut' };

/** `eAEVehicleDoorType`, which starts at -1 rather than 0. */
const DOOR_KINDS: Readonly<Record<number, VehicleDoorKind>> = {
  '-1': 'unset',
  0: 'light',
  1: 'old',
  2: 'new',
  3: 'truck',
  4: 'van',
};

/** `eAERadioType`, which also starts at -1. */
const RADIO_KINDS: Readonly<Record<number, VehicleRadioKind>> = {
  '-1': 'disabled',
  0: 'civilian',
  1: 'special',
  2: 'unknown',
  3: 'emergency',
};

/**
 * A field that says "there is none".
 *
 * **-1 is the file's own absent**, used for a bank a vehicle has not got, a horn it does not carry and a
 * radio that is off — and it is a real id everywhere else, so a consumer that took it as a number would
 * fetch sound -1 and get whatever lies before the bank.
 */
function absent(value: number | undefined): null | number {
  return value === undefined || value < 0 ? null : value;
}

/** Keep the LAST row for each model, the way a later append wins. */
function dedupe(rows: readonly VehicleAudioRow[]): VehicleAudioRow[] {
  const byModel = new Map<string, VehicleAudioRow>();
  for (const row of rows) {
    byModel.set(row.model, row);
  }

  return [...byModel.values()];
}
