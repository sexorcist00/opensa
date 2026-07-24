import { describe, expect, it } from 'vitest';

import { buildClipIndex, loadEnginePlayer } from './engine-player';

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
        getText: (): null => null,
        has: (): boolean => false,
        names: [] as string[],
      };

      expect(() => loadEnginePlayer({} as never, fs as never, 'BMYCG')).toThrow(
        /bmycg\.osm.*GAME_CONFIG\.mainCharacter/,
      );
      expect(requested).toContain('bmycg.osm');
    });
  });
});

/**
 * The clip-registration gate (2026-07-24): the exact decision that made the driver "ride STANDING with his
 * legs out of the car" when the scripted clips did not resolve. Locomotion is always addressable; a scripted
 * clip is registered only when it truly resolved (duration > 0), else it must fall through to the standing
 * locomotion stand-in rather than sampling an empty clip (which would drop the ped to the flat bind pose).
 */
describe('buildClipIndex', () => {
  describe('negative cases', () => {
    it('does NOT register an unresolved scripted clip (duration 0) — it falls through to locomotion', () => {
      const index = buildClipIndex(
        [
          { duration: 1, name: 'idle_stance' },
          { duration: 1, name: 'walk_civi' },
          { duration: 1, name: 'run_civi' },
          { duration: 0, name: 'car_sit' }, // absent from the IFP → unresolved
        ],
        3,
      );

      expect(index.has('car_sit')).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('always registers locomotion clips, even unresolved (duration 0), at their indices', () => {
      const index = buildClipIndex(
        [
          { duration: 0, name: 'idle_stance' },
          { duration: 0, name: 'walk_civi' },
          { duration: 0, name: 'run_civi' },
        ],
        3,
      );

      expect(index.get('idle_stance')).toBe(0);
      expect(index.get('run_civi')).toBe(2);
    });

    it('registers a resolved scripted clip at its index, keyed lowercase', () => {
      const index = buildClipIndex(
        [
          { duration: 1, name: 'idle_stance' },
          { duration: 1, name: 'walk_civi' },
          { duration: 1, name: 'run_civi' },
          { duration: 1.2, name: 'CAR_getin_LHS' },
          { duration: 3, name: 'car_sit' },
        ],
        3,
      );

      expect(index.get('car_getin_lhs')).toBe(3);
      expect(index.get('car_sit')).toBe(4);
    });
  });
});
