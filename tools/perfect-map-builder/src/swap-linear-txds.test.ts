import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { swapLinearTxds } from './pipeline';

describe('swapLinearTxds', () => {
  let dir: string;
  let common: string;
  let opensa: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pmb-swap-'));
    common = join(dir, 'common');
    opensa = join(dir, 'opensa');
    mkdirSync(join(common, 'linear-txd'), { recursive: true });
    mkdirSync(join(opensa, 'models'), { recursive: true });
    writeFileSync(
      join(opensa, 'models', 'gta3.img'),
      buildVer2Buffer([
        { data: Uint8Array.from([1, 1, 1]), name: 'lodtrees.txd' }, // gamma variant, to be replaced
        { data: Uint8Array.from([9, 9, 9]), name: 'tree1.dff' }, // untouched neighbour
      ]),
    );
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('is a no-op without a sidecar dir (standalone builds outside pmb)', () => {
      rmSync(join(common, 'linear-txd'), { force: true, recursive: true });
      const before = readFileSync(join(opensa, 'models', 'gta3.img'));

      swapLinearTxds(common, opensa);

      expect(readFileSync(join(opensa, 'models', 'gta3.img'))).toEqual(before);
    });
  });

  describe('positive cases', () => {
    it('replaces the sidecar-named TXD entries in the opensa img, leaving others intact', () => {
      writeFileSync(join(common, 'linear-txd', 'lodtrees.txd'), Uint8Array.from([7, 7, 7, 7]));

      swapLinearTxds(common, opensa);

      const img = readFileSync(join(opensa, 'models', 'gta3.img'));
      const bytes = [...img];
      const find = (needle: number[]): boolean => bytes.some((_, i) => needle.every((b, j) => bytes[i + j] === b));
      expect(find([7, 7, 7, 7])).toBe(true); // linear variant is in
      expect(find([9, 9, 9])).toBe(true); // neighbour untouched
    });
  });
});
