import { describe, expect, it } from 'vitest';

import { partitionCloneTextures } from './finalize';

describe('partitionCloneTextures', () => {
  describe('negative cases', () => {
    it('keeps a texture used by a single atlas in that atlas (nothing shared)', () => {
      const { perAtlasUnique, shared } = partitionCloneTextures(
        new Map([
          ['a', ['wall_a']],
          ['b', ['wall_b']],
        ]),
      );

      expect(shared).toEqual([]);
      expect(perAtlasUnique.get('a')).toEqual(['wall_a']);
      expect(perAtlasUnique.get('b')).toEqual(['wall_b']);
    });

    it('does not double-count a name repeated within ONE atlas', () => {
      const { shared } = partitionCloneTextures(new Map([['a', ['dup', 'dup']]]));

      expect(shared).toEqual([]); // repeated in one atlas ≠ shared across atlases
    });
  });

  describe('positive cases', () => {
    it('moves textures used by ≥ 2 atlases into the shared parent and dedupes children', () => {
      const { perAtlasUnique, shared } = partitionCloneTextures(
        new Map([
          ['a', ['concrete', 'wall_a', 'wall_a']],
          ['b', ['concrete', 'wall_b']],
          ['c', ['concrete', 'wall_b']],
        ]),
      );

      expect(shared).toEqual(['concrete', 'wall_b']); // wall_b shared by b + c
      expect(perAtlasUnique.get('a')).toEqual(['wall_a']);
      expect(perAtlasUnique.get('b')).toEqual([]); // fully covered by the parent — empty child stays valid
      expect(perAtlasUnique.get('c')).toEqual([]);
    });
  });
});
