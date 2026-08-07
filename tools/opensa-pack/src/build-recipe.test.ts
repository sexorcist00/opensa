import { describe, expect, it } from 'vitest';

import type { PackOptions } from './pack';

import { buildRecipe, readGitCommit } from './build-recipe';

const META = { appVersion: '0.4.0', at: '2026-08-07 12:00', commit: 'abc1234', game: 'original' };
const BASE: PackOptions = { gameDir: './game-src/original', outDir: './build/phone' };

describe('buildRecipe', () => {
  describe('negative cases', () => {
    it('records an empty subset as null, so "no names given" cannot read as "convert nothing"', () => {
      const recipe = buildRecipe({ ...BASE, peds: [], platforms: [], vehicles: [] }, META);

      expect(recipe.peds).toBeNull();
      expect(recipe.platforms).toBeNull();
      expect(recipe.vehicles).toBeNull();
    });

    it('keeps a flag that was never passed FALSE rather than null, so off and unset stay distinct', () => {
      const recipe = buildRecipe(BASE, META);

      expect(recipe.bakeCollision).toBe(false);
      expect(recipe.rgba8).toBe(false);
      expect(recipe.maxTexture).toBe(0);
      expect(recipe.rect).toBeNull();
    });

    it('defaults the two options that are ON unless asked otherwise', () => {
      const recipe = buildRecipe(BASE, META);

      expect(recipe.ao).toBe(true);
      expect(recipe.models).toBe(true);
    });

    it('returns null for a commit when the directory is not a git checkout', () => {
      expect(readGitCommit('/')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('records the knobs a field run is judged on', () => {
      const recipe = buildRecipe(
        {
          ...BASE,
          ao: false,
          bakeCollision: true,
          forceRgba8: true,
          maxTextureSize: 256,
          models: true,
          peds: ['bmycg', 'wmycr'],
          platforms: ['mobile'],
          rect: [9, -7, 10, -6],
          vehicles: ['admiral'],
        },
        META,
      );

      expect(recipe).toEqual({
        ao: false,
        appVersion: '0.4.0',
        at: '2026-08-07 12:00',
        bakeCollision: true,
        commit: 'abc1234',
        game: 'original',
        maxTexture: 256,
        models: true,
        peds: ['bmycg', 'wmycr'],
        platforms: ['mobile'],
        rect: [9, -7, 10, -6],
        rgba8: true,
        vehicles: ['admiral'],
      });
    });

    it('distinguishes the two sides of the collision A/B, which is the whole point of recording it', () => {
      const baked = buildRecipe({ ...BASE, bakeCollision: true }, META);
      const plain = buildRecipe({ ...BASE, bakeCollision: false }, META);

      expect(baked.bakeCollision).not.toBe(plain.bakeCollision);
    });
  });
});
