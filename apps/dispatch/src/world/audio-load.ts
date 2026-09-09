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

import { decodeOsaudio } from '@opensa/engine-formats';
import { parseAudioEvents } from '@opensa/renderware/parsers/text/audio-events.parser';

/** What the console loads into its audio: the addressing, and the vocabulary. */
export interface LoadedAudio {
  /** `null` when this build carries no index — the console then says so once and stays silent. */
  readonly index: null | OsaudioIndex;
  /** Rows the author wrote. Empty when there is no table, which is a build with no named sounds. */
  readonly rows: readonly AudioEventRow[];
}

/** The event table lives where every other authored data file does. */
const EVENT_TABLE = 'data/audio-events.dat';

/** Nothing to hear, and nothing wrong. */
const NO_AUDIO: LoadedAudio = { index: null, rows: [] };

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
  const [index, rows] = await Promise.all([fetchIndex(`${base}/${entry.file}`), fetchRows(gameDir)]);

  return { index, rows };
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
