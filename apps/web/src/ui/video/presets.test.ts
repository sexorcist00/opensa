import { mulberry32 } from '@opensa/game/paths/rng';
import { WEATHER_NAMES } from '@opensa/renderware';
import { describe, expect, it } from 'vitest';

import {
  buildProgram,
  HOUR_SLOTS,
  MOD_CAR_PREFERENCE,
  parseSceneLimit,
  parseSceneStart,
  pickCar,
  PROGRAM_LENGTH,
  REGION_CYCLE,
  SCENE_LIMIT,
  sceneSeed,
  weatherPool,
} from './presets';

/** A stock roster shape: a handful of road cars, two of which a mod has taken over. */
const ROSTER = ['admiral', 'banshee', 'comet', 'infernus', 'sultan', 'taxi'];
const MODS = new Set(['comet', 'infernus']);

describe('weatherPool', () => {
  describe('negative cases', () => {
    it('never lets another region’s weather into a pool (D7)', () => {
      const losSantos = weatherPool(WEATHER_NAMES, 'LA').map((index) => WEATHER_NAMES[index]);

      expect(losSantos.filter((name) => !name.endsWith('_LA'))).toEqual([]);
      expect(losSantos).not.toContain('RAINY_SF');
    });

    it('returns nothing for a region this game authors no weather for', () => {
      // A total conversion may ship a timecyc with only its own rows; the caller then leaves the weather alone
      // rather than inventing an index into someone else's list.
      expect(weatherPool(['EXTRASUNNY_LA', 'CLOUDY_LA'], 'DESERT')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('finds a pool for every region in the cycle, out of the shipped names', () => {
      for (const region of REGION_CYCLE) {
        expect(weatherPool(WEATHER_NAMES, region).length).toBeGreaterThan(0);
      }
    });
  });
});

describe('buildProgram', () => {
  describe('negative cases', () => {
    it('never repeats or drops a region among the drive scenes', () => {
      for (let seed = 0; seed < 20; seed += 1) {
        const drives = buildProgram(mulberry32(seed))
          .filter((entry) => entry.kind === 'drive')
          .map((entry) => entry.region);

        expect(new Set(drives).size).toBe(REGION_CYCLE.length);
      }
    });

    it('never names a region outside the cycle', () => {
      const regions = buildProgram(mulberry32(3)).map((entry) => entry.region);

      expect(regions.filter((region) => !REGION_CYCLE.includes(region))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('drives every region in the cycle order, then the flythroughs and the walk (D2/D3)', () => {
      const program = buildProgram(mulberry32(11));

      expect(program.filter((entry) => entry.kind === 'drive').map((entry) => entry.region)).toEqual([...REGION_CYCLE]);
      expect(program.map((entry) => entry.kind)).toEqual([
        'drive',
        'drive',
        'drive',
        'drive',
        'drive',
        'fly',
        'fly',
        'walk',
      ]);
    });

    it('reproduces itself from the seed', () => {
      expect(buildProgram(mulberry32(47))).toEqual(buildProgram(mulberry32(47)));
    });
  });
});

describe('sceneSeed', () => {
  describe('negative cases', () => {
    it('does not hand two scenes of a run the same seed', () => {
      const seeds = new Set(Array.from({ length: 200 }, (unused, index) => sceneSeed(47, index)));

      expect(seeds.size).toBe(200);
    });
  });

  describe('positive cases', () => {
    it('is the same for the same scene however the run reached it (D9)', () => {
      expect(sceneSeed(47, 7)).toBe(sceneSeed(47, 7));
      expect(sceneSeed(48, 7)).not.toBe(sceneSeed(47, 7));
    });
  });
});

describe('pickCar', () => {
  describe('negative cases', () => {
    it('returns null rather than a name when there is nothing to drive', () => {
      expect(pickCar(mulberry32(1), [], MODS)).toBeNull();
    });

    it('never picks a ledger name the roster does not carry', () => {
      // A ledger listing a slot this build has no model for (a mod removed since it was written) must not put
      // that name in a scene — the spawn would throw.
      const ledger = new Set(['alsomissing', 'nosuchcar']);
      for (let seed = 0; seed < 50; seed += 1) {
        expect(ROSTER).toContain(pickCar(mulberry32(seed), ROSTER, ledger));
      }
    });

    it('does not let the ledger change how far the seeded stream advances', () => {
      // A seed must name the same scene list whatever mods are installed, so the preference roll is taken
      // unconditionally: two runs of the same seed differ in the CAR, never in everything after it.
      const withMods = mulberry32(9);
      const without = mulberry32(9);
      pickCar(withMods, ROSTER, MODS);
      pickCar(without, ROSTER, new Set());

      expect(withMods()).toBe(without());
    });
  });

  describe('positive cases', () => {
    it('prefers mod cars without ever excluding the stock ones (D10)', () => {
      const picks = Array.from({ length: 400 }, (unused, seed) => pickCar(mulberry32(seed), ROSTER, MODS));
      const mods = picks.filter((model) => model !== null && MODS.has(model)).length;

      expect(mods / picks.length).toBeCloseTo(MOD_CAR_PREFERENCE, 1);
      expect(picks.some((model) => model !== null && !MODS.has(model))).toBe(true);
    });

    it('takes a stock car when the ledger is empty', () => {
      expect(ROSTER).toContain(pickCar(mulberry32(5), ROSTER, new Set()));
    });
  });
});

describe('parseSceneLimit', () => {
  describe('negative cases', () => {
    it('takes the full run rather than refusing to start on a typo', () => {
      // A showcase run is something a screen recorder is already pointed at: a bad `?scenes=` costs the typo,
      // never the session.
      expect(parseSceneLimit('lots')).toBe(SCENE_LIMIT);
      expect(parseSceneLimit(null)).toBe(SCENE_LIMIT);
      expect(parseSceneLimit('')).toBe(SCENE_LIMIT);
    });

    it('never plays fewer than one scene, or more than the ceiling', () => {
      expect(parseSceneLimit('0')).toBe(1);
      expect(parseSceneLimit('-5')).toBe(1);
      expect(parseSceneLimit('1000')).toBe(SCENE_LIMIT);
    });
  });

  describe('positive cases', () => {
    it('takes a short run for a quick field look', () => {
      expect(parseSceneLimit('8')).toBe(8);
      expect(parseSceneLimit('12.7')).toBe(12);
    });
  });
});

describe('parseSceneStart', () => {
  describe('negative cases', () => {
    it('starts at the first scene when nothing readable was asked for', () => {
      expect(parseSceneStart(null)).toBe(1);
      expect(parseSceneStart('')).toBe(1);
      expect(parseSceneStart('the good one')).toBe(1);
    });

    it('never starts before the first scene or past the ceiling', () => {
      expect(parseSceneStart('0')).toBe(1);
      expect(parseSceneStart('-3')).toBe(1);
      expect(parseSceneStart('1000')).toBe(SCENE_LIMIT);
    });
  });

  describe('positive cases', () => {
    it('starts at the scene a field note named', () => {
      expect(parseSceneStart('57')).toBe(57);
      expect(parseSceneStart('57.9')).toBe(57);
    });
  });
});

describe('PROGRAM_LENGTH', () => {
  describe('positive cases', () => {
    it('is what buildProgram actually returns — the runner picks a lap with it before it can build one', () => {
      // A drift here would hand a mid-sequence start (`?scene=58`) a program from the wrong lap, and the
      // scene would silently differ from the same scene of a full run.
      expect(buildProgram(mulberry32(1))).toHaveLength(PROGRAM_LENGTH);
      expect(buildProgram(mulberry32(999))).toHaveLength(PROGRAM_LENGTH);
    });
  });
});

describe('HOUR_SLOTS', () => {
  describe('positive cases', () => {
    it('is the debugger’s own preset set (D6)', () => {
      expect([...HOUR_SLOTS]).toEqual([0, 6, 12, 18, 21]);
    });
  });
});
