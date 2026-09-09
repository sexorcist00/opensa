import type { AssetFileSystem } from '@opensa/renderware';

import { decodeOsaudio } from '@opensa/engine-formats';
import { describe, expect, it } from 'vitest';

import { AUDIO_INDEX_FILE, type AudioRangeReader, buildAudioIndex } from './audio-index';

const HEADER_BYTES = 4_804;

/** One bank header: a count and its `SoundMeta` rows. */
function bankHeader(sounds: readonly { bufferOffset: number; loopOffset?: number; sampleRate: number }[]): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, sounds.length, true);
  sounds.forEach((sound, index) => {
    const at = 4 + index * 12;
    view.setUint32(at, sound.bufferOffset, true);
    view.setInt32(at + 4, sound.loopOffset ?? -1, true);
    view.setUint16(at + 8, sound.sampleRate, true);
    view.setInt16(at + 10, 0, true);
  });

  return bytes;
}

/** `BankLkup.dat`: package · 3 pad · header offset · PCM size. */
function bankLookup(
  entries: readonly { headerOffset: number; packageIndex: number; sizeBytes: number }[],
): ArrayBuffer {
  const bytes = new ArrayBuffer(entries.length * 12);
  const view = new DataView(bytes);
  entries.forEach((entry, index) => {
    view.setUint8(index * 12, entry.packageIndex);
    view.setUint32(index * 12 + 4, entry.headerOffset, true);
    view.setUint32(index * 12 + 8, entry.sizeBytes, true);
  });

  return bytes;
}

/** An `AssetFileSystem` over a handful of named files, and nothing else. */
function fakeFs(files: Record<string, ArrayBuffer | string>): AssetFileSystem {
  return {
    get: (name) => {
      const found = files[name];

      return typeof found === 'string' || found === undefined ? null : found;
    },
    getText: (name) => {
      const found = files[name];

      return typeof found === 'string' ? found : null;
    },
    has: (name) => name in files,
    names: Object.keys(files),
  };
}

/** `PakFiles.dat`: 52 bytes a name, NUL-terminated and 0xCD-padded like the game's. */
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

const GTA_DAT = 'IPL DATA\\MAPS\\audiozon.ipl\n';
const AUZO_IPL = `
auzo
SAN_ANDR, 0, 1, -100, -200, -30, 200, 300, 40
VEGAS_N, 7, 0, 1500, -1700, 20, 250
end
`;

