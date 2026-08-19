import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ADDED_VEHICLES_DIR, clearLooseFiles, installLooseFiles } from './loose-files';

let root: string;
let game: string;
let folder: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'added-loose-'));
  game = join(root, 'game');
  folder = join(root, '059veh - a car - someone (remingtn)');
  mkdirSync(game, { recursive: true });
  mkdirSync(folder, { recursive: true });
  for (const file of ['059veh.dff', '059veh.txd', '059veh1.txd', 'wg_l_lr_rem1.dff']) {
    writeFileSync(join(folder, file), file);
  }
  writeFileSync(join(folder, '059veh.settings.txt'), 'not a model');
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('installLooseFiles', () => {
  describe('negative cases', () => {
    it('copies only models — a settings file is not one', () => {
      const { names } = installLooseFiles(game, folder);

      expect(names).not.toContain('059veh.settings.txt');
      expect(existsSync(join(game, ADDED_VEHICLES_DIR, '059veh.settings.txt'))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('writes the dff and every txd into modloader/added-vehicles', () => {
      const { names } = installLooseFiles(game, folder);

      expect([...names].sort()).toEqual(['059veh.dff', '059veh.txd', '059veh1.txd', 'wg_l_lr_rem1.dff']);
      expect(readFileSync(join(game, ADDED_VEHICLES_DIR, '059veh.dff'), 'latin1')).toBe('059veh.dff');
    });

    it('writes a re-modelled part under the name the install gave it, never the stock one', () => {
      const renames = new Map([['wg_l_lr_rem1.dff', 'wg_l_lr_rem1_059veh.dff']]);
      const { names } = installLooseFiles(game, folder, renames);

      expect(names).toContain('wg_l_lr_rem1_059veh.dff');
      expect(existsSync(join(game, ADDED_VEHICLES_DIR, 'wg_l_lr_rem1.dff'))).toBe(false);
    });

    it('is idempotent — a second run leaves the same files', () => {
      const first = installLooseFiles(game, folder).names;

      expect(installLooseFiles(game, folder).names).toEqual(first);
    });
  });
});

describe('clearLooseFiles', () => {
  describe('positive cases', () => {
    it('takes the folder away, so a car deleted from the source cannot survive in the tree', () => {
      installLooseFiles(game, folder);
      clearLooseFiles(game);

      expect(existsSync(join(game, ADDED_VEHICLES_DIR))).toBe(false);
    });

    it('does nothing when there is no folder yet', () => {
      expect(() => clearLooseFiles(game)).not.toThrow();
    });
  });
});
