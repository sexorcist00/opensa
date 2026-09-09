import { describe, expect, it } from 'vitest';

import { decodeOsaudio, encodeOsaudio, OSAUDIO_MAGIC, type OsaudioIndex } from './osaudio';

/** An index with one of everything: two packages, two banks, three sounds, both zone shapes. */
function sample(): OsaudioIndex {
  return {
    banks: [
      { firstSound: 0, headerOffset: 0, packageIndex: 0, sizeBytes: 12_000, soundCount: 2 },
      { firstSound: 2, headerOffset: 16_804, packageIndex: 1, sizeBytes: 4_000, soundCount: 1 },
    ],
    packages: ['GENRL', 'FEET'],
    sounds: [
      { byteLength: 4_000, byteOffset: 4_804, durationSeconds: 0, headroom: 0, loopOffset: -1, sampleRate: 12_000 },
      {
        byteLength: 8_000,
        byteOffset: 8_804,
        durationSeconds: 0,
        headroom: -300,
        loopOffset: 1_100,
        sampleRate: 8_000,
      },
      { byteLength: 4_000, byteOffset: 21_608, durationSeconds: 0, headroom: 12, loopOffset: -1, sampleRate: 2_021 },
    ],
    zones: [
      {
        active: true,
        id: 0,
        max: [200, 300, 40],
        min: [-100, -200, -30],
        name: 'SAN_ANDR',
        shape: 'box',
      },
      { active: false, centre: [1_500, -1_700, 20], id: 7, name: 'VEGAS_N', radius: 250, shape: 'sphere' },
    ],
  };
}

describe('decodeOsaudio', () => {
  describe('negative cases', () => {
    it('refuses a buffer that is not an .osaudio, naming the magic it saw', () => {
      expect(() => decodeOsaudio(new Uint8Array(64))).toThrow(/not an \.osaudio index \(magic 0x0\)/u);
    });

    it('refuses a major version it does not know, rather than reading the sections anyway', () => {
      // Every offset in this container addresses hundreds of megabytes of somebody's PCM; a layout guess
      // that parses is the failure mode the whole file is written to avoid.
      const bytes = encodeOsaudio(sample());
      new DataView(bytes.buffer, bytes.byteOffset).setUint16(4, 2, true);

      expect(() => decodeOsaudio(bytes)).toThrow(/major version 2, expected 1/u);
    });

    it('refuses a truncated container instead of returning a short table', () => {
      const bytes = encodeOsaudio(sample());

      expect(() => decodeOsaudio(bytes.subarray(0, bytes.byteLength - 8))).toThrow(/declares \d+ bytes of sections/u);
    });
  });

  describe('positive cases', () => {
    it('round trips every table byte for byte', () => {
      const index = sample();

      const back = decodeOsaudio(encodeOsaudio(index));

      expect(back.packages).toEqual(index.packages);
      expect(back.banks).toEqual(index.banks);
      expect(back.zones).toEqual(index.zones);
      expect(back.sounds.map((sound) => sound.byteOffset)).toEqual([4_804, 8_804, 21_608]);
      expect(back.sounds.map((sound) => sound.loopOffset)).toEqual([-1, 1_100, -1]);
      expect(back.sounds.map((sound) => sound.headroom)).toEqual([0, -300, 12]);
    });

    it('DERIVES the duration rather than carrying it — 16-bit mono, two bytes a sample', () => {
      const back = decodeOsaudio(encodeOsaudio(sample()));

      expect(back.sounds[0]?.durationSeconds).toBeCloseTo(2_000 / 12_000, 6);
      expect(back.sounds[1]?.durationSeconds).toBeCloseTo(4_000 / 8_000, 6);
    });

    it('keeps a rate the game authored however odd it is — one stock sound is 2 021 Hz', () => {
      const back = decodeOsaudio(encodeOsaudio(sample()));

      expect(back.sounds[2]?.sampleRate).toBe(2_021);
    });

    it('writes each distinct name once and addresses it by offset', () => {
      const index = sample();
      const shared: OsaudioIndex = {
        ...index,
        packages: ['GENRL', 'GENRL', 'GENRL'],
        zones: [],
      };

      const bytes = encodeOsaudio(shared);

      expect(decodeOsaudio(bytes).packages).toEqual(['GENRL', 'GENRL', 'GENRL']);
      // 'GENRL\0' once, padded to 4 — not three copies.
      expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(24, true)).toBe(8);
    });

    it('starts with the magic, so a served file can be told apart from an HTML error page', () => {
      expect(new DataView(encodeOsaudio(sample()).buffer).getUint32(0, true)).toBe(OSAUDIO_MAGIC);
    });

    it('is a table an empty game can carry — no packages, no sounds, no zones', () => {
      const empty: OsaudioIndex = { banks: [], packages: [], sounds: [], zones: [] };

      expect(decodeOsaudio(encodeOsaudio(empty))).toEqual(empty);
    });
  });
});
