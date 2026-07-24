/**
 * The planner's missing-texture rule (map-object round, plan 085 row B).
 *
 * A texture name the whole chain cannot supply renders as the MATERIAL COLOUR — vanilla SA draws such a
 * material untextured, and the magenta marker it replaced read as an engine bug in the field
 * (visagesign04: a mod DFF naming `_257` textures no dictionary anywhere ships). The loudness lives in
 * `report.missing` instead, which the pack log summarizes.
 */
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TexturePlanner } from './textures';

const TXD_PATH = join(process.cwd(), 'tests', 'original', 'mods', 'chinatownsfe.txd');

function fixtureFs(): { fs: ConstructorParameters<typeof TexturePlanner>[0]; realName: string } {
  const data = readFileSync(TXD_PATH);
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const realName = parseTxd(bytes).textures[0].name.toLowerCase();
  const fs = {
    get: (name: string): ArrayBuffer | null => (name.toLowerCase() === 'chinatownsfe.txd' ? bytes : null),
    getText: (): null => null,
    has: (name: string): boolean => name.toLowerCase() === 'chinatownsfe.txd',
    names: ['chinatownsfe.txd'],
  } as unknown as ConstructorParameters<typeof TexturePlanner>[0];

  return { fs, realName };
}

describe('TexturePlanner missing textures', () => {
  describe('negative cases', () => {
    it('ledgers nothing when the texture resolves', () => {
      const { fs, realName } = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());

      planner.resolve('chinatownsfe', realName, [255, 255, 255, 255]);

      expect(planner.report.missing).toEqual({});
    });

    it('ledgers nothing for a colour-only material — no texture was ever named', () => {
      const { fs } = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());

      planner.resolve('chinatownsfe', null, [80, 90, 100, 255]);

      expect(planner.report.missing).toEqual({});
    });
  });

  describe('positive cases', () => {
    it('falls back to the material colour (vanilla draws missing textures untextured) and ledgers the name', () => {
      const { fs } = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());
      const colour = [200, 10, 10, 255] as const;

      const missed = planner.resolve('chinatownsfe', 'miragepillar2_257', colour);
      const plain = planner.resolve('chinatownsfe', null, colour);

      // Same texel as a colour-only material, but a POOL of its own: the runtime repaints stand-in layers
      // magenta on demand, and repainting a layer shared with a legit colour material would tint that too.
      expect(missed).not.toBe(plain);
      expect(planner.missingLayers).toEqual([
        { array: missed.arrayRef, color: [200, 10, 10, 255], layer: missed.layer },
      ]);
      expect(planner.report.missing).toEqual({ 'chinatownsfe/miragepillar2_257': { count: 1, models: [] } });
    });

    it('shares ONE stand-in layer across misses of the same material colour', () => {
      const { fs } = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());

      const first = planner.resolve('chinatownsfe', 'miragepillar2_257', [255, 255, 255, 255]);
      const second = planner.resolve('skullsign', 'miragesign1_257', [255, 255, 255, 255]);

      expect(second).toBe(first);
      expect(planner.missingLayers).toHaveLength(1);
    });

    it('resolves through the GLOBAL index when the def chain misses but another TXD carries the name', () => {
      // Row F: mod TXDs drop names their stock predecessors had (triadcasino roof), and stock models
      // reference textures another TXD carries (lacnchasgn_lvs → carparksignplate_64). The def chain
      // stays first; the global index only decides between the real texels and a stand-in.
      const data = readFileSync(TXD_PATH);
      const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const realName = parseTxd(bytes).textures[0].name.toLowerCase();
      const fs = {
        get: (name: string): ArrayBuffer | null => (name.toLowerCase() === 'donor.txd' ? bytes : null),
        getText: (): null => null,
        has: (name: string): boolean => name.toLowerCase() === 'donor.txd',
        names: ['donor.txd'],
      } as unknown as ConstructorParameters<typeof TexturePlanner>[0];
      const planner = new TexturePlanner(fs, new Map());

      const resolved = planner.resolve('signdef', realName, [255, 255, 255, 255], false, 'lacnchasgn_lvs');
      planner.resolve('signdef', realName, [255, 255, 255, 255], false, 'carparksign02_lvs');
      const plain = planner.resolve('signdef', null, [255, 255, 255, 255]);

      expect(resolved).not.toBe(plain); // a real texture layer, not the colour stand-in
      expect(planner.report.missing).toEqual({});
      // The full triage view: which txd LACKED the name, the donor, and every model that asked.
      expect(planner.report.crossTxd).toEqual({
        [`signdef/${realName}`]: {
          donor: 'donor',
          models: ['lacnchasgn_lvs', 'carparksign02_lvs'],
          texture: realName,
          txd: 'signdef',
        },
      });
    });

    it('counts repeat misses per name and records WHICH models asked — the actionable half of the ledger', () => {
      const { fs } = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());

      planner.resolve('chinatownsfe', 'miragepillar2_257', [255, 255, 255, 255], false, 'visagesign04');
      planner.resolve('chinatownsfe', 'miragepillar2_257', [255, 255, 255, 255], false, 'visagesign04');
      planner.resolve('chinatownsfe', 'miragepillar2_257', [255, 255, 255, 255], false, 'visagesign05');
      planner.resolve('skullsign', 'miragesign1_257', [255, 255, 255, 255]);

      expect(planner.report.missing).toEqual({
        'chinatownsfe/miragepillar2_257': { count: 3, models: ['visagesign04', 'visagesign05'] },
        'skullsign/miragesign1_257': { count: 1, models: [] },
      });
    });
  });
});
