/**
 * `audio-events.dat` — the table that says what a NAME means, in sound (203/5-01).
 *
 * **The mapping from an event to a sound is CODE in San Andreas**, not data: it lives in
 * `CAEVehicleAudioEntity`, `CAEPedAudioEntity` and their siblings. So
 * [directive 1](../../../../../docs/project-goals.md) splits the subsystem — the banks, the rates and the
 * loop points are the author's DATA and are read as they were meant, while the event mapping is 2004 logic
 * and is ours to write. Writing it as a TABLE rather than as code is 203's decision 2.2: a mod author can
 * override a sound without a build, and the file says what it means where anyone can read it
 * ([the contract](../../../../../docs/contracts/audio.md)).
 *
 * ```text
 * # event, bank, sound, [gain], [loop|once], [maxDistance]
 * VEH_HORN_1,    12,  3
 * FOOT_GRAVEL,    1,  0, 0.8
 * AMB_CITY_DAY,  40,  2, 0.6, loop, 400
 * ```
 *
 * **Rows are split the way the game splits its own** ({@link splitRow}): commas and whitespace are ONE
 * separator class, because that is what `CFileLoader::LoadLine` does and a mod author's habits come from
 * there. Lines are walked rather than passed through `cleanLines`, because a problem has to name the LINE it
 * was on and a filtered list has lost that. A row that cannot be read is DROPPED and reported rather than
 * guessed at — a sound played at a `NaN` gain is a silence nobody can explain.
 */
import { splitRow } from './text-lines';

/** A row that could not be read, kept so the loader can say WHICH line rather than how many. */
export interface AudioEventProblem {
  readonly line: number;
  readonly reason: string;
  readonly text: string;
}

/** One row of the table: a name, and where its sound lives. */
export interface AudioEventRow {
  /** Index into `BankLkup` — the bank the sound is in. */
  readonly bank: number;
  /** Authored gain before distance, 0..1. Absent in the file means 1. */
  readonly gain: number;
  /** Whether it loops from the sound's own authored loop point. */
  readonly loop: boolean;
  /** How far it carries, in world units. `null` means the engine's default falloff. */
  readonly maxDistance: null | number;
  /** The name a consumer asks for. Upper-cased on read, so the table is case-insensitive to write. */
  readonly name: string;
  /** Slot within the bank. */
  readonly sound: number;
}

/** What one file turned out to be. */
export interface AudioEventTableText {
  readonly problems: readonly AudioEventProblem[];
  readonly rows: readonly AudioEventRow[];
}

/** Read the table. Never throws: a broken file is an empty table plus a list of what was wrong with it. */
export function parseAudioEvents(text: string): AudioEventTableText {
  const problems: AudioEventProblem[] = [];
  const rows: AudioEventRow[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/u);

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) {
      return;
    }
    const cells = splitRow(line);
    const problem = (reason: string): void => {
      problems.push({ line: index + 1, reason, text: line });
    };
    if (cells.length < 3) {
      problem(`a row needs at least a name, a bank and a sound — this one has ${cells.length} field(s)`);

      return;
    }
    const name = (cells[0] ?? '').toUpperCase();
    const bank = Number(cells[1]);
    const sound = Number(cells[2]);
    if (!Number.isInteger(bank) || !Number.isInteger(sound) || bank < 0 || sound < 0) {
      problem('bank and sound must be non-negative whole numbers');

      return;
    }
    const gain = cells.length > 3 ? Number(cells[3]) : 1;
    if (!Number.isFinite(gain) || gain < 0) {
      problem(`gain '${cells[3] ?? ''}' is not a number between 0 and 1`);

      return;
    }
    const loopCell = (cells[4] ?? 'once').toLowerCase();
    if (loopCell !== 'loop' && loopCell !== 'once') {
      problem(`'${cells[4] ?? ''}' is neither 'loop' nor 'once'`);

      return;
    }
    const maxDistance = cells.length > 5 ? Number(cells[5]) : null;
    if (maxDistance !== null && (!Number.isFinite(maxDistance) || maxDistance <= 0)) {
      problem(`maxDistance '${cells[5] ?? ''}' is not a positive number`);

      return;
    }
    if (seen.has(name)) {
      // Later wins, the way a mod layer wins — but a table that silently held two rows for one name would
      // be a sound nobody could predict, so the shadowed row is named.
      problem(`'${name}' is defined more than once — this row wins and the earlier one is dropped`);
    }
    seen.add(name);
    rows.push({ bank, gain: Math.min(1, gain), loop: loopCell === 'loop', maxDistance, name, sound });
  });

  return { problems, rows: dedupe(rows) };
}

/** Keep the LAST row for each name, the way a later mod layer wins. */
function dedupe(rows: readonly AudioEventRow[]): AudioEventRow[] {
  const byName = new Map<string, AudioEventRow>();
  for (const row of rows) {
    byName.set(row.name, row);
  }

  return [...byName.values()];
}
