import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIG_FILE, DEFAULT_TUNED_TRAFFIC, readTunedTrafficConfig, registerTunedTraffic } from './tuned-traffic';

const INI = join('modloader', 'Model_Variations', 'ModelVariations_Vehicles.ini');
const CARMODS = 'mods\nblade, nto_b_l, exh_lr_bl1\npolice, nto_b_l\nend\n';
const IDS = new Map([
  ['bare', 400],
  ['blade', 536],
  ['police', 596],
]);

let root: string;
let game: string;

const iniText = (): string => readFileSync(join(game, INI), 'latin1');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tuned-traffic-'));
  game = join(root, 'game');
  mkdirSync(join(game, 'modloader', 'Model_Variations'), { recursive: true });
  mkdirSync(join(game, 'data'), { recursive: true });
  writeFileSync(join(game, INI), '[Settings]\nEnableLights=1\n', 'latin1');
  writeFileSync(join(game, 'data', 'carmods.dat'), CARMODS, 'latin1');
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('readTunedTrafficConfig', () => {
  describe('negative cases', () => {
    it('is the defaults when the source root has no config', () => {
      expect(readTunedTrafficConfig(root)).toEqual(DEFAULT_TUNED_TRAFFIC);
    });

    it('fills in every field the config leaves out', () => {
      writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ tuningChance: 10 }));

      expect(readTunedTrafficConfig(root)).toEqual({ ...DEFAULT_TUNED_TRAFFIC, tuningChance: 10 });
    });
  });

  describe('positive cases', () => {
    it('folds the exclude list, so a model matches however it was typed', () => {
      writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ exclude: ['POLICE'] }));

      expect(readTunedTrafficConfig(root).exclude).toEqual(['police']);
    });
  });
});

describe('registerTunedTraffic', () => {
  describe('negative cases', () => {
    it('writes nothing when the plugin is not in the build', () => {
      rmSync(join(game, 'modloader'), { recursive: true });

      expect(registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS)).toBe(0);
    });

    it('skips a model with neither a paint job nor a part — there is nothing to tune', () => {
      registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS);

      expect(iniText()).not.toContain('[bare]');
    });

    it('skips an excluded model', () => {
      registerTunedTraffic(game, { ...DEFAULT_TUNED_TRAFFIC, exclude: ['police'] }, IDS);

      expect(iniText()).not.toContain('[police]');
      expect(iniText()).toContain('[blade]');
    });
  });

  describe('positive cases', () => {
    it("writes the model's own id, its parts and the three keys", () => {
      expect(registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS)).toBe(2);
      expect(iniText()).toContain('Global=536,nto_b_l,exh_lr_bl1');
      expect(iniText()).toContain('TuningChance=75');
      expect(iniText()).toContain('TuningFullBodykit=1');
      expect(iniText()).toContain('ChangeOnlyParked=0');
    });

    it('keeps the added-car ids a base section already carries — one section, both writers', () => {
      writeFileSync(join(game, INI), '[Settings]\nEnableLights=1\n\n[blade]\nGlobal=536,19001\n', 'latin1');
      registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS);

      expect(iniText()).toContain('Global=536,19001,nto_b_l,exh_lr_bl1');
    });

    it('is idempotent', () => {
      registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS);
      const once = iniText();
      registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS);

      expect(iniText()).toBe(once);
    });

    it('takes a changed config on the next run without touching anything else', () => {
      registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS);
      registerTunedTraffic(game, { ...DEFAULT_TUNED_TRAFFIC, tuningChance: 10 }, IDS);

      expect(iniText()).toContain('TuningChance=10');
      expect(iniText()).not.toContain('TuningChance=75');
      expect(iniText()).toContain('Global=536,nto_b_l,exh_lr_bl1');
    });
  });
});
