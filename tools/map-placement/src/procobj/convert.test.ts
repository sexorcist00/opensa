import type { ProcObjPlacement } from '@opensa/renderware/map/procobj-scatter';

import { describe, expect, it } from 'vitest';

import { buildPermanentIpl, convertProcObj, iplQuaternion } from './convert';

describe('convertProcObj density', () => {
  /** Only the fields the density gate reads — it runs before any file is touched, which is the point. */
  const options = (density: number): Parameters<typeof convertProcObj>[0] =>
    ({ areaBase: 'plobj', density, gamePath: '/nonexistent', iplName: 'x', outPath: '/nonexistent' }) as never;

  describe('negative cases', () => {
    it('refuses a cutoff above the scatter candidate ceiling, naming what has to be raised first', () => {
      expect(() => convertProcObj(options(4))).toThrow(/raise the profile's `maxDensity`/);
      expect(() => convertProcObj(options(3.77))).toThrow(/got 3.77/);
    });

    it('refuses a non-positive density instead of silently emptying the layer', () => {
      expect(() => convertProcObj(options(0))).toThrow(/must be in \(0, 3\]/);
      expect(() => convertProcObj(options(-1))).toThrow(/must be in \(0, 3\]/);
    });

    it('refuses NaN — it passes both range comparisons and would empty the layer in silence', () => {
      expect(() => convertProcObj(options(Number.NaN))).toThrow(/must be in \(0, 3\]/);
      expect(() => convertProcObj(options(Number.POSITIVE_INFINITY))).toThrow(/must be in \(0, 3\]/);
    });

    it('fails on the file read, not the gate, at the ceiling itself (3 is legal)', () => {
      expect(() => convertProcObj(options(3))).toThrow(/ENOENT/);
    });
  });
});

describe('iplQuaternion', () => {
  describe('positive cases', () => {
    it('is identity for a zero yaw', () => {
      expect(iplQuaternion(0).map((v) => v + 0)).toEqual([0, 0, 0, 1]); // `+ 0` normalises -0 → 0
    });

    it('encodes a conjugated Z rotation (negated z, unit length)', () => {
      const [x, y, z, w] = iplQuaternion(Math.PI / 2);

      expect([x, y]).toEqual([0, 0]);
      expect(z).toBeCloseTo(-Math.SQRT1_2, 6); // conjugate of +sin(π/4) around Z
      expect(w).toBeCloseTo(Math.SQRT1_2, 6);
      expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 6);
    });
  });
});

describe('buildPermanentIpl', () => {
  const species = new Map([['bush', { hdId: 800, height: 2 }]]);
  const one = (x: number): { model: string; placement: ProcObjPlacement } => ({
    model: 'bush',
    placement: { align: false, lottery: 0, normal: [0, 0, 1], position: [x, 0, 0], rotation: 0, scale: 1, scaleZ: 1 },
  });
  const rowsOf = (text: string): string[] => text.split('\r\n').filter((line) => /^\d/.test(line));

  describe('negative cases', () => {
    it('emits nothing for an empty placement list', () => {
      expect(buildPermanentIpl([], species, 'plobj')).toEqual({
        datLines: [],
        files: [],
        instBearingFiles: 0,
        rows: 0,
      });
    });

    it('never emits a lod link, and ships no binary stream at all (plan 014)', () => {
      const result = buildPermanentIpl([one(0), one(5)], species, 'plobj');

      expect(Object.keys(result).sort()).toEqual(['datLines', 'files', 'instBearingFiles', 'rows']);
      for (const row of rowsOf(result.files[0][1])) {
        expect(row.endsWith(', -1')).toBe(true);
      }
    });
  });

  describe('positive cases', () => {
    it('writes one permanent row per object under its STOCK id and model name', () => {
      const { datLines, files, instBearingFiles, rows } = buildPermanentIpl([one(12.5)], species, 'plobj');

      expect(rows).toBe(1); // the price is now the object count, not a subset of linked pairs
      expect(instBearingFiles).toBe(1);
      expect(datLines).toEqual(['IPL DATA\\MAPS\\plobj0.IPL']);
      expect(rowsOf(files[0][1])).toEqual(['800, bush, 0, 12.5, 0, 0, 0, 0, 0, 1, -1']);
    });

    it('carries the placement rotation through as the IPL quaternion', () => {
      const yawed = {
        model: 'bush',
        placement: {
          align: false,
          lottery: 0,
          normal: [0, 0, 1],
          position: [0, 0, 0],
          rotation: Math.PI / 2,
          scale: 1,
          scaleZ: 1,
        },
      } as { model: string; placement: ProcObjPlacement };
      const row = rowsOf(buildPermanentIpl([yawed], species, 'plobj')['files'][0][1])[0];
      const [, , , , , , rx, ry, rz, rw] = row.split(',').map((cell) => cell.trim());

      expect([rx, ry].map(Number)).toEqual([0, 0]);
      expect(Number(rz)).toBeCloseTo(iplQuaternion(Math.PI / 2)[2], 6);
      expect(Number(rw)).toBeCloseTo(iplQuaternion(Math.PI / 2)[3], 6);
    });

    it("splits into areas and counts every one against SA's 40 slots", () => {
      const placements = Array.from({ length: 20_000 }, (_, i) => one(i % 200));
      const { files, instBearingFiles, rows } = buildPermanentIpl(placements, species, 'plobj');

      expect(rows).toBe(20_000);
      expect(instBearingFiles).toBe(files.length);
      expect(files.length).toBe(3); // ⌈20000/9600⌉
      expect(files.reduce((n, [, text]) => n + rowsOf(text).length, 0)).toBe(20_000);
    });
  });
});
