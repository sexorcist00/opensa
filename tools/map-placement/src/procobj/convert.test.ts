import type { ProcObjPlacement } from '@opensa/renderware/map/procobj-scatter';

import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { describe, expect, it } from 'vitest';

import { buildStreamedIpl, convertProcObj, iplQuaternion } from './convert';

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

describe('buildStreamedIpl', () => {
  const species = new Map([['bush', { hdId: 800, height: 2, lodId: 6500, lodModel: 'plobush' }]]);
  const pair = (x: number): { model: string; placement: ProcObjPlacement } => ({
    model: 'bush',
    placement: { align: false, lottery: 0, normal: [0, 0, 1], position: [x, 0, 0], rotation: 0, scale: 1, scaleZ: 1 },
  });
  const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  describe('negative cases', () => {
    it('emits nothing for an empty placement list', () => {
      const { datLines, files, imgFiles, rows } = buildStreamedIpl([], species, 'plobj');
      expect(files).toEqual([]);
      expect(datLines).toEqual([]);
      expect(imgFiles).toEqual([]);
      expect(rows).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('linkedHeight splits species: tall keep the text link, short go fully binary', () => {
      const mixed = new Map([
        ['bush', { hdId: 800, height: 2, lodId: 6500, lodModel: 'plobush' }], // short → unlinked
        ['cedar', { hdId: 801, height: 12, lodId: 6501, lodModel: 'plocedar' }], // tall → linked
      ]);
      const pairs = [
        { model: 'bush', placement: pair(0).placement },
        { model: 'cedar', placement: pair(1).placement },
      ];
      const { files, imgFiles, instBearingFiles, rows } = buildStreamedIpl(pairs, mixed, 'plobj', 4);

      // The two species land in SEPARATE areas (plan 002) — linked first, so it holds the only text rows and
      // is the only area spending an `IplEntityIndexArrays` slot.
      const textRows = files.map((file) => file[1].split('\r\n').filter((l) => /^\d/.test(l)));
      expect(textRows.map((r) => r.length)).toEqual([1, 0]);
      expect(textRows[0][0]).toMatch(/^6501, plocedar/); // only the cedar LOD is permanent
      expect(rows).toBe(1); // the reported price counts the rows actually emitted
      expect(instBearingFiles).toBe(1);

      expect(parseBinaryIpl(toArrayBuffer(imgFiles[0][1])).map((i) => [i.id, i.lod])).toEqual([[801, 0]]);
      expect(
        parseBinaryIpl(toArrayBuffer(imgFiles[1][1]))
          .map((i) => [i.id, i.lod])
          .sort((a, b) => a[0] - b[0]),
      ).toEqual([
        [800, -1],
        [6500, -1],
      ]); // the bush ships HD + LOD unlinked, at zero text cost
    });

    it('emits a text LOD layer plus a binary HD stream whose lod indexes the text rows', () => {
      const pairs = Array.from({ length: 3 }, (_, i) => pair(i));
      const { datLines, files, imgFiles } = buildStreamedIpl(pairs, species, 'plobj');

      expect(files.map(([name]) => name)).toEqual(['plobj0.ipl']);
      expect(datLines).toEqual(['IPL DATA\\MAPS\\plobj0.IPL']);
      expect(imgFiles.map(([name]) => name)).toEqual(['plobj0_stream0.ipl']);

      const lodRows = files[0][1].split('\r\n').filter((l) => l.includes(','));
      expect(lodRows).toHaveLength(3); // LOD layer only — HD lives in the stream
      expect(lodRows[0]).toMatch(/^6500, plobush, 0, /);
      expect(lodRows.every((row) => row.endsWith(', -1'))).toBe(true);

      const hd = parseBinaryIpl(toArrayBuffer(imgFiles[0][1]));
      expect(hd.map((i) => i.id)).toEqual([800, 800, 800]);
      expect(hd.map((i) => i.lod)).toEqual([0, 1, 2]); // each HD → its LOD row in the area text IPL
      expect(hd[1].position[0]).toBeCloseTo(lodFloat(lodRows[1], 3), 5);
    });

    it('splits areas so text+binary rows per area stay under the boot buffer the field has proven', () => {
      const pairs = Array.from({ length: 9600 }, (_, i) => pair(i));
      const { datLines, files, imgFiles, instBearingFiles, rows } = buildStreamedIpl(pairs, species, 'plobj');

      expect(files.length).toBe(2); // exactly ⌈9600/4800⌉ — every inst-bearing area costs one of SA's 40 slots
      expect(instBearingFiles).toBe(files.length); // all-linked input: every area carries rows
      expect(datLines).toHaveLength(files.length);
      let emitted = 0;
      for (const [, text] of files) {
        const lodRows = text.split('\r\n').filter((l) => l.includes(',')).length;
        emitted += lodRows;
        // Text LOD rows + streamed HD rows share one boot buffer; 9 627 entries is what ProperFixes is
        // measured running on the target, and the split is sized under it rather than under stock's 4 096.
        expect(2 * lodRows).toBeLessThanOrEqual(9627);
      }
      expect(rows).toBe(emitted); // the reported price is MAP-wide, not the first area's
      for (const [name, bytes] of imgFiles) {
        expect(name).toMatch(/^plobj\d+_stream\d+\.ipl$/);
        expect(parseBinaryIpl(toArrayBuffer(bytes)).length).toBeLessThanOrEqual(512);
      }

      // Every HD instance's lod index stays inside its own area's text IPL.
      files.forEach(([areaFile, text], areaIndex) => {
        const areaRowCount = text.split('\r\n').filter((l) => l.includes(',')).length;
        const areaName = areaFile.replace('.ipl', '');
        for (const [name, bytes] of imgFiles.filter(([n]) => n.startsWith(`${areaName}_stream`))) {
          for (const inst of parseBinaryIpl(toArrayBuffer(bytes))) {
            expect(inst.lod, `${name} in area ${areaIndex}`).toBeGreaterThanOrEqual(0);
            expect(inst.lod).toBeLessThan(areaRowCount);
          }
        }
      });
    });
  });
});

/** The n-th comma field of a text inst row, as a float (0-based; field 3 = position X). */
function lodFloat(row: string, field: number): number {
  return Number(row.split(',')[field]);
}
