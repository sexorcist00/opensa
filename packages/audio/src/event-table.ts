/**
 * What a NAME means, resolved against the index that shipped with this build (203/5-01).
 *
 * The parser reads the author's rows ([`audio-events.parser.ts`](../../renderware/src/parsers/text/audio-events.parser.ts));
 * this turns them into something playable, which means one thing above all: **a (bank, slot) pair becomes
 * the flat sound id `openAudioSource` takes**, once, at load — so nothing walks the bank table per sound.
 *
 * **A row that points nowhere is dropped at LOAD, not at play.** A table built against a different index —
 * a mod's `audio-events.dat` on a stock build, a stock table on a total conversion — would otherwise fail
 * silently at the moment the sound was wanted, which is the worst possible time to find out. Every drop is
 * counted and named through {@link AudioAbsence}.
 */
import type { OsaudioIndex } from '@opensa/engine-formats';
import type { AudioEventRow } from '@opensa/renderware/parsers/text/audio-events.parser';

import type { AudioAbsence } from './absence';
import type { Falloff } from './spatial';

import { DEFAULT_FALLOFF } from './spatial';

/** One resolved event: everything a voice needs, and no lookup left to do. */
export interface AudioEvent {
  readonly falloff: Falloff;
  readonly gain: number;
  readonly loop: boolean;
  /** Where the sound loops from, in seconds — derived from the index's authored sample offset. */
  readonly loopStartSeconds: number;
  readonly name: string;
  /** Index into {@link OsaudioIndex.sounds}. */
  readonly soundIndex: number;
}

/** The table a consumer asks by name. */
export class AudioEventTable {
  get size(): number {
    return this.events.size;
  }
  private readonly absence: AudioAbsence;

  private readonly events: ReadonlyMap<string, AudioEvent>;

  private constructor(events: ReadonlyMap<string, AudioEvent>, absence: AudioAbsence) {
    this.absence = absence;
    this.events = events;
  }

  /**
   * A table with nothing in it and nothing to say.
   *
   * **Not the same as resolving against a null index**, which reports that this BUILD carries no audio: a
   * console that has not been handed one yet is a different state, and saying otherwise at construction
   * would put a line in every log a second before `load` arrives.
   */
  static empty(absence: AudioAbsence): AudioEventTable {
    return new AudioEventTable(new Map(), absence);
  }

  /**
   * Resolve every row against an index, dropping the ones that point nowhere.
   *
   * A `null` index is a build with no audio at all: the table is EMPTY rather than half-built, and the
   * absence says so once instead of once per row.
   */
  static resolve(rows: readonly AudioEventRow[], index: null | OsaudioIndex, absence: AudioAbsence): AudioEventTable {
    const events = new Map<string, AudioEvent>();
    if (index === null) {
      absence.indexAbsent();

      return new AudioEventTable(events, absence);
    }
    for (const row of rows) {
      const bank = index.banks[row.bank];
      if (!bank) {
        absence.unresolvedRow(row.name, `bank ${row.bank} is not in this build (it has ${index.banks.length})`);
        continue;
      }
      if (row.sound >= bank.soundCount) {
        absence.unresolvedRow(row.name, `bank ${row.bank} has ${bank.soundCount} sound(s), not ${row.sound + 1}`);
        continue;
      }
      const soundIndex = bank.firstSound + row.sound;
      const sound = index.sounds[soundIndex];
      if (!sound) {
        absence.unresolvedRow(row.name, `sound ${soundIndex} is past the end of the index`);
        continue;
      }
      events.set(row.name, {
        falloff: row.maxDistance === null ? DEFAULT_FALLOFF : { ...DEFAULT_FALLOFF, maxDistance: row.maxDistance },
        gain: row.gain,
        loop: row.loop,
        // The index carries the author's loop point in SAMPLES; a voice wants seconds, and -1 (a one-shot)
        // becomes 0, which is where a loop that was never authored would start anyway.
        loopStartSeconds: sound.loopOffset > 0 && sound.sampleRate > 0 ? sound.loopOffset / sound.sampleRate : 0,
        name: row.name,
        soundIndex,
      });
    }

    return new AudioEventTable(events, absence);
  }

  /** The event, or `null` and ONE line naming what nothing carries. */
  find(name: string): AudioEvent | null {
    const found = this.events.get(name.toUpperCase());
    if (!found) {
      this.absence.unknownName(name.toUpperCase());

      return null;
    }

    return found;
  }

  /**
   * Whether the table carries a name, WITHOUT reporting its absence.
   *
   * The ambience bed probes for layers that were never authored (`AMB_X_2`, `_3`, `_4`) on every zone
   * change, and {@link find} would fill the report with names nobody meant to write.
   */
  has(name: string): boolean {
    return this.events.has(name.toUpperCase());
  }
}
