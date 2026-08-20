import { createImg } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VEH_MODS_IDE } from './tuning-parts';
import { assertUpgradeCollision, upgradeCollisionNames, VEH_MODS_COL } from './upgrade-collision';

/** The stock collision library, straight out of `gta3.img` — 194 entries, the whole 1000–1193 block. */
const STOCK_COL = join('fixtures', 'original', 'col', VEH_MODS_COL);

let game: string;

/** Put a `models/gta3.img` carrying the real `veh_mods.col` into the tree — the only entry this reads. */
const withStockCol = (): void => {
  const img = createImg();
  img.set(VEH_MODS_COL, new Uint8Array(readFileSync(STOCK_COL)));
  mkdirSync(join(game, 'models'), { recursive: true });
  writeFileSync(join(game, 'models', 'gta3.img'), img.build());
};

/** A tree whose archive holds no collision library at all. */
const withEmptyImg = (): void => {
  mkdirSync(join(game, 'models'), { recursive: true });
  writeFileSync(join(game, 'models', 'gta3.img'), createImg().build());
};

const writeIde = (rows: readonly string[]): void => {
  mkdirSync(join(game, 'data', 'maps', 'veh_mods'), { recursive: true });
  writeFileSync(join(game, VEH_MODS_IDE), ['objs', ...rows, 'end', ''].join('\n'), 'latin1');
};

beforeEach(() => {
  game = mkdtempSync(join(tmpdir(), 'upgrade-col-'));
});

afterEach(() => {
  rmSync(game, { force: true, recursive: true });
});

describe.skipIf(!existsSync(STOCK_COL))('assertUpgradeCollision', () => {
  describe('negative cases', () => {
    it('refuses a new part with neither a collision entry nor the flag, naming its id and flags', () => {
      writeIde(['1194, spl_b_lr_bl, blade, 100, 0']);
      withStockCol();

      expect(() => assertUpgradeCollision(game)).toThrow(/spl_b_lr_bl \(id 1194, flags 0\)/);
    });

    it('says so rather than passing when the archive carries no collision library at all', () => {
      writeIde(['1194, spl_b_lr_bl, blade, 100, 0']);
      withEmptyImg();

      expect(assertUpgradeCollision(game)).toEqual([expect.stringContaining('could not be checked') as string]);
    });
  });

  describe('positive cases', () => {
    it('passes every stock part, whatever its flags — each one has an entry', () => {
      writeIde(['1000, spl_b_mar_m, vehicle, 70, 0', '1181, exh_lr_bl2, blade, 100, 0']);
      withStockCol();

      expect(assertUpgradeCollision(game)).toEqual([]);
    });

    it('passes a new part that carries the flag', () => {
      writeIde(['19051, exh_lr_rem1_059, 059veh, 100, 2097152']);
      withStockCol();

      expect(assertUpgradeCollision(game)).toEqual([]);
    });
  });
});

describe.skipIf(!existsSync(STOCK_COL))('upgradeCollisionNames', () => {
  describe('positive cases', () => {
    it('is the whole stock upgrade block and nothing else', () => {
      withStockCol();
      const names = upgradeCollisionNames(game);

      expect(names?.size).toBe(194);
      expect(names?.has('exh_lr_bl2')).toBe(true);
    });
  });
});
