import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildPerfectMap,
  checkImgIdBudgets,
  checkInstBearingIplSlots,
  EXCLUDABLE_STAGES,
  type ExcludableStage,
  INST_BEARING_IPL_SLOTS,
  OPENSA_BUDGET_NOTICE,
  parseExcludedStages,
  reportTextIplCensus,
  resolveBuildTarget,
  runsStage,
  type StageTiming,
  writeStageTimings,
} from './pipeline';

/** The three map builders the split calls — mocked so the target-split test costs no map build. Each one
 *  creates its output dir, which is all the pipeline needs from them between the call and the next stage. */
const procobjLods = vi.hoisted(() =>
  vi.fn<(step: { config: { density: unknown }; outPath: string }) => void>((step) => {
    mkdirSync(step.outPath, { recursive: true });
  }),
);
const saLods = vi.hoisted(() =>
  vi.fn<(step: { gameDir: string; outDir: string }) => void>((step) => {
    mkdirSync(step.outDir, { recursive: true });
  }),
);
const opensaLods = vi.hoisted(() =>
  vi.fn<(step: { gameDir: string; outDir: string }) => void>((step) => {
    mkdirSync(step.outDir, { recursive: true });
  }),
);
vi.mock('@opensa/lod-procobj-generator/build', () => ({ buildProcobjLods: procobjLods }));
vi.mock('@opensa/sa-lod-generator/build', () => ({ buildSaLods: saLods }));
vi.mock('@opensa/opensa-lod-generator/build', () => ({ buildOpensaLods: opensaLods }));

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

describe('resolveBuildTarget', () => {
  const excluding = (...stages: ExcludableStage[]): ReadonlySet<ExcludableStage> => new Set(stages);

  describe('negative cases', () => {
    it('refuses an opensa profile while the sa target is still being built', () => {
      expect(() => resolveBuildTarget('opensa', excluding())).toThrow(/--exclude sa/);
      expect(() => resolveBuildTarget('opensa', excluding('peds', 'vehicles'))).toThrow(/no building pool/);
    });

    it('never derives opensa from a run that builds both targets', () => {
      expect(resolveBuildTarget(undefined, excluding())).not.toBe('opensa');
      expect(resolveBuildTarget(undefined, excluding('pack'))).not.toBe('opensa');
    });
  });

  describe('positive cases', () => {
    it('derives the target from --exclude when none is given (what the build scripts already declare)', () => {
      expect(resolveBuildTarget(undefined, excluding('sa'))).toBe('opensa');
      expect(resolveBuildTarget(undefined, excluding('opensa', 'peds', 'vehicles'))).toBe('sa');
      expect(resolveBuildTarget(undefined, excluding())).toBe('sa');
    });

    it('allows the conservative mismatch — an opensa-only build carrying the sa profile', () => {
      expect(resolveBuildTarget('sa', excluding('sa'))).toBe('sa');
    });

    it('honours an explicit opensa once the sa target is excluded', () => {
      expect(resolveBuildTarget('opensa', excluding('sa'))).toBe('opensa');
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

describe('buildPerfectMap source/out overlap', () => {
  let out: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'pmb-work-'));
  });

  afterEach(() => {
    rmSync(out, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('refuses a source inside <out>/.work instead of wiping it, and leaves the intermediate intact', async () => {
      const stage = join(out, '.work', '5-trees');
      mkdirSync(join(stage, 'models'), { recursive: true });
      writeFileSync(join(stage, 'models', 'gta3.img'), 'intermediate');

      await expect(
        buildPerfectMap({ exclude: ['sa'], gamePath: stage, inPath: '/nonexistent', outPath: out }),
      ).rejects.toThrow(/inside .*\.work/);
      expect(existsSync(join(stage, 'models', 'gta3.img'))).toBe(true);
    });

    it('refuses a mods root inside <out>/.work for the same reason', async () => {
      const mods = join(out, '.work', 'mods-src');
      mkdirSync(mods, { recursive: true });

      await expect(
        buildPerfectMap({ exclude: ['sa'], gamePath: '/nonexistent', inPath: mods, outPath: out }),
      ).rejects.toThrow(/--in .*is inside/);
    });
  });
});

/**
 * The invariant that makes `sa/` and `opensa/` the SAME WORLD: the procobj scatter runs ONCE, in the common
 * chain, and both targets are handed that one stage build. Measured 2026-08-10 across two separate runs
 * (opensa 08-09 13:53, sa 08-10) — all 46 `plobj*.ipl` and all 331 `plobj*_stream*.ipl` byte-identical,
 * 91 092 objects each side. Nothing tested it, and it can only break silently: procobj positions are
 * DERIVED (seeded scatter over collision geometry), so two targets fed from different dirs would each hold a
 * plausible-looking world, and every cross-target verdict — above all 013's "does the real game cope at the
 * shipped density" — would be comparing two different maps while reading as one.
 */
describe('buildPerfectMap target split', () => {
  let out: string;
  let game: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'pmb-split-'));
    game = mkdtempSync(join(tmpdir(), 'pmb-game-'));
    mkdirSync(join(game, 'data', 'maps'), { recursive: true });
    procobjLods.mockClear();
    saLods.mockClear();
    opensaLods.mockClear();
  });

  afterEach(() => {
    rmSync(out, { force: true, recursive: true });
    rmSync(game, { force: true, recursive: true });
  });

  describe('positive cases', () => {
    it('scatters procobj ONCE and hands that same stage build to both targets', async () => {
      await buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: '/nonexistent', outPath: out });

      // One scatter. A second call would mean two independent lotteries, i.e. two different worlds.
      expect(procobjLods).toHaveBeenCalledTimes(1);
      const scattered = procobjLods.mock.calls[0][0].outPath;
      expect(saLods).toHaveBeenCalledTimes(1);
      expect(opensaLods).toHaveBeenCalledTimes(1);
      expect(saLods.mock.calls[0][0].gameDir).toBe(scattered);
      expect(opensaLods.mock.calls[0][0].gameDir).toBe(scattered);
    });

    it('keeps the density a property of the build, not of the target it is being built for', async () => {
      // Scope call 2026-08-09: `sa` ships the SAME density as `opensa`. The scatter takes the run's density
      // and its own target only for REPORTING, so a density that varied by target could not reach it here.
      await buildPerfectMap({
        config: { procobjDensity: 2 },
        exclude: ['optimize', 'pack'],
        gamePath: game,
        inPath: '/nonexistent',
        outPath: out,
      });

      expect(procobjLods.mock.calls[0][0].config.density).toBe(2);
    });
  });
});

