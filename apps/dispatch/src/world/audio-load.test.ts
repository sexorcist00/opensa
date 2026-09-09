import { encodeOsaudio } from '@opensa/engine-formats';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadAudio } from './audio-load';

/** An index with one bank and one sound — enough to tell "decoded" from "did not". */
function indexBytes(): Uint8Array {
  return encodeOsaudio({
    banks: [{ firstSound: 0, headerOffset: 0, packageIndex: 0, sizeBytes: 24, soundCount: 1 }],
    packages: ['GENRL'],
    sounds: [{ byteLength: 24, byteOffset: 0, durationSeconds: 0, headroom: 0, loopOffset: -1, sampleRate: 12_000 }],
    zones: [],
  });
}

/** Serve a fixed set of URLs; everything else 404s. */
function serve(files: Record<string, string | Uint8Array>): string[] {
  const asked: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    asked.push(url);
    const body = files[url];
    if (body === undefined) {
      return Promise.resolve({ ok: false, status: 404 } as Response);
    }

    return Promise.resolve({
      arrayBuffer: () => Promise.resolve(typeof body === 'string' ? new ArrayBuffer(0) : body.slice().buffer),
      ok: true,
      status: 200,
      text: () => Promise.resolve(typeof body === 'string' ? body : ''),
    } as Response);
  });

  return asked;
}

const ENTRY = { banks: 1, file: 'audio.osaudio', sounds: 1, zones: 0 };

/** What every "nothing to hear" case answers with. */
const NOTHING = { defs: new Map(), handling: new Map(), index: null, rows: [], vehicles: [] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadAudio', () => {
  describe('negative cases', () => {
    it('asks for nothing when the manifest has no audio field', async () => {
      const asked = serve({});

      await expect(loadAudio('/pak', '/game', undefined)).resolves.toEqual(NOTHING);

      expect(asked).toEqual([]);
    });

    it('is a silent world rather than a throw when the index is not served', async () => {
      serve({ '/game/data/audio-events.dat': 'HORN, 0, 0' });

      const loaded = await loadAudio('/pak', '/game', ENTRY);

      expect(loaded.index).toBeNull();
      expect(loaded.rows).toHaveLength(1);
    });

    it('survives a server that answers an index URL with an HTML error page', async () => {
      // The container is not ours, the magic will not match, and `decodeOsaudio` throws — which is exactly
      // the state "this build has no index", and the console already knows how to be that.
      serve({ '/pak/audio.osaudio': new Uint8Array(64) });

      await expect(loadAudio('/pak', '', ENTRY)).resolves.toEqual(NOTHING);
    });

    it('does not go looking for an event table on a pak-only deploy', async () => {
      const asked = serve({ '/pak/audio.osaudio': indexBytes() });

      const loaded = await loadAudio('/pak', '', ENTRY);

      expect(loaded.index?.packages).toEqual(['GENRL']);
      expect(asked).toEqual(['/pak/audio.osaudio']);
    });

    it('answers with no rows when fetch itself rejects', async () => {
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));

      await expect(loadAudio('/pak', '/game', ENTRY)).resolves.toEqual(NOTHING);
    });
  });

  describe('positive cases', () => {
    it('reads the index beside the pak and the table from the game dir, at the same time', async () => {
      const asked = serve({
        '/game/data/audio-events.dat': '# a table\nHORN, 0, 0, 0.8\n',
        '/pak/audio.osaudio': indexBytes(),
      });

      const loaded = await loadAudio('/pak', '/game', ENTRY);

      expect(loaded.index?.sounds).toHaveLength(1);
      expect(loaded.rows).toEqual([{ bank: 0, gain: 0.8, loop: false, maxDistance: null, name: 'HORN', sound: 0 }]);
      // Five questions, all in flight together: the index, the event table, and the three files a car's
      // engine is voiced from.
      expect(asked).toHaveLength(5);
    });

    it('joins the three vehicle files, so a car has a bank AND a top speed', async () => {
      serve({
        '/game/data/gtasa_vehicleAudioSettings.cfg': 'copcarla 0 99 98 0 0.78 1.0 7 1.0 2 0 8 0 38 0.0\n',
        '/game/data/handling.cfg': 'COPCARLA 1600.0 5000.0 2.5 0.0 0.3 -0.15 75 0.8 0.85 0.5 5 200.0 24.0 10.0 R P\n',
        '/game/data/vehicles.ide':
          'cars\n596, copcarla, copcarla, car, COPCARLA, POLICE, null, poorfamily, 7, 0, 0, -1, 0.7, 0.7, 0\nend\n',
        '/pak/audio.osaudio': indexBytes(),
      });

      const loaded = await loadAudio('/pak', '/game', ENTRY);

      expect(loaded.vehicles).toHaveLength(1);
      expect(loaded.vehicles[0]?.dummyBank).toBe(98);
      expect(loaded.defs.get('copcarla')?.handlingId).toBe('COPCARLA');
      // Field 11 after the id: 200 km/h.
      expect(loaded.handling.get('COPCARLA')?.fields[11]).toBe('200.0');
    });
  });
});
