import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ADDS_LEDGER, readAddsLedger, writeAddsLedger } from './ledger';

const VEGA = { bases: ['manana'], folder: '001veh - vega - alfamodding (manana)', id: 19_001, slot: '001veh' };
const VOLARE = { bases: ['solair'], folder: '002veh - volare - viter (solair)', id: 19_002, slot: '002veh' };

let game: string;

const ledgerText = (): string => readFileSync(join(game, ADDS_LEDGER), 'latin1');

beforeEach(() => {
  game = mkdtempSync(join(tmpdir(), 'adds-ledger-'));
  mkdirSync(join(game, 'data'), { recursive: true });
});

afterEach(() => {
  rmSync(game, { force: true, recursive: true });
});

describe('readAddsLedger', () => {
  describe('negative cases', () => {
    it('is empty when nothing has been promised yet', () => {
      expect(readAddsLedger(game).size).toBe(0);
    });

    it('ignores comments and rows with no numeric id', () => {
      writeFileSync(join(game, ADDS_LEDGER), '# a comment\n001veh\tnot-a-number\tmanana\tx\n', 'latin1');

      expect(readAddsLedger(game).size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('reads back what a run wrote', () => {
      writeAddsLedger(game, [VEGA, VOLARE]);

      expect([...readAddsLedger(game)]).toEqual([
        ['001veh', 19_001],
        ['002veh', 19_002],
      ]);
    });
  });
});

describe('writeAddsLedger', () => {
  describe('positive cases', () => {
    it('keeps the rows of cars this run did not touch — an --only run speaks for its own', () => {
      writeAddsLedger(game, [VEGA, VOLARE]);
      writeAddsLedger(game, [{ ...VEGA, folder: '001veh - vega v2 - alfamodding (manana)' }]);

      expect(readAddsLedger(game).get('002veh')).toBe(19_002);
      expect(ledgerText()).toContain('vega v2');
    });

    it('sorts by slot, so a rebuild writes the same bytes', () => {
      writeAddsLedger(game, [VOLARE, VEGA]);
      const once = ledgerText();
      writeAddsLedger(game, [VEGA, VOLARE]);

      expect(ledgerText()).toBe(once);
      expect(once.trimEnd().split('\n').slice(-2)).toEqual([
        '001veh\t19001\tmanana\t001veh - vega - alfamodding (manana)',
        '002veh\t19002\tsolair\t002veh - volare - viter (solair)',
      ]);
    });
  });
});
