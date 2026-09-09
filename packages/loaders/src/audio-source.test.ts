import type { OsaudioIndex } from '@opensa/engine-formats';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { openAudioSource } from './audio-source';

/** Two packages, two banks, three sounds — the smallest index that can get a package wrong. */
function index(): OsaudioIndex {
  return {
    banks: [
      { firstSound: 0, headerOffset: 0, packageIndex: 0, sizeBytes: 16, soundCount: 2 },
      { firstSound: 2, headerOffset: 100, packageIndex: 1, sizeBytes: 8, soundCount: 1 },
    ],
    packages: ['GENRL', 'FEET'],
    sounds: [
      { byteLength: 8, byteOffset: 10, durationSeconds: 0, headroom: 0, loopOffset: -1, sampleRate: 12_000 },
      { byteLength: 6, byteOffset: 18, durationSeconds: 0, headroom: 0, loopOffset: -1, sampleRate: 12_000 },
      { byteLength: 4, byteOffset: 40, durationSeconds: 0, headroom: 0, loopOffset: -1, sampleRate: 8_000 },
    ],
    zones: [],
  };
}

/** A package file whose bytes are their own offset, so a wrong range is visible in the samples. */
function packageBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_value, at) => at % 256);
}

/** A file per package, served over `Range:` the way a static host does. Records every URL and range asked. */
function serve(files: Record<string, Uint8Array>, options: { ignoreRange?: boolean; status?: number } = {}): string[] {
  const asked: string[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const range = String((init?.headers as Record<string, string> | undefined)?.Range ?? '');
    asked.push(`${url} ${range}`);
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const bytes = files[path];
    if (!bytes || options.status === 404) {
      return Promise.resolve({ ok: false, status: 404 } as Response);
    }
    const parsed = /bytes=(\d+)-(\d+)/u.exec(range);
    const slice = options.ignoreRange || !parsed ? bytes : bytes.subarray(Number(parsed[1]), Number(parsed[2]) + 1);

    return Promise.resolve({
      arrayBuffer: () => Promise.resolve(slice.slice().buffer),
      ok: true,
      status: options.ignoreRange ? 200 : 206,
    } as Response);
  });

  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openAudioSource', () => {
  describe('negative cases', () => {
    it('is null without a game dir, and null for an index with no sounds', () => {
      expect(openAudioSource('', index())).toBeNull();
      expect(openAudioSource('/game', { banks: [], packages: [], sounds: [], zones: [] })).toBeNull();
    });

    it('answers null and NAMES the package when it is not served — never a throw', async () => {
      serve({}, { status: 404 });
      const source = openAudioSource('/game', index());

      await expect(source?.read(0)).resolves.toBeNull();

      expect([...(source?.missing ?? [])]).toEqual(['GENRL']);
    });

    it('answers null when fetch itself rejects — an offline host is silence, not an exception', async () => {
      vi.stubGlobal('fetch', () => Promise.reject(new Error('network down')));
      const source = openAudioSource('/game', index());

      await expect(source?.read(0)).resolves.toBeNull();
      expect([...(source?.missing ?? [])]).toEqual(['GENRL']);
    });

    it('REFUSES a host that ignored the range and sent the whole package', async () => {
      // The dangerous case: 200 with 305 MB of SCRIPT, whose first samples sound like a real answer. The
      // length is the only tell, and the index states exactly what was asked for.
      serve({ '/game/audio/SFX/GENRL': packageBytes(64) }, { ignoreRange: true });
      const source = openAudioSource('/game', index());

      await expect(source?.read(0)).resolves.toBeNull();
      expect([...(source?.missing ?? [])]).toEqual(['GENRL']);
    });

    it('answers null for a sound the index does not have', async () => {
      serve({ '/game/audio/SFX/GENRL': packageBytes(64) });
      const source = openAudioSource('/game', index());

      await expect(source?.read(9)).resolves.toBeNull();
      await expect(source?.read(-1)).resolves.toBeNull();
    });
  });

  describe('positive cases', () => {
    it('asks for exactly the byte range the index states, out of the right package', async () => {
      const asked = serve({
        '/game/audio/SFX/FEET': packageBytes(64),
        '/game/audio/SFX/GENRL': packageBytes(64),
      });
      const source = openAudioSource('/game', index());

      await source?.read(1);
      await source?.read(2);

      expect(asked).toEqual(['/game/audio/SFX/GENRL bytes=18-23', '/game/audio/SFX/FEET bytes=40-43']);
    });

    it('returns the bytes as signed 16-bit samples, little-endian', async () => {
      serve({ '/game/audio/SFX/GENRL': packageBytes(64) });
      const source = openAudioSource('/game', index());

      const samples = await source?.read(0);

      // Bytes 10..17 are 10,11,…,17 → 0x0b0a, 0x0d0c, 0x0f0e, 0x1110.
      expect([...(samples ?? [])]).toEqual([0x0b0a, 0x0d0c, 0x0f0e, 0x1110]);
    });

    it('truncates an odd byte count to the sample below rather than refusing the sound', async () => {
      const odd: OsaudioIndex = {
        ...index(),
        sounds: [{ byteLength: 5, byteOffset: 0, durationSeconds: 0, headroom: 0, loopOffset: -1, sampleRate: 8_000 }],
      };
      serve({ '/game/audio/SFX/GENRL': packageBytes(64) });
      const source = openAudioSource('/game', odd);

      const samples = await source?.read(0);

      expect(samples?.length).toBe(2);
    });

    it('resolves the package from the BANK table, not from the sound order', async () => {
      const asked = serve({
        '/game/audio/SFX/FEET': packageBytes(64),
        '/game/audio/SFX/GENRL': packageBytes(64),
      });
      const source = openAudioSource('/game', index());

      await source?.read(2);

      expect(asked[0]).toContain('/FEET ');
      expect([...(source?.missing ?? [])]).toEqual([]);
    });
  });
});
