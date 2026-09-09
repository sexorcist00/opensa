import { describe, expect, it } from 'vitest';

import { BANK_HEADER_BYTES, readBankHeader, readBankLookup, readPakFiles, soundRange } from './sfx-banks';

/** A 4 804-byte bank header carrying `sounds`, written into a buffer of `size` at `offset`. */
function bankHeader(
  sounds: readonly { bufferOffset: number; headroom?: number; loopOffset?: number; sampleRate: number }[],
  { declared = sounds.length, offset = 0, size = BANK_HEADER_BYTES } = {},
): ArrayBuffer {
  const bytes = new ArrayBuffer(Math.max(size, offset + BANK_HEADER_BYTES));
  const view = new DataView(bytes);
  view.setUint16(offset, declared, true);
  sounds.forEach((sound, index) => {
    const at = offset + 4 + index * 12;
    view.setUint32(at, sound.bufferOffset, true);
    view.setInt32(at + 4, sound.loopOffset ?? -1, true);
    view.setUint16(at + 8, sound.sampleRate, true);
    view.setInt16(at + 10, sound.headroom ?? 0, true);
  });

  return bytes;
}

/** A `BankLkup.dat` of the given entries. */
function bankLookup(
  entries: readonly { headerOffset: number; packageIndex: number; sizeBytes: number }[],
): ArrayBuffer {
  const bytes = new ArrayBuffer(entries.length * 12);
  const view = new DataView(bytes);
  entries.forEach((entry, index) => {
    const at = index * 12;
    view.setUint8(at, entry.packageIndex);
    view.setUint32(at + 4, entry.headerOffset, true);
    view.setUint32(at + 8, entry.sizeBytes, true);
  });

  return bytes;
}

/** A `PakFiles.dat` of the given names: 52 bytes each, NUL-terminated and `0xCD`-padded like the real one. */
function pakFiles(names: readonly string[]): ArrayBuffer {
  const bytes = new Uint8Array(names.length * 52).fill(0xcd);
  names.forEach((name, index) => {
    const at = index * 52;
    for (let i = 0; i < name.length; i += 1) {
      bytes[at + i] = name.charCodeAt(i);
    }
    bytes[at + name.length] = 0;
  });

  return bytes.buffer;
}

