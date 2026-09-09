import type { OsaudioIndex } from '@opensa/engine-formats';
import type { AudioEventRow } from '@opensa/renderware/parsers/text/audio-events.parser';

import { describe, expect, it, vi } from 'vitest';

import { AudioAbsence } from './absence';
import { AudioEventTable } from './event-table';
import { DEFAULT_FALLOFF } from './spatial';

/** Two banks: the first holds two sounds, the second one — and the second's loops from sample 1 100. */
function index(): OsaudioIndex {
  return {
    banks: [
      { firstSound: 0, headerOffset: 0, packageIndex: 0, sizeBytes: 100, soundCount: 2 },
      { firstSound: 2, headerOffset: 200, packageIndex: 0, sizeBytes: 50, soundCount: 1 },
    ],
    packages: ['GENRL'],
    sounds: [
      { byteLength: 24, byteOffset: 0, durationSeconds: 0, headroom: 0, loopOffset: -1, sampleRate: 12_000 },
      { byteLength: 24, byteOffset: 24, durationSeconds: 0, headroom: 0, loopOffset: -1, sampleRate: 12_000 },
      { byteLength: 48, byteOffset: 48, durationSeconds: 0, headroom: 0, loopOffset: 1_100, sampleRate: 11_000 },
    ],
    zones: [],
  };
}

function row(over: Partial<AudioEventRow> = {}): AudioEventRow {
  return { bank: 0, gain: 1, loop: false, maxDistance: null, name: 'A', sound: 0, ...over };
}

describe('AudioEventTable', () => {
  describe('negative cases', () => {
    it('is EMPTY for a build with no index, and says so once rather than once a row', () => {
      const log = vi.fn();
      const absence = new AudioAbsence(log);

      const table = AudioEventTable.resolve([row(), row({ name: 'B' }), row({ name: 'C' })], null, absence);

      expect(table.size).toBe(0);
      expect(log).toHaveBeenCalledTimes(1);
      expect(absence.report().noIndex).toBe(true);
    });

    it('drops a row whose BANK this build does not have, at load rather than at play', () => {
      // A table built against a different index would otherwise fail at the moment the sound was wanted,
      // which is the worst possible time to find out.
      const absence = new AudioAbsence(() => undefined);

      const table = AudioEventTable.resolve([row({ bank: 99, name: 'GONE' })], index(), absence);

      expect(table.size).toBe(0);
      expect(absence.report().reasons[0]).toMatch(/bank 99 is not in this build \(it has 2\)/u);
    });

    it('drops a row whose SLOT is past the end of its bank, and says how many there are', () => {
      const absence = new AudioAbsence(() => undefined);

      AudioEventTable.resolve([row({ name: 'PAST', sound: 5 })], index(), absence);

      expect(absence.report().reasons[0]).toMatch(/bank 0 has 2 sound\(s\), not 6/u);
    });

    it('answers null and names an event nothing carries, once', () => {
      const log = vi.fn();
      const table = AudioEventTable.resolve([], index(), new AudioAbsence(log));

      expect(table.find('NOPE')).toBeNull();
      expect(table.find('NOPE')).toBeNull();
      expect(log).toHaveBeenCalledTimes(1);
    });
  });

  describe('positive cases', () => {
    it('turns a (bank, slot) pair into the FLAT sound id, once, at load', () => {
      const table = AudioEventTable.resolve(
        [row({ name: 'FIRST' }), row({ bank: 1, name: 'SECOND', sound: 0 })],
        index(),
        new AudioAbsence(() => undefined),
      );

      expect(table.find('FIRST')?.soundIndex).toBe(0);
      expect(table.find('SECOND')?.soundIndex).toBe(2);
    });

    it('reads the loop point out of the INDEX, in seconds, from the author’s samples', () => {
      const table = AudioEventTable.resolve(
        [row({ bank: 1, loop: true, name: 'BED', sound: 0 })],
        index(),
        new AudioAbsence(() => undefined),
      );

      expect(table.find('BED')?.loopStartSeconds).toBeCloseTo(1_100 / 11_000, 6);
      expect(table.find('BED')?.loop).toBe(true);
    });

    it('gives a one-shot a loop start of zero rather than the -1 the format carries', () => {
      const table = AudioEventTable.resolve([row({ name: 'SHOT' })], index(), new AudioAbsence(() => undefined));

      expect(table.find('SHOT')?.loopStartSeconds).toBe(0);
    });

    it('takes the row’s own maxDistance and leaves the rest of the falloff alone', () => {
      const table = AudioEventTable.resolve(
        [row({ maxDistance: 400, name: 'FAR' }), row({ name: 'NEAR' })],
        index(),
        new AudioAbsence(() => undefined),
      );

      expect(table.find('FAR')?.falloff).toEqual({ ...DEFAULT_FALLOFF, maxDistance: 400 });
      expect(table.find('NEAR')?.falloff).toBe(DEFAULT_FALLOFF);
    });

    it('is case-insensitive to ask, because it is case-insensitive to write', () => {
      const table = AudioEventTable.resolve([row({ name: 'HORN' })], index(), new AudioAbsence(() => undefined));

      expect(table.find('horn')?.name).toBe('HORN');
    });
  });
});
