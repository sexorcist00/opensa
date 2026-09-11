/**
 * The two files that give the console something to hear (203/6-01).
 *
 * Both are LOOSE and both are fetched the way `districts.json` is: the pak's manifest points at
 * `audio.osaudio` beside it, and the event table is a data file of the built game, next to `handling.cfg`.
 * Neither is required, and **absence is the normal case** — a pak served without its game dir, a total
 * conversion, a build made before the index existed — so a failure here is an empty answer rather than a
 * throw, exactly like the districts.
 *
 * The two questions are independent, so they are asked at the same time.
 */
import type { OsaudioIndex } from '@opensa/engine-formats';
import type { AudioEventRow } from '@opensa/renderware/parsers/text/audio-events.parser';
import type { HandlingEntry } from '@opensa/renderware/parsers/text/handling.parser';
import type { VehicleAudioRow } from '@opensa/renderware/parsers/text/vehicle-audio.parser';
import type { VehicleDef } from '@opensa/renderware/parsers/text/vehicle-defs.parser';

import { decodeOsaudio } from '@opensa/engine-formats';
import { parseAudioEvents } from '@opensa/renderware/parsers/text/audio-events.parser';
import { parseHandling } from '@opensa/renderware/parsers/text/handling.parser';
import { parseVehicleAudioSettings } from '@opensa/renderware/parsers/text/vehicle-audio.parser';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';

/** What the console loads into its audio: the addressing, and the vocabulary. */
export interface LoadedAudio {
  /** Model name → its def, from `vehicles.ide` — the handling id lives there. Empty on a pak-only deploy. */
  readonly defs: ReadonlyMap<string, VehicleDef>;
  /** Handling id → its row, for the top speed an engine's ratio is taken against. */
  readonly handling: ReadonlyMap<string, HandlingEntry>;
  /** `null` when this build carries no index — the console then says so once and stays silent. */
  readonly index: null | OsaudioIndex;
  /**
   * Paths a consumer needed and this build does not serve, each with what goes quiet without it.
   *
   * **Its absence cost the first panel-audio flight** (2026-09-11): a missing
   * `gtasa_vehicleAudioSettings.cfg` turned into an empty array here, every car on a 150-unit board went
   * unvoiced, and the only trace in the capture was `vehicles: 0`. Nothing was said, so the run measured a
   * board that sounded empty while every field in the report stayed plausible.
   */
  readonly missing: readonly { readonly path: string; readonly what: string }[];
  /** Rows the author wrote. Empty when there is no table, which is a build with no named sounds. */
  readonly rows: readonly AudioEventRow[];
  /** One row a car, from FLA's own table — the engine bank, its pitch and its volume offset. */
  readonly vehicles: readonly VehicleAudioRow[];
}

/** The event table lives where every other authored data file does. */
const EVENT_TABLE = 'data/audio-events.dat';

/** FLA's vehicle audio loader table — the one file here the game itself reads. */
const VEHICLE_TABLE = 'data/gtasa_vehicleAudioSettings.cfg';

/** Where a model name becomes a handling id. */
const VEHICLE_DEFS = 'data/vehicles.ide';

/** Where that handling id becomes a top speed. */
const HANDLING = 'data/handling.cfg';

/** Nothing to hear, and nothing wrong. */
const NO_AUDIO: LoadedAudio = {
  defs: new Map(),
  handling: new Map(),
  index: null,
  missing: [],
  rows: [],
  vehicles: [],
};

/** What each table is FOR, in the words a reader of a capture needs. */
const NEEDED_FOR: Readonly<Record<string, string>> = {
  [HANDLING]: 'no car has a top speed, so no engine can be voiced',
  [VEHICLE_DEFS]: 'no model name resolves to a handling id, so no engine can be voiced',
  [VEHICLE_TABLE]: 'no car has an engine bank — every unit on the board is unvoiced',
};

/**
 * Fetch the index beside the pak and the event table from the game dir.
 *
 * @param base where the pak's own files are served from.
 * @param gameDir the built game beside it, or `''` for a pak-only deploy.
 * @param entry the manifest's `audio` field — absent on a build with no audio at all.
 */
export async function loadAudio(
  base: string,
  gameDir: string,
  entry: undefined | { banks: number; file: string; sounds: number; zones: number },
): Promise<LoadedAudio> {
  if (!entry) {
    return NO_AUDIO;
  }
  // Five independent questions to two servers, so they are all asked at once — the same reason the pak's
  // own side files are fetched in one wave.
  const [index, rows, vehicles, defs, handling] = await Promise.all([
    fetchIndex(`${base}/${entry.file}`),
    fetchRows(gameDir),
    fetchText(gameDir, VEHICLE_TABLE),
    fetchText(gameDir, VEHICLE_DEFS),
    fetchText(gameDir, HANDLING),
  ]);

  // A file that did not answer is NAMED rather than turned into an empty map and forgotten. The three are
  // one story — any one of them missing unvoices the whole fleet — but which one it was decides the fix.
  const missing = (
    [
      [VEHICLE_TABLE, vehicles],
      [VEHICLE_DEFS, defs],
      [HANDLING, handling],
    ] as const
  )
    .filter(([, text]) => text === null)
    .map(([path]) => ({ path, what: NEEDED_FOR[path] ?? 'something this build wanted goes quiet' }));

  return {
    defs: defs === null ? new Map() : parseVehicleDefs(defs),
    handling: handling === null ? new Map() : parseHandling(handling),
    index,
    missing,
    rows,
    vehicles: vehicles === null ? [] : parseVehicleAudioSettings(vehicles).rows,
  };
}

/** The baked index, or `null` when it is not served or will not decode. */
async function fetchIndex(url: string): Promise<null | OsaudioIndex> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    return decodeOsaudio(new Uint8Array(await response.arrayBuffer()));
  } catch {
    // A 404, an HTML error page, a container that is not ours: all of them are "this build has no index",
    // which the console already knows how to be.
    return null;
  }
}

/** The author's rows. A build with no table has no named sounds, which is not an error. */
async function fetchRows(gameDir: string): Promise<readonly AudioEventRow[]> {
  if (gameDir === '') {
    return [];
  }
  try {
    const response = await fetch(`${gameDir}/${EVENT_TABLE}`);
    if (!response.ok) {
      return [];
    }

    return parseAudioEvents(await response.text()).rows;
  } catch {
    return [];
  }
}

/** One data file of the built game, or `null`. Absence is the normal case for every one of them. */
async function fetchText(gameDir: string, path: string): Promise<null | string> {
  if (gameDir === '') {
    return null;
  }
  try {
    const response = await fetch(`${gameDir}/${path}`);

    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}
