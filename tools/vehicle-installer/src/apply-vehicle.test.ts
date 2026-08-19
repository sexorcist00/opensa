import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyVehicle } from './apply-vehicle';

const IDE = '535, slamvan, slamvan, car, SLAMVAN, SLAMVAN, null, richfamily, 5, 0, 0, -1, 0.74, 0.74, 2';

let root: string;
let folder: string;
let out: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vehicle-installer-apply-'));
  folder = join(root, 'slamvan - 1968 GMC Pickup Hammered - alfamodding');
  out = join(root, 'out');
  mkdirSync(folder, { recursive: true });
  mkdirSync(join(out, 'data'), { recursive: true });
  writeFileSync(join(out, 'data', 'vehicles.ide'), 'cars\n535, slamvan, slamvan, car, SLAMVAN\nend\n');
  writeFileSync(join(folder, 'slamvan.dff'), Uint8Array.of(1));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('applyVehicle (the settings-file fallback)', () => {
  describe('negative cases', () => {
    it('does not read a known file kind as the settings file when the folder ships none', () => {
      writeFileSync(join(folder, 'text.txt'), 'SLASH Slamin Hood\n');

      const applied = applyVehicle(folder, out, { target: 'opensa' });

      expect(applied.warnings).toEqual([]);
      expect(applied.handlingId).toBeUndefined();
      expect(existsSync(join(out, 'cleo', 'slamvan.fxt'))).toBe(true);
    });

    it('still falls back to an unknown `.txt` — the pre-suffix mods have no other name', () => {
      writeFileSync(join(folder, 'readme.txt'), 'nothing a parser recognises\n');

      const applied = applyVehicle(folder, out, { target: 'opensa' });

      expect(applied.warnings.join('\n')).toMatch(/readme\.txt: dropped an unrecognised block/);
      expect(applied.warnings.join('\n')).toMatch(/nothing recognised/);
    });
  });

  describe('positive cases', () => {
    it('reads the settings file and the two extra kinds in one pass', () => {
      writeFileSync(join(folder, 'slamvan.settings.txt'), IDE);
      writeFileSync(join(folder, 'text.txt'), 'SLASH Slamin Hood\n');

      const applied = applyVehicle(folder, out, { target: 'opensa' });

      expect(applied.warnings).toEqual([]);
      expect(applied.handlingId).toBe('SLAMVAN');
      expect(readFileSync(join(out, 'data', 'vehicles.ide'), 'latin1')).toContain('richfamily');
      expect(readFileSync(join(out, 'cleo', 'slamvan.fxt'), 'latin1')).toBe('SLASH\tSlamin Hood\r\n');
    });
  });
});
