import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildCatalog } from './catalog';

const METADATA = {
  'Sedans & Station Wagons': {
    items: [
      { image: 'data:image/jpeg;base64,AAAA', name: 'admiral', section: 'Sedans & Station Wagons' },
      { image: 'data:image/jpeg;base64,BBBB', name: 'at400', section: 'Sedans & Station Wagons' },
    ],
  },
};

const IDE = ['cars', '445, admiral, admiralcar, car, ADMIRAL, ADMIRAL, null, normal, 4, 0, 0, -1, 0.7, 0.7, 0', 'end'];

/** A vehicles tree: `models/<folder>` + optional `new/<folder>` + `screenshots/<file>`. */
function fixture(layout: {
  models: readonly { files?: readonly string[]; name: string; settings?: string }[];
  new?: readonly string[];
  screenshots?: readonly string[];
}): { gamePath: string; vehiclesPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'cars-server-'));
  const vehiclesPath = join(root, 'vehicles');
  for (const car of layout.models) {
    const dir = join(vehiclesPath, 'models', car.name);
    mkdirSync(dir, { recursive: true });
    for (const file of car.files ?? [`${car.name.split(' - ')[0]}.dff`]) {
      writeFileSync(join(dir, file), '');
    }
    if (car.settings) {
      writeFileSync(join(dir, `${car.name.split(' - ')[0]}.settings.txt`), car.settings);
    }
  }
  for (const name of layout.new ?? []) {
    mkdirSync(join(vehiclesPath, 'new', name), { recursive: true });
  }
  mkdirSync(join(vehiclesPath, 'screenshots'), { recursive: true });
  for (const name of layout.screenshots ?? []) {
    writeFileSync(join(vehiclesPath, 'screenshots', name), '');
  }
  const gamePath = join(root, 'game');
  mkdirSync(join(gamePath, 'data'), { recursive: true });
  writeFileSync(join(gamePath, 'data', 'vehicles.ide'), IDE.join('\n'));

  return { gamePath, vehiclesPath };
}

const build = (paths: { gamePath: string; vehiclesPath: string }): ReturnType<typeof buildCatalog> =>
  buildCatalog({ ...paths, metadata: METADATA });

describe('buildCatalog', () => {
  describe('negative cases', () => {
    it("withholds the incumbent's screenshot from a new/ candidate that took its slot", () => {
      const catalog = build(
        fixture({
          models: [{ name: 'admiral - 1976 Mercedes-Benz 230 - k1real24' }],
          new: ['admiral - 1994 Dodge Stealth RT 1.1 - mad_driver'],
          screenshots: ['admiral - 1976 Mercedes-Benz 230 - k1real24.png'],
        }),
      );
      const car = catalog.sections[0]?.cars[0];

      // The build installs the candidate, so the page shows the candidate - but the picture on file is of
      // the car it displaced, and the stock original still belongs to the slot.
      expect(catalog.total).toBe(1);
      expect(car).toMatchObject({ carName: '1994 Dodge Stealth RT 1.1', hasOriginal: true, hasShot: false });
      expect(car?.isCandidate).toBe(true);
    });

    it('keeps a car the metadata does not know, under its own section', () => {
      const catalog = build(fixture({ models: [{ name: 'previon - 1990 Toyota Celica - author' }] }));

      expect(catalog.sections.map((section) => section.name)).toEqual([catalog.unknownSection]);
      expect(catalog.sections[0]?.cars[0]?.hasOriginal).toBe(false);
    });

    it('reports a missing screenshot rather than pointing at one', () => {
      const catalog = build(fixture({ models: [{ name: 'admiral - 1976 Mercedes-Benz 230 - k1real24' }] }));

      expect(catalog.sections[0]?.cars[0]?.hasShot).toBe(false);
      expect(catalog.screenshots.size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('joins a screenshot whose filename does not match the folder character for character', () => {
      // The real `at400` picture lost the space before its author — five of the 212 are like this.
      const catalog = build(
        fixture({
          models: [{ name: 'at400 - Boeing 727-100 Liveries - carcer' }],
          screenshots: ['at400 - Boeing 727-100 Liveries- carcer.png'],
        }),
      );

      expect(catalog.sections[0]?.cars[0]?.hasShot).toBe(true);
      expect(catalog.screenshots.get('at400')).toMatch(/Liveries- carcer\.png$/);
    });

    it('reads the three name fields and the stock id', () => {
      const catalog = build(
        fixture({
          models: [{ name: 'admiral - 1976 Mercedes-Benz 230 - k1real24' }],
          screenshots: ['admiral - 1976 Mercedes-Benz 230 - k1real24.png'],
        }),
      );
      const car = catalog.sections[0]?.cars[0];

      expect(car).toMatchObject({
        author: 'k1real24',
        carName: '1976 Mercedes-Benz 230',
        hasOriginal: true,
        hasShot: true,
        id: 445,
        slot: 'admiral',
      });
    });

    it("prefers the mod's own ide id over the stock one", () => {
      const catalog = build(
        fixture({
          models: [
            {
              name: 'admiral - 1976 Mercedes-Benz 230 - k1real24',
              settings: '602, admiral, admtxdmod, car, ADMIRAL, ADMIRAL, null, normal, 4, 0, 0, -1, 0.7, 0.7, 0',
            },
          ],
        }),
      );

      expect(catalog.sections[0]?.cars[0]?.id).toBe(602);
    });

    it('groups by the metadata section and gives it an anchor', () => {
      const catalog = build(
        fixture({
          models: [{ name: 'admiral - 1976 Mercedes-Benz 230 - k1real24' }, { name: 'at400 - Boeing 727 - carcer' }],
        }),
      );

      expect(catalog.sections).toHaveLength(1);
      expect(catalog.sections[0]?.anchor).toBe('sedans-station-wagons');
      expect(catalog.sections[0]?.cars.map((car) => car.slot)).toEqual(['admiral', 'at400']);
    });

    it('carries the tags through from the folder', () => {
      const catalog = build(
        fixture({
          models: [
            {
              files: ['admiral.dff', 'admiral.txd', 'admiral1.txd', 'admiral2.txd'],
              name: 'admiral - 1976 Mercedes-Benz 230 - k1real24',
            },
          ],
        }),
      );

      expect(catalog.sections[0]?.cars[0]?.tags).toEqual(['2 Paint Jobs']);
    });
  });
});
