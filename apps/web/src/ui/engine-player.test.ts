import { describe, expect, it } from 'vitest';

import { loadEnginePlayer } from './engine-player';

/**
 * The missing-model path only: the happy path needs a real ped `.osm` (a full readPedOsm fixture) and
 * is exercised in the field by every boot. What matters here is the NEW contract (2026-07-23): the
 * model comes from `GAME_CONFIG.mainCharacter` — the lookup must use the configured name (lowercased)
 * and the error must say where the name came from (the gostown BMYPOL1-without-a-model case).
 */
describe('loadEnginePlayer', () => {
  describe('negative cases', () => {
    it('looks up the CONFIGURED model (lowercased) and throws naming it + its config source', () => {
      const requested: string[] = [];
      const fs = {
        get: (name: string): null => {
          requested.push(name);

          return null;
        },
        getText: () => null,
        has: () => false,
        names: [] as string[],
      };

      expect(() => loadEnginePlayer({} as never, fs as never, 'BMYCG')).toThrow(
        /bmycg\.osm.*GAME_CONFIG\.mainCharacter/,
      );
      expect(requested).toContain('bmycg.osm');
    });
  });
});
