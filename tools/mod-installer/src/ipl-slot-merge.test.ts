import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compactStockInstIpls, mergeModInstIpls } from './ipl-slot-merge';

const STOCK_DAT = 'IDE DATA\\MAPS\\stock.IDE\nIPL DATA\\MAPS\\area.IPL\n';

function hostRows(out: string): string[] {
  return readFileSync(join(out, 'data', 'maps', 'area.ipl'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && /^\d/.test(l.trim()));
}

function writeGameAndOut(dir: string): { game: string; out: string } {
  const game = join(dir, 'game');
  const out = join(dir, 'out');
  for (const root of [game, out]) {
    mkdirSync(join(root, 'data', 'maps'), { recursive: true });
    mkdirSync(join(root, 'models'), { recursive: true });
  }
  writeFileSync(join(game, 'data', 'gta.dat'), STOCK_DAT);
  writeFileSync(join(out, 'models', 'gta3.img'), buildVer2Buffer([]));
  writeFileSync(join(out, 'data', 'maps', 'area.ipl'), 'inst\n1, stockthing, 0, 0,0,0, 0,0,0,1, -1\nend\n');

  return { game, out };
}

describe('mergeModInstIpls', () => {
  let dir: string;
  let game: string;
  let out: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ipl-slot-merge-'));
    ({ game, out } = writeGameAndOut(dir));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('never touches stock IPL lines or areas with binary streams in the IMG', () => {
      writeFileSync(
        join(out, 'models', 'gta3.img'),
        buildVer2Buffer([{ data: new Uint8Array(8), name: 'streamed_stream0.ipl' }]),
      );
      writeFileSync(join(out, 'data', 'gta.dat'), `${STOCK_DAT}IPL DATA\\MAPS\\streamed.IPL\nIPL DATA\\MAPS\\a.IPL\n`);
      writeFileSync(join(out, 'data', 'maps', 'streamed.ipl'), 'inst\n5, s, 0, 0,0,0, 0,0,0,1, -1\nend\n');
      writeFileSync(join(out, 'data', 'maps', 'a.ipl'), 'inst\n6, a, 0, 0,0,0, 0,0,0,1, -1\nend\n');

      const result = mergeModInstIpls(game, out);

      expect(result.merged).toBe(1); // a only — streamed.ipl keeps its own identity
      expect(existsSync(join(out, 'data', 'maps', 'streamed.ipl'))).toBe(true);
      const dat = readFileSync(join(out, 'data', 'gta.dat'), 'utf8');
      expect(dat).toContain('IPL DATA\\MAPS\\streamed.IPL');
      expect(dat).toContain('IPL DATA\\MAPS\\area.IPL');
      expect(dat).not.toContain('MAPS\\a.IPL');
    });

    it('leaves everything alone when no stock host has the row budget', () => {
      const bulk = Array.from({ length: 4200 }, (_, i) => `${i}, big, 0, 0,0,0, 0,0,0,1, -1`).join('\n');
      writeFileSync(join(out, 'data', 'maps', 'area.ipl'), `inst\n${bulk}\nend\n`);
      writeFileSync(join(out, 'data', 'gta.dat'), `${STOCK_DAT}IPL DATA\\MAPS\\only.IPL\n`);
      writeFileSync(join(out, 'data', 'maps', 'only.ipl'), 'inst\n900, thing, 0, 1,2,3, 0,0,0,1, -1\nend\n');

      expect(mergeModInstIpls(game, out)).toEqual({ merged: 0, rows: 0 });
      expect(existsSync(join(out, 'data', 'maps', 'only.ipl'))).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('appends mod rows into the stock host, rebasing internal lod links past the host rows', () => {
      writeFileSync(
        join(out, 'data', 'gta.dat'),
        `${STOCK_DAT}IPL DATA\\MAPS\\first.IPL\nIPL DATA\\MAPS\\second.IPL\n`,
      );
      writeFileSync(
        join(out, 'data', 'maps', 'first.ipl'),
        'inst\n10, hd_a, 0, 1,1,1, 0,0,0,1, 1\n11, lod_a, 0, 1,1,1, 0,0,0,1, -1\nend\n',
      );
      writeFileSync(
        join(out, 'data', 'maps', 'second.ipl'),
        'inst\n20, hd_b, 0, 2,2,2, 0,0,0,1, 1\n21, lod_b, 0, 2,2,2, 0,0,0,1, -1\nend\n',
      );

      const result = mergeModInstIpls(game, out);

      expect(result).toEqual({ merged: 2, rows: 4 });
      const rows = hostRows(out);
      expect(rows).toHaveLength(5); // 1 stock + 4 appended
      expect(rows[0]).toMatch(/^1, stockthing/); // host rows untouched, indexes preserved
      expect(rows[1]).toMatch(/, 2$/); // first.ipl link 1 → host offset 1 (+0 within block)
      expect(rows[3]).toMatch(/, 4$/); // second.ipl link 1 → rebased past host + first
      expect(existsSync(join(out, 'data', 'maps', 'first.ipl'))).toBe(false);
      expect(existsSync(join(out, 'data', 'maps', 'second.ipl'))).toBe(false);

      const dat = readFileSync(join(out, 'data', 'gta.dat'), 'utf8');
      expect(dat).not.toContain('first.IPL');
      expect(dat).not.toContain('second.IPL');
      expect(dat).toContain('IPL DATA\\MAPS\\area.IPL'); // host line intact, no new line added
      expect(dat).not.toContain('modinst');
    });
  });
});

describe('compactStockInstIpls', () => {
  let dir: string;
  let game: string;
  let out: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ipl-compact-'));
    game = join(dir, 'game');
    out = join(dir, 'out');
    for (const root of [game, out]) {
      mkdirSync(join(root, 'data', 'maps'), { recursive: true });
      mkdirSync(join(root, 'models'), { recursive: true });
    }
    writeFileSync(join(game, 'data', 'gta.dat'), 'IPL DATA\\MAPS\\host.IPL\nIPL DATA\\MAPS\\donor.IPL\n');
    writeFileSync(join(out, 'data', 'gta.dat'), 'IPL DATA\\MAPS\\host.IPL\nIPL DATA\\MAPS\\donor.IPL\n');
    // host is stream-backed (keeps its slot anyway), donor has no streams + extra sections
    const stream = new Uint8Array(80);
    stream.set([0x62, 0x6e, 0x72, 0x79]);
    new DataView(stream.buffer).setUint32(4, 0, true);
    writeFileSync(join(out, 'models', 'gta3.img'), buildVer2Buffer([{ data: stream, name: 'host_stream0.ipl' }]));
    writeFileSync(join(out, 'data', 'maps', 'host.ipl'), 'inst\n1, h, 0, 0,0,0, 0,0,0,1, -1\nend\n');
    writeFileSync(
      join(out, 'data', 'maps', 'donor.ipl'),
      'inst\n7, d, 5, 9,9,9, 0,0,0,1, -1\nend\nenex\n1, foo\nend\n',
    );
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('keeps the donor file and its other sections in place', () => {
      compactStockInstIpls(game, out);
      const donor = readFileSync(join(out, 'data', 'maps', 'donor.ipl'), 'utf8');

      expect(donor).toContain('enex');
      expect(donor).toContain('1, foo');
      expect(donor).not.toContain('7, d,');
      const dat = readFileSync(join(out, 'data', 'gta.dat'), 'utf8');
      expect(dat).toContain('IPL DATA\\MAPS\\donor.IPL'); // gta.dat line stays — file still loads its enex
    });
  });

  describe('positive cases', () => {
    it('moves the stream-less stock inst rows into the stream-backed host', () => {
      const result = compactStockInstIpls(game, out);

      expect(result).toEqual({ compacted: 1, rows: 1 });
      const host = readFileSync(join(out, 'data', 'maps', 'host.ipl'), 'utf8');
      expect(host).toContain('7, d, 5, 9,9,9'); // interior field preserved
    });

    it('loses NOTHING: every row the donor gives up is in the host, whatever the donor held', () => {
      // The property this compaction lives or dies on, and the one nothing pinned. On the real map the
      // donors are `gen_int1` (206 rows) and `int_cont` (8) — emptying them is how the layer buys back two
      // of SA's 40 `IplEntityIndexArrays` slots, and 2026-08-10 a whole bisection went into asking whether
      // those 206 rows had been DELETED. They had not (399 placements before, 400 after, the +1 a mod's).
      // A count test says that in one line, where reading the emptied file says the opposite.
      const rows = Array.from({ length: 12 }, (_, i) => `${100 + i}, d${i}, ${i % 3}, ${i},${i},${i}, 0,0,0,1, -1`);
      writeFileSync(join(out, 'data', 'maps', 'donor.ipl'), `inst\n${rows.join('\n')}\nend\nenex\n1, foo\nend\n`);

      const result = compactStockInstIpls(game, out);

      expect(result.rows).toBe(rows.length);
      const host = readFileSync(join(out, 'data', 'maps', 'host.ipl'), 'utf8');
      for (const row of rows) {
        expect(host).toContain(row);
      }
      // And the donor really is empty — the slot is only reclaimed if its `inst` block has nothing left.
      const donorInst = readFileSync(join(out, 'data', 'maps', 'donor.ipl'), 'utf8').split(/\r?\n/);
      expect(donorInst.filter((line) => /^\d/.test(line.trim()) && line.includes(', d'))).toEqual([]);
    });
  });
});