describe('writeStageTimings', () => {
  let out: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'pmb-timings-'));
  });

  afterEach(() => {
    rmSync(out, { force: true, recursive: true });
  });

  const knobs = { procobjDensity: 1, procobjMax: 100000, target: 'opensa' } as const;

  describe('negative cases', () => {
    it('writes nothing when no stage ran — an empty file would read as a build that took no time', () => {
      writeStageTimings(out, [], knobs);

      expect(existsSync(join(out, 'build-timings.json'))).toBe(false);
    });
  });

  const written = (): { config: unknown; stages: StageTiming[]; total: number } =>
    JSON.parse(readFileSync(join(out, 'build-timings.json'), 'utf8')) as {
      config: unknown;
      stages: StageTiming[];
      total: number;
    };

  describe('positive cases', () => {
    it('records the knobs the run was configured with, so two durations are comparable', () => {
      writeStageTimings(out, [{ name: 'procobj', seconds: 420 }], knobs);

      expect(written().config).toEqual(knobs);
      expect(written().stages).toEqual([{ name: 'procobj', seconds: 420 }]);
      expect(written().total).toBe(420);
    });

    it('totals the stages it was given rather than re-deriving them', () => {
      writeStageTimings(
        out,
        [
          { name: 'mods', seconds: 84 },
          { name: 'opensa', seconds: 2221.5 },
        ],
        knobs,
      );

      expect(written().total).toBe(2305.5);
    });
  });
});

