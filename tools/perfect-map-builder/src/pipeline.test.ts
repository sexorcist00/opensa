import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkImgIdBudgets,
  checkTextIplSlotBudget,
  EXCLUDABLE_STAGES,
  parseExcludedStages,
  runsStage,
} from './pipeline';

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

describe('EXCLUDABLE_STAGES', () => {
  describe('negative cases', () => {
    it('does not offer the `lod` alias, which names no stage to skip', () => {
      expect(EXCLUDABLE_STAGES).not.toContain('lod');
    });
  });

  describe('positive cases', () => {
    it('offers both targets and every common-chain stage', () => {
      expect(EXCLUDABLE_STAGES).toEqual([
        'mods',
        'vehicles',
        'peds',
        'optimize',
        'trees',
        'procobj',
        'sa',
        'opensa',
        'pack',
      ]);
    });
  });
});

describe('parseExcludedStages', () => {
  describe('negative cases', () => {
    it('throws on a stage name that does not exist rather than silently building the wrong target', () => {
      expect(() => parseExcludedStages(['--exclude', 'vehicle'])).toThrow(/got 'vehicle'/);
    });

    it('refuses the `lod` alias, which is an --until value and names nothing to skip', () => {
      expect(() => parseExcludedStages(['--exclude', 'lod'])).toThrow(/--exclude must name one of/);
    });

    it('yields nothing when the flag is absent or empty', () => {
      expect(parseExcludedStages(['--game', 'x'])).toEqual([]);
      expect(parseExcludedStages(['--exclude', ''])).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('reads a comma-separated list (the build:game:original:sa spelling)', () => {
      expect(parseExcludedStages(['--exclude', 'vehicles,peds,opensa'])).toEqual(['vehicles', 'peds', 'opensa']);
    });

    it('accumulates repeated flags and de-duplicates, ignoring surrounding whitespace', () => {
      expect(parseExcludedStages(['--exclude', 'sa', '--exclude', ' sa , peds '])).toEqual(['sa', 'peds']);
    });
  });
});

describe('runsStage', () => {
  describe('negative cases', () => {
    it('does not run opensa when the run stops at sa', () => {
      expect(runsStage('opensa', 'sa')).toBe(false);
    });

    it('does not run either target when the run stops in the common chain', () => {
      expect(runsStage('sa', 'procobj')).toBe(false);
      expect(runsStage('opensa', 'procobj')).toBe(false);
    });

    it('does not run an EXCLUDED target on an otherwise full run (the :opensa / :sa split)', () => {
      expect(runsStage('sa', undefined, new Set(['sa']))).toBe(false);
      expect(runsStage('opensa', undefined, new Set(['opensa']))).toBe(false);
    });

    it('lets --exclude override the --until ordering rather than the other way round', () => {
      // `--until pack` would otherwise run `sa`, since `sa` precedes `pack` in the pipeline order.
      expect(runsStage('sa', 'pack', new Set(['sa']))).toBe(false);
      expect(runsStage('sa', 'lod', new Set(['sa']))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('runs both targets on a full run', () => {
      expect(runsStage('sa', undefined)).toBe(true);
      expect(runsStage('opensa', undefined)).toBe(true);
    });

    it('runs sa when a later stage is the stop point (the silently-missing-sa bug)', () => {
      expect(runsStage('sa', 'pack')).toBe(true);
      expect(runsStage('sa', 'opensa')).toBe(true);
    });

    it('runs both targets on --until lod', () => {
      expect(runsStage('sa', 'lod')).toBe(true);
      expect(runsStage('opensa', 'lod')).toBe(true);
    });

    it('keeps the target that was NOT excluded (excluding one must not cost the other)', () => {
      expect(runsStage('opensa', undefined, new Set(['sa']))).toBe(true);
      expect(runsStage('sa', undefined, new Set(['opensa', 'peds', 'vehicles']))).toBe(true);
    });
  });
});

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

describe('checkImgIdBudgets', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pmb-idbudget-'));
    mkdirSync(join(dir, 'models'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  function writeImg(name: string, entries: string[]): void {
    writeFileSync(
      join(dir, 'models', name),
      buildVer2Buffer(entries.map((entryName) => ({ data: Uint8Array.of(1), name: entryName }))),
    );
  }

  describe('negative cases', () => {
    it('throws when the TXD pool is within the runtime margin of the FLA cap (the shopping.dat crash class)', () => {
      // 5,960 TXDs > 6,000 − 50 margin — exhausting an FLA FILE_TYPE_* pool boots into heap corruption.
      writeImg(
        'gta3.img',
        Array.from({ length: 5960 }, (_, i) => `t${i}.txd`),
      );
      expect(() => checkImgIdBudgets(dir)).toThrow(/TXD archives: 5960 of 6000/);
    });

    it('throws when binary IPL files approach the FILE_TYPE_IPL 280-slot pool (the field boot-crash case)', () => {
      writeImg(
        'gta3.img',
        Array.from({ length: 275 }, (_, i) => `a${i}_stream0.ipl`),
      );
      expect(() => checkImgIdBudgets(dir)).toThrow(/binary IPL files: 275 of 280/);
    });
  });

  describe('positive cases', () => {
    it('passes a build comfortably under every pool, counting across all IMG archives', () => {
      writeImg('gta3.img', ['a.txd', 'b.col', 'lae_stream0.ipl', 'x.dff']);
      writeImg('gta_int.img', ['c.txd']);
      expect(() => checkImgIdBudgets(dir)).not.toThrow();
    });
  });
});
