import { describe, expect, it } from 'vitest';

import { planModLayers } from './layers';

const FLAT = ['0. Map Fixes Pack', '1. Pre Light Fixes Pack', '10. Lampposts FX'];

describe('planModLayers', () => {
  describe('negative cases', () => {
    it('refuses a tree that mixes layers with a plain mod folder', () => {
      expect(() => planModLayers(['common', 'sa', '3. Some Mod'], 'sa')).toThrow(/mixes mod layers/);
      expect(() => planModLayers(['common', 'sa', '3. Some Mod'], 'sa')).toThrow(/3\. Some Mod/);
    });

    // The same guard, and the reason it earns its place: a layer nobody spelled right would otherwise
    // apply to BOTH targets as an ordinary mod, silently.
    it('refuses a misspelled layer name, which reads as a stray mod folder', () => {
      expect(() => planModLayers(['common', 'commons', 'sa'], 'sa')).toThrow(/commons/);
      expect(() => planModLayers(['common', 'open-sa'], 'opensa')).toThrow(/open-sa/);
    });

    it('refuses a layered tree with no target — there is no layer to pick', () => {
      expect(() => planModLayers(['common', 'sa', 'opensa'], undefined)).toThrow(/needs a target/);
      expect(() => planModLayers(['common', 'sa', 'opensa'], undefined)).toThrow(/--target <sa \| opensa>/);
    });

    it('refuses two folders that fold to the same layer', () => {
      expect(() => planModLayers(['sa', 'SA'], 'sa')).toThrow(/same mod layer twice/);
    });
  });

  describe('positive cases', () => {
    it('treats a tree with no layer folders as flat, rooted at --in itself', () => {
      const plan = planModLayers(FLAT, undefined);

      expect(plan.strategy).toBe('flat');
      expect(plan.layers).toEqual([{ name: 'flat' }]);
      expect(plan.skipped).toEqual([]);
    });

    it('ignores the target for a flat tree — there is nothing to pick', () => {
      expect(planModLayers(FLAT, 'opensa')).toEqual(planModLayers(FLAT, undefined));
    });

    it('applies common first, then the target layer', () => {
      const plan = planModLayers(['opensa', 'sa', 'common'], 'sa');

      expect(plan.strategy).toBe('layered');
      expect(plan.layers).toEqual([
        { name: 'common', subdir: 'common' },
        { name: 'sa', subdir: 'sa' },
      ]);
      expect(plan.skipped).toEqual(['opensa']);
    });

    it('picks the other layer for the other target', () => {
      expect(planModLayers(['common', 'sa', 'opensa'], 'opensa').layers.map((layer) => layer.name)).toEqual([
        'common',
        'opensa',
      ]);
    });

    it('accepts a common-only tree — the expected first step of a split', () => {
      const plan = planModLayers(['common'], 'sa');

      expect(plan.layers).toEqual([{ name: 'common', subdir: 'common' }]);
      expect(plan.skipped).toEqual([]);
    });

    it('accepts a target-only tree, and one holding only the OTHER target', () => {
      expect(planModLayers(['sa'], 'sa').layers).toEqual([{ name: 'sa', subdir: 'sa' }]);

      const otherOnly = planModLayers(['opensa'], 'sa');
      expect(otherOnly.layers).toEqual([]);
      expect(otherOnly.skipped).toEqual(['opensa']);
    });

    it('matches a layer folder case-folded, keeping the name it has on disk', () => {
      expect(planModLayers(['Common', 'SA'], 'sa').layers).toEqual([
        { name: 'common', subdir: 'Common' },
        { name: 'sa', subdir: 'SA' },
      ]);
    });
  });
});
