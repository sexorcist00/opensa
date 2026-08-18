import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { copyMaterialEffects } from './copy-effects';

// Real vehicle fixtures: infernus (env-map coefficient 1 everywhere — overdone), admiral (a mix: 19 materials
// carry an env-map chunk at ZERO and 3 reflect through the reflection plugin alone) and the anti-rip locked
// walton (well-tuned, every material reflects) read via the engine parser (`npm run test:fixtures`).
const INFERNUS = 'fixtures/original/dff/vehicle/infernus.dff';
const ADMIRAL = 'fixtures/original/dff/vehicle/admiral.dff';
const WALTON = 'fixtures/custom/locked-models/walton.dff';

/** How the materials split by WHICH reflective chunk they carry and whether its value is non-zero. */
function chunks(dff: Uint8Array): {
  coefficientZero: number;
  envMapChunks: number;
  nonZero: number;
  reflectionZero: number;
  total: number;
} {
  const clump = parseDff(toArrayBuffer(dff));
  let coefficientZero = 0;
  let envMapChunks = 0;
  let nonZero = 0;
  let reflectionZero = 0;
  let total = 0;
  for (const geometry of clump.geometries) {
    for (const material of geometry.materials) {
      total += 1;
      const coefficient = material.effects?.envMap?.coefficient ?? 0;
      const intensity = material.effects?.reflection?.intensity ?? 0;
      if (material.effects?.envMap) {
        envMapChunks += 1;
        coefficientZero += coefficient === 0 ? 1 : 0;
      }
      reflectionZero += material.effects?.reflection && intensity === 0 ? 1 : 0;
      nonZero += coefficient !== 0 || intensity !== 0 ? 1 : 0;
    }
  }

  return { coefficientZero, envMapChunks, nonZero, reflectionZero, total };
}

function load(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

/** Distinct env-map coefficients + count of reflective / total materials. */
function reflection(dff: Uint8Array): { coefficients: number[]; reflective: number; total: number } {
  const clump = parseDff(toArrayBuffer(dff));
  const coefficients = new Set<number>();
  let reflective = 0;
  let total = 0;
  for (const geometry of clump.geometries) {
    for (const material of geometry.materials) {
      total += 1;
      if (material.effects?.envMap) {
        reflective += 1;
        coefficients.add(Number(material.effects.envMap.coefficient.toFixed(3)));
      }
    }
  }

  return { coefficients: [...coefficients], reflective, total };
}

describe('copyMaterialEffects', () => {
  describe('negative cases', () => {
    it('throws when the prototype is not a readable vehicle DFF', () => {
      expect(() => copyMaterialEffects(load(INFERNUS), new Uint8Array(64))).toThrow();
    });
  });

  describe('positive cases', () => {
    it('retunes the target env-map coefficient to a locked, different-count reference (walton → infernus)', () => {
      const before = reflection(load(INFERNUS));
      expect(before.coefficients).toEqual([1]); // infernus is overdone (mirror-like)

      const after = reflection(copyMaterialEffects(load(INFERNUS), load(WALTON)).bytes);
      expect(after.coefficients).toEqual([0.5]); // retuned to walton's tasteful level
      expect(after.reflective).toBe(before.reflective); // no reflection added/removed
      expect(after.total).toBe(before.total);
    });

    it('matches across vehicles with different material counts without throwing (admiral → infernus)', () => {
      const after = reflection(copyMaterialEffects(load(INFERNUS), load(ADMIRAL)).bytes);
      expect(after.reflective).toBe(reflection(load(INFERNUS)).reflective);
    });

    it('counts a material as reflective through EITHER chunk, and leaves a zero alone (walton → admiral)', () => {
      // The gate used to be "has an env-map chunk", which both skipped materials that reflect through the SA
      // reflection plugin alone and wrote a coefficient onto ones deliberately left at zero.
      expect(chunks(load(ADMIRAL))).toEqual({
        coefficientZero: 19,
        envMapChunks: 67,
        nonZero: 51,
        reflectionZero: 40,
        total: 91,
      });

      const result = copyMaterialEffects(load(ADMIRAL), load(WALTON));

      expect(result.materials).toBe(91);
      expect(result.patched).toBe(51); // the materials that REFLECT, not the 67 that carry an env-map chunk
      expect(result.coefficients).toBe(48); // 67 chunks − 19 deliberate zeros
      expect(result.intensities).toBe(51);
      // Nothing matte became shiny: the same zeros are still zero after the copy.
      const after = chunks(result.bytes);
      expect(after.coefficientZero).toBe(19);
      expect(after.reflectionZero).toBe(40);
      expect(after.nonZero).toBe(51);
    });

    it('reports the reference it used, so a run that changes nothing says so', () => {
      const result = copyMaterialEffects(load(ADMIRAL), load(WALTON));

      expect(result.reference.coefficient).toBeCloseTo(0.5, 3);
      expect(result.reference.intensity).not.toBeNull();
      expect(result.byTexture).toBeGreaterThanOrEqual(0);
      expect(result.byTexture).toBeLessThanOrEqual(result.patched);
    });
  });
});