describe('readPakFiles', () => {
  describe('negative cases', () => {
    it('refuses a file that is not a whole number of name fields, naming what it saw', () => {
      // A remainder means this is not PakFiles.dat, and a reader that shrugged would hand back a package
      // list that is short by one and mis-index every bank in the game.
      expect(() => readPakFiles(new ArrayBuffer(52 * 3 + 7))).toThrow(/163 bytes.*52-byte names/u);
      expect(() => readPakFiles(new ArrayBuffer(0))).toThrow(/not a whole number/u);
    });
  });

  describe('positive cases', () => {
    it('reads the nine stock package names, stripping the terminator and the padding', () => {
      const names = ['FEET', 'GENRL', 'PAIN_A', 'SCRIPT', 'SPC_EA', 'SPC_FA', 'SPC_GA', 'SPC_NA', 'SPC_PA'];

      const packages = readPakFiles(pakFiles(names));

      expect(packages.map((entry) => entry.name)).toEqual(names);
      expect(packages.map((entry) => entry.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });
  });
});

describe('readBankLookup', () => {
  describe('negative cases', () => {
    it('refuses a file that is not a whole number of entries', () => {
      expect(() => readBankLookup(new ArrayBuffer(12 * 2 + 5))).toThrow(/29 bytes.*12-byte entries/u);
      expect(() => readBankLookup(new ArrayBuffer(0))).toThrow(/not a whole number/u);
    });
  });

  describe('positive cases', () => {
    it('reads the package, the header offset and the bank size past the three padding bytes', () => {
      const banks = readBankLookup(
        bankLookup([
          { headerOffset: 0, packageIndex: 1, sizeBytes: 4_096 },
          { headerOffset: 8_180, packageIndex: 1, sizeBytes: 65_536 },
        ]),
      );

      expect(banks).toEqual([
        { headerOffset: 0, packageIndex: 1, sizeBytes: 4_096 },
        { headerOffset: 8_180, packageIndex: 1, sizeBytes: 65_536 },
      ]);
    });
  });
});

describe('BANK_HEADER_BYTES', () => {
  describe('positive cases', () => {
    it('holds exactly the 400 slots it claims room for — the arithmetic that did not close', () => {
      // It was 4 084 until 2026-09-09, which is 340 slots and not 400, and nothing in the code disagreed:
      // a short header shifts every sound's byte range by the same constant and every derived length stays
      // positive. The file settled it (361 gaps between consecutive banks, all 4 804); this pins it.
      expect(BANK_HEADER_BYTES).toBe(4 + 400 * 12);
      expect((BANK_HEADER_BYTES - 4) / 12).toBe(400);
    });
  });
});

describe('readBankHeader', () => {
  describe('negative cases', () => {
    it('refuses a buffer too short to hold a header at the offset asked for', () => {
      expect(() => readBankHeader(new ArrayBuffer(1_000))).toThrow(/needs 4804 bytes at offset 0/u);
      expect(() => readBankHeader(bankHeader([]), 8)).toThrow(/at offset 8/u);
    });

    it('refuses a count past the 400 slots the header has room for — a wrong offset that parses', () => {
      // This is the guard that matters: at the wrong offset the first two bytes are still a number, and
      // without the ceiling the reader would walk 60 000 "sounds" out of somebody's PCM.
      expect(() => readBankHeader(bankHeader([], { declared: 401 }))).toThrow(/declares 401 sounds, past the 400/u);
    });
  });

  describe('positive cases', () => {
    it('reads only the slots the header declares, whatever the other 400 hold', () => {
      const header = readBankHeader(
        bankHeader([
          { bufferOffset: 0, sampleRate: 22_050 },
          { bufferOffset: 4_410, loopOffset: 1_100, sampleRate: 11_025 },
        ]),
      );

      expect(header.sounds).toEqual([
        { bufferOffset: 0, headroom: 0, loopOffset: -1, sampleRate: 22_050 },
        { bufferOffset: 4_410, headroom: 0, loopOffset: 1_100, sampleRate: 11_025 },
      ]);
    });

    it('keeps a negative headroom and a -1 loop as authored', () => {
      const header = readBankHeader(bankHeader([{ bufferOffset: 0, headroom: -300, sampleRate: 16_000 }]));

      expect(header.sounds[0]).toMatchObject({ headroom: -300, loopOffset: -1 });
    });

    it('reads a bank sitting anywhere in its package', () => {
      const header = readBankHeader(bankHeader([{ bufferOffset: 12, sampleRate: 8_000 }], { offset: 65_536 }), 65_536);

      expect(header.sounds).toHaveLength(1);
    });
  });
});

describe('soundRange', () => {
  const bank = { headerOffset: 1_000, packageIndex: 0, sizeBytes: 10_000 };
  const header = readBankHeader(
    bankHeader([
      { bufferOffset: 0, sampleRate: 22_050 },
      { bufferOffset: 4_000, loopOffset: 500, sampleRate: 11_025 },
      { bufferOffset: 6_000, sampleRate: 22_050 },
    ]),
  );

  describe('negative cases', () => {
    it('refuses a slot the bank does not have, naming both counts', () => {
      expect(() => soundRange(bank, header, 3)).toThrow(/has 3 sounds, not 4/u);
      expect(() => soundRange(bank, header, -1)).toThrow(/has 3 sounds/u);
    });

    it('does not assume the slots are written in ascending order', () => {
      // Nothing in the format guarantees the order, and no test against our own files could ever falsify
      // the assumption — so the end is the smallest offset ABOVE this one rather than the next slot's.
      const shuffled = readBankHeader(
        bankHeader([
          { bufferOffset: 6_000, sampleRate: 22_050 },
          { bufferOffset: 0, sampleRate: 22_050 },
        ]),
      );

      expect(soundRange(bank, shuffled, 1).byteLength).toBe(6_000);
      expect(soundRange(bank, shuffled, 0).byteLength).toBe(4_000);
    });

    it('reports no duration rather than dividing by a rate of zero', () => {
      const broken = readBankHeader(bankHeader([{ bufferOffset: 0, sampleRate: 0 }]));

      expect(soundRange(bank, broken, 0).durationSeconds).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('derives a length from the next buffer, since SoundMeta carries none', () => {
      expect(soundRange(bank, header, 0).byteLength).toBe(4_000);
      expect(soundRange(bank, header, 1).byteLength).toBe(2_000);
    });

    it('runs the LAST sound to the end of the bank', () => {
      expect(soundRange(bank, header, 2).byteLength).toBe(4_000);
    });

    it('puts the buffer after the header, in the package the lookup named', () => {
      expect(soundRange(bank, header, 1).byteOffset).toBe(1_000 + BANK_HEADER_BYTES + 4_000);
    });

    it('reads a duration off the byte count at 16-bit mono', () => {
      // 2 000 bytes = 1 000 samples at 11 025 Hz.
      expect(soundRange(bank, header, 1).durationSeconds).toBeCloseTo(1_000 / 11_025, 6);
    });

    it('carries the loop point through in SAMPLES, as authored', () => {
      expect(soundRange(bank, header, 1).loopOffset).toBe(500);
      expect(soundRange(bank, header, 0).loopOffset).toBe(-1);
    });
  });
});
