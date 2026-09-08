import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseIpl, parseIplAudioZones } from './ipl.parser';

describe('parseIpl', () => {
  it('parses inst rows and ignores other sections', () => {
    const instances = parseIpl(
      [
        'inst',
        '5000, gplane, 0, 0.0, -0.0778266, 23.9985, 0.0, 0.0, 0.0, 1.0, -1',
        'end',
        'cull',
        '0, 0, 0, 1, 2, 3',
        'end',
      ].join('\n'),
    );
    expect(instances).toHaveLength(1);
    expect(instances[0]).toEqual({
      id: 5000,
      interior: 0,
      lod: -1,
      modelName: 'gplane',
      position: [0, -0.0778266, 23.9985],
      rotation: [0, 0, 0, 1],
    });
  });

  it('skips malformed rows that are too short', () => {
    expect(parseIpl('inst\n5000, gplane, 0\nend')).toEqual([]);
  });
});

const iplPath = join(process.cwd(), 'fixtures', 'original', 'data', 'int_cont.ipl');
const iplExists = existsSync(iplPath);

describe.skipIf(!iplExists)('parseIpl (real int_cont.ipl)', () => {
  it('parses placed instances with finite positions and quaternions', () => {
    const instances = parseIpl(readFileSync(iplPath, 'utf8'));
    expect(instances.length).toBeGreaterThan(0);
    const first = instances[0];
    expect(first.modelName.length).toBeGreaterThan(0);
    expect(first.position.every(Number.isFinite)).toBe(true);
    expect(first.rotation).toHaveLength(4);
    // First inst row: 14650, trukstp04, interior 1, lod -1.
    expect(first).toMatchObject({ id: 14650, interior: 1, lod: -1, modelName: 'trukstp04' });
  });
});

describe('parseIplAudioZones (203/1-03)', () => {
  describe('negative cases', () => {
    it('reads nothing from a file with no auzo section — every IPL this project has parsed until now', () => {
      const text = ['inst', '100, house, 0, 10, 20, 5, 0, 0, 0, 1, -1', 'end'].join('\n');

      expect(parseIplAudioZones(text)).toEqual([]);
    });

    it('drops a row of any other width rather than guessing which shape it meant', () => {
      const text = ['auzo', 'BEACH, 5, 1, 10, 20', 'CLUB, 6, 1, 1, 2, 3, 4, 5, 6, 7, 8', 'end'].join('\n');

      expect(parseIplAudioZones(text)).toEqual([]);
    });

    it('drops a row whose numbers do not parse — a zone at NaN is a silence nobody could explain', () => {
      const text = ['auzo', 'BEACH, 5, 1, x, 20, 5, 40', 'end'].join('\n');

      expect(parseIplAudioZones(text)).toEqual([]);
    });

    it('starts a zone switched OFF unless the flag is exactly 1', () => {
      const text = ['auzo', 'BEACH, 5, 0, 10, 20, 5, 40', 'CLUB, 6, 2, 10, 20, 5, 40', 'end'].join('\n');

      expect(parseIplAudioZones(text).map((zone) => zone.active)).toEqual([false, false]);
    });
  });

  describe('positive cases', () => {
    it('reads a sphere: name, id, active flag, centre and radius', () => {
      const text = ['auzo', 'BEACH, 5, 1, 10, 20, 5, 40', 'end'].join('\n');

      expect(parseIplAudioZones(text)).toEqual([
        { active: true, centre: [10, 20, 5], id: 5, name: 'BEACH', radius: 40, shape: 'sphere' },
      ]);
    });

    it('reads a box by its WIDTH, the way the game tells the two apart', () => {
      const text = ['auzo', 'CLUB, 6, 1, 1, 2, 3, 4, 5, 6', 'end'].join('\n');

      expect(parseIplAudioZones(text)).toEqual([
        { active: true, id: 6, max: [4, 5, 6], min: [1, 2, 3], name: 'CLUB', shape: 'box' },
      ]);
    });

    it('reads both shapes out of one file, and ignores every other section', () => {
      const text = [
        'inst',
        '100, house, 0, 10, 20, 5, 0, 0, 0, 1, -1',
        'end',
        'auzo',
        'BEACH, 5, 1, 10, 20, 5, 40',
        'CLUB, 6, 0, 1, 2, 3, 4, 5, 6',
        'end',
        'cull',
        '1, 2, 3',
        'end',
      ].join('\n');

      expect(parseIplAudioZones(text).map((zone) => zone.shape)).toEqual(['sphere', 'box']);
    });

    it('takes a row split by whitespace as readily as by commas, like every other section', () => {
      const text = ['auzo', 'BEACH  5  1  10  20  5  40', 'end'].join('\n');

      expect(parseIplAudioZones(text)).toHaveLength(1);
    });
  });
});
