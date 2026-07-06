import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkTextIplSlotBudget } from './pipeline';

/** A game dir whose gta.dat registers `n` text IPLs with one inst row each. */
function writeGame(dir: string, n: number): void {
  mkdirSync(join(dir, 'data', 'maps'), { recursive: true });
  const lines: string[] = [];
  for (let i = 0; i < n; i += 1) {
    lines.push(`IPL DATA\\MAPS\\a${i}.IPL`);
    writeFileSync(join(dir, 'data', 'maps', `a${i}.IPL`), 'inst\n1, thing, 0, 0,0,0, 0,0,0,1, -1\nend\n');
  }
  lines.push('IPL DATA\\MAPS\\empty.IPL'); // no inst rows — takes no slot
  writeFileSync(join(dir, 'data', 'maps', 'empty.IPL'), 'inst\nend\n');
  writeFileSync(join(dir, 'data', 'gta.dat'), lines.join('\n') + '\n');
}

describe('checkTextIplSlotBudget', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pmb-slots-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('throws when more than 39 text IPLs carry inst rows', () => {
      writeGame(dir, 40);

      expect(() => checkTextIplSlotBudget(dir)).toThrow(/IplEntityIndexArrays/);
    });

    it('throws when total permanent rows exceed the int16 building-pool budget', () => {
      mkdirSync(join(dir, 'data', 'maps'), { recursive: true });
      const rows = Array.from({ length: 30001 }, (_, i) => `${i}, thing, 0, 0,0,0, 0,0,0,1, -1`).join('\n');
      writeFileSync(join(dir, 'data', 'maps', 'big.IPL'), `inst\n${rows}\nend\n`);
      writeFileSync(join(dir, 'data', 'gta.dat'), 'IPL DATA\\MAPS\\big.IPL\n');

      expect(() => checkTextIplSlotBudget(dir)).toThrow(/int16/);
    });
  });

  describe('positive cases', () => {
    it('passes at exactly 39 slots (inst-less IPLs do not count)', () => {
      writeGame(dir, 39);

      expect(() => checkTextIplSlotBudget(dir)).not.toThrow();
    });
  });
});