describe('reportTextIplCensus', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pmb-slots-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  /** A game dir whose whole map is one text IPL of `n` inst rows. */
  const writeRows = (n: number): void => {
    mkdirSync(join(dir, 'data', 'maps'), { recursive: true });
    const rows = Array.from({ length: n }, (_, i) => `${i}, thing, 0, 0,0,0, 0,0,0,1, -1`).join('\n');
    writeFileSync(join(dir, 'data', 'maps', 'big.IPL'), `inst\n${rows}\nend\n`);
    writeFileSync(join(dir, 'data', 'gta.dat'), 'IPL DATA\\MAPS\\big.IPL\n');
  };

  /** The reported lines, `console.log` and `console.warn` kept apart — severity is part of what is asserted. */
  const capture = (): { logs: string[]; warns: string[] } => {
    const logs: string[] = [];
    const warns: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((m: unknown) => void warns.push(String(m)));
    reportTextIplCensus(dir);
    logSpy.mockRestore();
    warnSpy.mockRestore();

    return { logs, warns };
  };

  describe('negative cases', () => {
    it("does NOT throw past stock SA's int16 pool ceiling — the target lifts it, so the count is only reported", () => {
      writeRows(32768); // one past 2^15, the row count that used to fail the build

      expect(() => reportTextIplCensus(dir)).not.toThrow();
      expect(capture().logs.join('\n')).toMatch(/sa map cost: 32768 permanent text-IPL rows/);
    });

    it('MEASURES the slot count past 40 and leaves the failing to the gate beside it', () => {
      // The census reports; `checkInstBearingIplSlots` is what fails the build. Kept apart so the gate is a
      // pure function testable without a game dir — and because the census must still print a number when the
      // gate is about to throw, which is how the field crash got its count (75 of 40, plan 002).
      writeGame(dir, 45);

      expect(() => reportTextIplCensus(dir)).not.toThrow();
      expect(reportTextIplCensus(dir).instBearingIpls).toBe(45);
      expect(capture().logs.join('\n')).toMatch(/45 inst-bearing IPLs/);
    });

    it('WARNS that the count is a lower bound when a listed IPL is missing on disk, instead of reading it as zero rows', () => {
      writeGame(dir, 3);
      rmSync(join(dir, 'data', 'maps', 'a1.IPL'));

      const { logs, warns } = capture();

      expect(warns.join('\n')).toMatch(/1 of 4 IPLs listed in gta\.dat are MISSING on disk .*LOWER BOUND/);
      expect(logs.join('\n')).toMatch(/read 3\/4 listed/);
    });

    it('WARNS rather than passing silently when the built tree has no gta.dat to count', () => {
      const { logs, warns } = capture();

      expect(warns.join('\n')).toMatch(/census SKIPPED — no data\/gta\.dat/);
      expect(logs).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('counts every listed IPL, and an inst-less one is listed but takes no slot and no rows', () => {
      writeGame(dir, 2);

      const { logs, warns } = capture();

      expect(logs.join('\n')).toMatch(/sa map cost: 2 permanent text-IPL rows, 2 inst-bearing IPLs, read 3\/3 listed/);
      expect(warns).toHaveLength(0);
    });

    it('reports the cost alone — no stock ceiling is quoted at a build that never runs on one', () => {
      writeGame(dir, 45);

      expect(capture().logs.join('\n')).not.toMatch(/32767|\b39\b|stock/i);
    });
  });
});

describe('OPENSA_BUDGET_NOTICE', () => {
  describe('positive cases', () => {
    it('says both halves: no SA ceiling here, and no measured budget of our own yet', () => {
      expect(OPENSA_BUDGET_NOTICE).toMatch(/do not apply/);
      expect(OPENSA_BUDGET_NOTICE).toMatch(/no streaming budget guard exists yet/);
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

    it('throws when binary IPL files approach the FILE_TYPE_IPL pool (the field boot-crash case)', () => {
      writeImg(
        'gta3.img',
        Array.from({ length: 1019 }, (_, i) => `a${i}_stream0.ipl`),
      );
      expect(() => checkImgIdBudgets(dir)).toThrow(/binary IPL files: 1019 of 1024/);
    });
  });

  describe('positive cases', () => {
    it('passes a build comfortably under every pool, counting across all IMG archives', () => {
      writeImg('gta3.img', ['a.txd', 'b.col', 'lae_stream0.ipl', 'x.dff']);
      writeImg('gta_int.img', ['c.txd']);
      expect(() => checkImgIdBudgets(dir)).not.toThrow();
    });

    it('passes the 522 binary IPLs the first sa build at the recovered density produced', () => {
      // The build that found this gate (2026-08-10): 331 `plobj*_stream*` tiles + 191 stock ones. 242 over
      // the old 280-slot pool, comfortably under the raised one — the regression test for the raise itself.
      writeImg(
        'gta3.img',
        Array.from({ length: 522 }, (_, i) => `a${i}_stream0.ipl`),
      );
      expect(() => checkImgIdBudgets(dir)).not.toThrow();
    });
  });
});

describe('checkInstBearingIplSlots', () => {
  describe('negative cases', () => {
    it('fails the build the field crashed on: 75 inst-bearing IPLs against 40 slots', () => {
      // The `sa` build at the shipped density, 2026-08-10. The game died loading `plobj10.ipl` — slot 40 — with
      // OLA's `EntityIpl = unlimited` set, measured twice (with and without our own asi's int16 patch).
      expect(() => checkInstBearingIplSlots(75)).toThrow(/75 inst-bearing text IPLs of 40 SA slots/);
    });

    it('fails on the first slot past the array, not one later', () => {
      expect(() => checkInstBearingIplSlots(INST_BEARING_IPL_SLOTS + 1)).toThrow(/IplEntityIndexArrays/);
    });
  });

  describe('positive cases', () => {
    it('passes a tree that exactly fills the array', () => {
      expect(() => checkInstBearingIplSlots(INST_BEARING_IPL_SLOTS)).not.toThrow();
    });

    it('passes the budget plan 002 targets: 28 stock + 6 linked areas', () => {
      expect(() => checkInstBearingIplSlots(28 + 6)).not.toThrow();
    });
  });
});
