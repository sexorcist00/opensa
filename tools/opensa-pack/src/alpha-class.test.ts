/**
 * The alpha CLASS through the whole planner, on REAL texels (plan 092).
 *
 * The field bug it pins: `wattspark1_LAe2` (the Watts Towers) showed its own far side and the towers behind
 * it through the near one. Its lattice textures spend 23.6 % of their texels on mid alpha — twelve times
 * `classifyAlpha`'s 2 % cutout bound — so they classed softBlend, welded as pipelineClass 2, and the blend
 * pipeline writes no depth. Generated histograms cannot prove this; the DXT3 sheets the game ships can.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TexturePlanner } from './textures';

const DIR = join(process.cwd(), 'tests', 'original', 'dff', 'alpha-class');

/** A one-dictionary filesystem for the planner. */
function plannerFor(txd: string): TexturePlanner {
  const data = readFileSync(join(DIR, `${txd}.txd`));
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const fs = {
    get: (name: string): ArrayBuffer | null => (name.toLowerCase() === `${txd}.txd` ? bytes : null),
    getText: (): null => null,
    has: (name: string): boolean => name.toLowerCase() === `${txd}.txd`,
    names: [`${txd}.txd`],
  } as unknown as ConstructorParameters<typeof TexturePlanner>[0];

  return new TexturePlanner(fs, new Map());
}

const WHITE = [255, 255, 255, 255] as const;

describe('alpha class on real dictionaries', () => {
  describe('negative cases', () => {
    it('leaves a uniform glass film in the blend pass (keypad_glass)', () => {
      const planner = plannerFor('kmb_keypadx');

      expect(planner.resolve('kmb_keypadx', 'keypad_glass', WHITE).alphaClass).toBe('softBlend');
    });

    it('does not touch a texture with no alpha at all (the towers’ wall)', () => {
      const planner = plannerFor('lae2tempshit');

      expect(planner.resolve('lae2tempshit', 'BLOCK2', WHITE).alphaClass).toBe('opaque');
    });

    it('does not let a vegetation caller decide the class for everyone else', () => {
      // The planner dedups by texture CONTENT and plans on FIRST use, so a dictionary shared between a
      // vegetation def and an ordinary one used to hand both whichever class arrived first — silently, by
      // build order. Whoever asks now gets what they asked for.
      const planner = plannerFor('kmb_keypadx');
      const plain = planner.resolve('kmb_keypadx', 'keypad_glass', WHITE);
      const vegetation = planner.resolve('kmb_keypadx', 'keypad_glass', WHITE, true);

      expect(plain.alphaClass).toBe('softBlend');
      expect(vegetation.alphaClass).toBe('cutout');
    });
  });

  describe('positive cases', () => {
    it('classes the Watts Towers lattice as a cutout with no caller preference (the field bug)', () => {
      const planner = plannerFor('lae2tempshit');

      expect(planner.resolve('lae2tempshit', 'wattsstax1_LAe', WHITE).alphaClass).toBe('cutout');
      expect(planner.resolve('lae2tempshit', 'wattsstax4_LAe', WHITE).alphaClass).toBe('cutout');
    });
  });
});
