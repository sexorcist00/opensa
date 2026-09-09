/**
 * What one car needs to be voiced: its two engine sounds, and how fast it can go (203/5-02).
 *
 * Three authored files meet here, and none of them is ours:
 *
 * - **`gtasa_vehicleAudioSettings.cfg`** gives the DUMMY BANK, the engine pitch and the volume offset
 *   ([what the columns mean](../../../docs/gta-sa-original/vehicle-audio-settings.md)). It is keyed by model
 *   NAME, which is exactly what a dispatch unit carries.
 * - **`vehicles.ide`** maps that model name to a HANDLING ID.
 * - **`handling.cfg`** gives that id's `fMaxVelocity`, which is the denominator of the ratio the engine
 *   model is driven by.
 *
 * **The two slots inside the bank are the game's own** (`eDummyEngineSoundType`): slot 0 is `AE_DUMMY_CRZ`,
 * the rev loop, and slot 1 is `AE_DUMMY_ID`, the idle one. Nothing in the file says so — it is code — which
 * is why it is written down here and in the contract rather than left as two magic numbers.
 *
 * **Everything is resolved at LOAD**, the way the event table is, so a car that is not in this build is a
 * line in the report rather than a lookup that fails the moment somebody drives past.
 */
import type { OsaudioIndex } from '@opensa/engine-formats';
import type { HandlingEntry } from '@opensa/renderware/parsers/text/handling.parser';
import type { VehicleAudioRow } from '@opensa/renderware/parsers/text/vehicle-audio.parser';
import type { VehicleDef } from '@opensa/renderware/parsers/text/vehicle-defs.parser';

import type { AudioAbsence } from './absence';

/** One car, ready to voice. */
export interface VehicleVoice {
  /** The row's own pitch multiplier — column G, applied on top of the engine model's. */
  readonly enginePitch: number;
  /** Index into `OsaudioIndex.sounds` for the idle loop. */
  readonly idleSound: number;
  /** Top speed in metres a second, from `handling.cfg`. */
  readonly maxSpeedMs: number;
  readonly model: string;
  /** Index into `OsaudioIndex.sounds` for the rev loop. */
  readonly revSound: number;
  /** Column O, in dB. Positive on trucks — the author saying a rig is louder than a sedan. */
  readonly volumeOffsetDb: number;
}

/** `AE_DUMMY_CRZ` — the rev loop's slot inside the dummy bank. */
export const REV_SLOT = 0;

/** `AE_DUMMY_ID` — the idle loop's slot. */
export const IDLE_SLOT = 1;

/** `fMaxVelocity`'s position among a handling row's fields, after the id. */
export const MAX_VELOCITY_FIELD = 11;

/** What the game's own rows use when a handling row will not parse — the adapter's own default. */
export const DEFAULT_MAX_VELOCITY_KMH = 160;

/** km/h to m/s. */
const KMH_TO_MS = 1 / 3.6;

/** The cars this build can voice, by model name. */
export class VehicleVoiceTable {
  get size(): number {
    return this.voices.size;
  }

  private readonly voices: ReadonlyMap<string, VehicleVoice>;

  private constructor(voices: ReadonlyMap<string, VehicleVoice>) {
    this.voices = voices;
  }

  /** Nothing to voice, and nothing wrong — a build with no vehicle audio table. */
  static empty(): VehicleVoiceTable {
    return new VehicleVoiceTable(new Map());
  }

  /**
   * Join the three files against this build's index.
   *
   * A car is dropped when its bank is not in this build or is too small to hold both slots; a car whose
   * handling row is missing keeps the game's own default top speed rather than being dropped, because a
   * wrong denominator is a car that revs early and a dropped car is a car that is silent.
   */
  static resolve(
    rows: readonly VehicleAudioRow[],
    defs: ReadonlyMap<string, VehicleDef> | readonly VehicleDef[],
    handling: ReadonlyMap<string, HandlingEntry>,
    index: null | OsaudioIndex,
    absence: AudioAbsence,
  ): VehicleVoiceTable {
    const voices = new Map<string, VehicleVoice>();
    if (index === null) {
      return new VehicleVoiceTable(voices);
    }
    const byModel = defsByModel(defs);
    for (const row of rows) {
      if (row.dummyBank === null) {
        continue;
      }
      const bank = index.banks[row.dummyBank];
      if (!bank || bank.soundCount <= IDLE_SLOT) {
        absence.unresolvedRow(row.model, `dummy bank ${row.dummyBank} cannot hold both engine slots`);
        continue;
      }
      voices.set(row.model, {
        enginePitch: row.enginePitch,
        idleSound: bank.firstSound + IDLE_SLOT,
        maxSpeedMs: maxSpeedOf(row.model, byModel, handling),
        model: row.model,
        revSound: bank.firstSound + REV_SLOT,
        volumeOffsetDb: row.engineVolumeOffset,
      });
    }

    return new VehicleVoiceTable(voices);
  }

  /** The car, or `null`. Silent — a board full of cars this build cannot voice would say it 150 times. */
  find(model: null | string): null | VehicleVoice {
    return model === null ? null : (this.voices.get(model.toLowerCase()) ?? null);
  }
}

/** Model name → def, however the caller happens to hold them. */
function defsByModel(defs: ReadonlyMap<string, VehicleDef> | readonly VehicleDef[]): ReadonlyMap<string, VehicleDef> {
  if (!Array.isArray(defs)) {
    return defs as ReadonlyMap<string, VehicleDef>;
  }

  return new Map((defs as readonly VehicleDef[]).map((def) => [def.model.toLowerCase(), def]));
}

/** A car's top speed in m/s, from its handling row — the game's own default when there is none. */
function maxSpeedOf(
  model: string,
  defs: ReadonlyMap<string, VehicleDef>,
  handling: ReadonlyMap<string, HandlingEntry>,
): number {
  const handlingId = defs.get(model)?.handlingId;
  const field = handlingId === undefined ? undefined : handling.get(handlingId)?.fields[MAX_VELOCITY_FIELD];
  const kmh = Number(field);

  return (Number.isFinite(kmh) && kmh > 0 ? kmh : DEFAULT_MAX_VELOCITY_KMH) * KMH_TO_MS;
}