describe('buildAudioIndex', () => {
  describe('negative cases', () => {
    it('returns null for a game with no audio/CONFIG rather than an empty index', () => {
      // A total conversion may ship none, and an EMPTY index and an ABSENT one say different things: one is
      // "this game has no sounds", the other is "nobody baked them".
      expect(buildAudioIndex(fakeFs({}), () => null)).toBeNull();
      expect(buildAudioIndex(fakeFs({ 'audio/CONFIG/PakFiles.dat': pakFiles(['GENRL']) }), () => null)).toBeNull();
    });

    it('SKIPS a bank whose package cannot be read, and names it, rather than aborting the bake', () => {
      const fs = fakeFs({
        'audio/CONFIG/BankLkup.dat': bankLookup([{ headerOffset: 0, packageIndex: 0, sizeBytes: 100 }]),
        'audio/CONFIG/PakFiles.dat': pakFiles(['GENRL']),
      });

      const bake = buildAudioIndex(fs, () => null);

      expect(bake?.skipped).toEqual([{ bank: 0, reason: "package 'GENRL' is not readable" }]);
      expect(bake?.manifest.banks).toBe(0);
    });

    it('SKIPS a bank whose header will not parse, keeping the ones that do', () => {
      const broken = new Uint8Array(HEADER_BYTES);
      new DataView(broken.buffer).setUint16(0, 401, true);
      const fs = fakeFs({
        'audio/CONFIG/BankLkup.dat': bankLookup([
          { headerOffset: 0, packageIndex: 0, sizeBytes: 8_000 },
          { headerOffset: 12_804, packageIndex: 0, sizeBytes: 4_000 },
        ]),
        'audio/CONFIG/PakFiles.dat': pakFiles(['GENRL']),
      });
      const read: AudioRangeReader = (_name, offset) =>
        offset === 0 ? bankHeader([{ bufferOffset: 0, sampleRate: 12_000 }]) : broken;

      const bake = buildAudioIndex(fs, read);

      expect(bake?.manifest.banks).toBe(1);
      expect(bake?.skipped[0]?.reason).toMatch(/declares 401 sounds/u);
    });
  });

  describe('positive cases', () => {
    const fs = fakeFs({
      'audio/CONFIG/BankLkup.dat': bankLookup([
        { headerOffset: 0, packageIndex: 0, sizeBytes: 8_000 },
        { headerOffset: 12_804, packageIndex: 1, sizeBytes: 4_000 },
      ]),
      'audio/CONFIG/PakFiles.dat': pakFiles(['GENRL', 'FEET']),
      'data/gta.dat': GTA_DAT,
      'data/maps/audiozon.ipl': AUZO_IPL,
    });
    const read: AudioRangeReader = (name, offset) =>
      name === 'GENRL' && offset === 0
        ? bankHeader([
            { bufferOffset: 0, sampleRate: 12_000 },
            { bufferOffset: 4_000, loopOffset: 1_100, sampleRate: 8_000 },
          ])
        : bankHeader([{ bufferOffset: 0, sampleRate: 22_050 }]);

    it('addresses every sound ABSOLUTELY, with the bank header already folded in', () => {
      const bake = buildAudioIndex(fs, read);
      const index = decodeOsaudio(bake?.bytes ?? new Uint8Array());

      // Bank 0 sits at offset 0, so its first buffer starts right after the 4 804-byte header.
      expect(index.sounds[0]?.byteOffset).toBe(HEADER_BYTES);
      expect(index.sounds[1]?.byteOffset).toBe(HEADER_BYTES + 4_000);
      // Bank 1 sits at 12 804 in a different package.
      expect(index.sounds[2]?.byteOffset).toBe(12_804 + HEADER_BYTES);
    });

    it('derives each length from the next buffer, and the last from the bank size', () => {
      const index = decodeOsaudio(buildAudioIndex(fs, read)?.bytes ?? new Uint8Array());

      expect(index.sounds.map((sound) => sound.byteLength)).toEqual([4_000, 4_000, 4_000]);
    });

    it('keeps the packages, the bank spans and the loop points', () => {
      const index = decodeOsaudio(buildAudioIndex(fs, read)?.bytes ?? new Uint8Array());

      expect(index.packages).toEqual(['GENRL', 'FEET']);
      expect(index.banks).toEqual([
        { firstSound: 0, headerOffset: 0, packageIndex: 0, sizeBytes: 8_000, soundCount: 2 },
        { firstSound: 2, headerOffset: 12_804, packageIndex: 1, sizeBytes: 4_000, soundCount: 1 },
      ]);
      expect(index.sounds.map((sound) => sound.loopOffset)).toEqual([-1, 1_100, -1]);
    });

    it('carries the map audio zones, both shapes, with `flags == 1` as active', () => {
      const index = decodeOsaudio(buildAudioIndex(fs, read)?.bytes ?? new Uint8Array());

      expect(index.zones).toEqual([
        { active: true, id: 0, max: [200, 300, 40], min: [-100, -200, -30], name: 'SAN_ANDR', shape: 'box' },
        { active: false, centre: [1_500, -1_700, 20], id: 7, name: 'VEGAS_N', radius: 250, shape: 'sphere' },
      ]);
    });

    it('names the file it is written as, so the manifest and the writer cannot drift', () => {
      expect(buildAudioIndex(fs, read)?.manifest).toEqual({ banks: 2, file: AUDIO_INDEX_FILE, sounds: 3, zones: 2 });
    });

    it('reads only a header per bank — never the package', () => {
      const asked: number[] = [];
      buildAudioIndex(fs, (name, offset, length) => {
        asked.push(length);

        return read(name, offset, length);
      });

      expect(asked).toEqual([HEADER_BYTES, HEADER_BYTES]);
    });
  });
});
