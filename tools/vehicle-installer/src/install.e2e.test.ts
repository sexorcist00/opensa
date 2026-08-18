import { parseCarcols } from '@opensa/renderware/parsers/text/carcols.parser';
import { parseCarGroups } from '@opensa/renderware/parsers/text/cargrp.parser';
import { parseCarmods } from '@opensa/renderware/parsers/text/carmods.parser';
import { parseHandling } from '@opensa/renderware/parsers/text/handling.parser';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { parseVehicleMods } from '@opensa/renderware/parsers/text/vehicle-mods.parser';
import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { install } from './install';

const DATA = join(process.cwd(), 'fixtures', 'original', 'data');
const DATA_FILES = ['carcols.dat', 'carmods.dat', 'cargrp.dat', 'handling.cfg', 'vehicles.ide'];
const PARKED = join(process.cwd(), 'fixtures', 'original', 'parked.json');
const hasFixtures = DATA_FILES.every((file) => existsSync(join(DATA, file))) && existsSync(PARKED);

// Distinct modded values so each merge is observable against the stock data.
const IDE = '445, admiral, admtxdmod, car, ADMIRAL, ADMIRAL, null, normal, 4, 0, 0, -1, 0.70, 0.70, 0';
const HANDLING =
  'ADMIRAL 9999.0 3650.0 1.6 0.0 0.1 -0.2 70 0.70 0.80 0.5 4 180.0 14.0 10.0 R P 4.3 0.63 1 28.0 ' +
  '0.93 0.81 0.0 0.22 -0.15 0.5 0.0 0.26 0.44 10000 0 1400001 0 3 0';
const CARCOLS = 'admiral, 5,5';
const CARMODS = 'admiral, exh_b_l';

// The adjuster mod's two halves as the `sa` layer installs them (plan 011): the empty mapping file it ships,
// and the ini line that makes the game read it.
const FLA_DAT = ['# Author: fastman92', '# CustomModelName StandardModelName', '#new_hydra hydra'].join('\r\n');
const FLA_INI = '[SPECIAL]\r\nEnable model special feature loader = 1\r\n';
const FLA_INI_NAME = 'fastman92limitAdjuster_GTASA.ini';

const CABBIE_PALETTE = ['233,199,40   # new1 yellow taxi cab   yellow', '186,208,125  # new2 light green cab   green'];
const CABBIE_CARCOLS = 'cabbie, 6,0,6,0, new2,0,new2,0, new1,0,new1,0'; // 4-colour, with newN refs

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vehicle-installer-e2e-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe.skipIf(!hasFixtures)('install (end-to-end, real data fixtures)', () => {
  describe('positive cases', () => {
    it('puts dff/txd into gta3.img and merges the four settings into the data files', () => {
      const game = join(root, 'game');
      const mods = join(root, 'in');
      const out = join(root, 'out');

      // Base game: the real stock data files + a gta3.img holding the stock admiral.dff.
      mkdirSync(join(game, 'data'), { recursive: true });
      for (const file of DATA_FILES) {
        cpSync(join(DATA, file), join(game, 'data', file));
      }
      mkdirSync(join(game, 'models'), { recursive: true });
      const baseImg = createImg();
      baseImg.set('admiral.dff', Uint8Array.of(9)); // stock
      writeFileSync(join(game, 'models', 'gta3.img'), baseImg.build());

      // The vehicle: synthetic dff/txd + a settings file carrying the four modded blocks.
      const folder = join(mods, 'admiral - 1976 Mercedes-Benz 230');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'admiral.dff'), Uint8Array.of(1));
      writeFileSync(join(folder, 'admiral.txd'), Uint8Array.of(2));
      writeFileSync(join(folder, 'admiral.settings.txt'), [IDE, HANDLING, CARCOLS, CARMODS].join('\n\n'));

      install({ gamePath: game, inPath: mods, outPath: out });

      // gta3.img: the new dff replaced the stock one + the txd was added.
      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(new Uint8Array(img.get('admiral.dff')!)[0]).toBe(1);
      expect(img.has('admiral.txd')).toBe(true);

      // vehicles.ide + handling.cfg: the admiral entry was replaced in place.
      expect(parseVehicleDefs(readFileSync(join(out, 'data', 'vehicles.ide'), 'utf8')).get('admiral')?.txd).toBe(
        'admtxdmod',
      );
      expect(parseHandling(readFileSync(join(out, 'data', 'handling.cfg'), 'utf8')).get('ADMIRAL')?.fields[0]).toBe(
        '9999.0',
      );

      // carcols + carmods: admiral replaced; both sections still alpha-sorted (admiral before alpha).
      const carcols = parseCarcols(readFileSync(join(out, 'data', 'carcols.dat'), 'utf8'));
      expect(carcols.cars.get('admiral')).toEqual([[5, 5]]);
      const carcolsText = readFileSync(join(out, 'data', 'carcols.dat'), 'utf8');
      expect(carcolsText.indexOf('\nadmiral,')).toBeLessThan(carcolsText.indexOf('\nalpha,'));

      const carmods = parseCarmods(readFileSync(join(out, 'data', 'carmods.dat'), 'utf8'));
      expect(carmods.mods.get('admiral')).toEqual(['exh_b_l']);
    });

    it("carries a mod's CLEO/ subfolder to <out>/cleo/ (lowercased, .ini sidecar rides along)", () => {
      const game = join(root, 'game');
      const mods = join(root, 'in');
      const out = join(root, 'out');

      mkdirSync(join(game, 'data'), { recursive: true });
      for (const file of DATA_FILES) {
        cpSync(join(DATA, file), join(game, 'data', file));
      }
      mkdirSync(join(game, 'models'), { recursive: true });
      writeFileSync(join(game, 'models', 'gta3.img'), createImg().build());

      const folder = join(mods, 'coach - 1985 MCI 102A3');
      mkdirSync(join(folder, 'CLEO'), { recursive: true });
      writeFileSync(join(folder, 'coach.dff'), Uint8Array.of(1));
      writeFileSync(join(folder, 'coach.settings.txt'), HANDLING);
      writeFileSync(join(folder, 'CLEO', 'Car Left Door.cs'), 'code');
      writeFileSync(join(folder, 'CLEO', 'Car Left Door.ini'), 'door=left');

      install({ gamePath: game, inPath: mods, outPath: out });

      expect(readFileSync(join(out, 'cleo', 'Car Left Door.cs'), 'utf8')).toBe('code');
      expect(readFileSync(join(out, 'cleo', 'Car Left Door.ini'), 'utf8')).toBe('door=left');
      // Canonical lowercase spelling on disk (a case-insensitive FS answers existsSync('CLEO') anyway).
      expect(readdirSync(out)).toContain('cleo');
      expect(readdirSync(out)).not.toContain('CLEO');
    });

    it('merges a UTF-16 settings file — the encoding most vehicle mods are saved in', () => {
      const game = join(root, 'game');
      const mods = join(root, 'in');
      const out = join(root, 'out');

      mkdirSync(join(game, 'data'), { recursive: true });
      for (const file of DATA_FILES) {
        cpSync(join(DATA, file), join(game, 'data', file));
      }
      mkdirSync(join(game, 'models'), { recursive: true });
      const baseImg = createImg();
      baseImg.set('admiral.dff', Uint8Array.of(9));
      writeFileSync(join(game, 'models', 'gta3.img'), baseImg.build());

      const folder = join(mods, 'admiral - 1976 Mercedes-Benz 230');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'admiral.dff'), Uint8Array.of(1));
      // Byte for byte what a Windows editor writes: a UTF-16LE BOM and CRLF.
      writeFileSync(
        join(folder, 'admiral.settings.txt'),
        Buffer.from(`﻿${[IDE, HANDLING].join('\r\n\r\n')}`, 'utf16le'),
      );

      install({ gamePath: game, inPath: mods, outPath: out });

      // Read as UTF-8 both blocks are dropped and the car silently keeps the stock 1650 kg row.
      expect(parseHandling(readFileSync(join(out, 'data', 'handling.cfg'), 'utf8')).get('ADMIRAL')?.fields[0]).toBe(
        '9999.0',
      );
      expect(parseVehicleDefs(readFileSync(join(out, 'data', 'vehicles.ide'), 'utf8')).get('admiral')?.txd).toBe(
        'admtxdmod',
      );
    });

    it("a mod's features.txt lands in the table and does NOT shadow its settings file", () => {
      const game = join(root, 'game');
      const mods = join(root, 'in');
      const out = join(root, 'out');

      mkdirSync(join(game, 'data'), { recursive: true });
      for (const file of DATA_FILES) {
        cpSync(join(DATA, file), join(game, 'data', file));
      }
      mkdirSync(join(game, 'models'), { recursive: true });
      const baseImg = createImg();
      baseImg.set('admiral.dff', Uint8Array.of(9));
      writeFileSync(join(game, 'models', 'gta3.img'), baseImg.build());

      const folder = join(mods, 'admiral - 1976 Mercedes-Benz 230');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'admiral.dff'), Uint8Array.of(1));
      // `features.txt` sorts BEFORE `admiral.settings.txt`, which is how it used to swallow the settings.
      writeFileSync(join(folder, 'features.txt'), 'UP/DOWN_LIGHTS\n');
      writeFileSync(join(folder, 'admiral.settings.txt'), HANDLING);

      install({ gamePath: game, inPath: mods, outPath: out });

      expect(readFileSync(join(out, 'data', 'vehicle-features.txt'), 'utf8')).toContain('admiral UP/DOWN_LIGHTS');
      expect(parseHandling(readFileSync(join(out, 'data', 'handling.cfg'), 'utf8')).get('ADMIRAL')?.fields[0]).toBe(
        '9999.0',
      );
      // The mod-car ledger (096/06): after this point nothing downstream can tell this admiral from a stock
      // one, so the slot has to be written down while the installer still knows.
      expect(parseVehicleMods(readFileSync(join(out, 'data', 'vehicle-mods.txt'), 'utf8'))).toEqual(
        new Set(['admiral']),
      );
    });

    it("maps a declaring car onto its stock carrier in the adjuster's file on the sa target (plan 011)", () => {
      const game = join(root, 'game');
      const mods = join(root, 'in');
      const out = join(root, 'out');

      mkdirSync(join(game, 'data'), { recursive: true });
      for (const file of DATA_FILES) {
        cpSync(join(DATA, file), join(game, 'data', file));
      }
      // The mods stage installs these BEFORE the vehicle stage, which is why the vehicle stage can write here.
      writeFileSync(join(game, 'data', 'model_special_features.dat'), FLA_DAT);
      writeFileSync(join(game, FLA_INI_NAME), FLA_INI);
      mkdirSync(join(game, 'models'), { recursive: true });
      writeFileSync(join(game, 'models', 'gta3.img'), createImg().build());

      const folder = join(mods, 'admiral - 1993 Mercedes-Benz SL-Class');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'admiral.dff'), Uint8Array.of(1));
      writeFileSync(join(folder, 'features.txt'), 'UP/DOWN_LIGHTS\n');
      writeFileSync(join(folder, 'admiral.settings.txt'), HANDLING);

      install({ gamePath: game, inPath: mods, outPath: out, target: 'sa' });

      // In SA the ability is hardcoded to a model id, so the slot has to be pointed at the stock car that has it.
      const dat = readFileSync(join(out, 'data', 'model_special_features.dat'), 'utf8');
      expect(dat).toContain('admiral zr350');
      // The file is the adjuster's: its own lines survive ours.
      expect(dat).toContain('#new_hydra hydra');
      // And the OpenSA half of the same declaration is untouched by any of this.
      expect(readFileSync(join(out, 'data', 'vehicle-features.txt'), 'utf8')).toContain('admiral UP/DOWN_LIGHTS');
    });

    it('leaves the adjuster file alone on the opensa target — its engine reads the declaration itself', () => {
      const game = join(root, 'game');
      const mods = join(root, 'in');
      const out = join(root, 'out');

      mkdirSync(join(game, 'data'), { recursive: true });
      for (const file of DATA_FILES) {
        cpSync(join(DATA, file), join(game, 'data', file));
      }
      writeFileSync(join(game, 'data', 'model_special_features.dat'), FLA_DAT);
      mkdirSync(join(game, 'models'), { recursive: true });
      writeFileSync(join(game, 'models', 'gta3.img'), createImg().build());

      const folder = join(mods, 'admiral - 1993 Mercedes-Benz SL-Class');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'admiral.dff'), Uint8Array.of(1));
      writeFileSync(join(folder, 'features.txt'), 'UP/DOWN_LIGHTS\n');
      writeFileSync(join(folder, 'admiral.settings.txt'), HANDLING);

      install({ gamePath: game, inPath: mods, outPath: out, target: 'opensa' });

      expect(readFileSync(join(out, 'data', 'model_special_features.dat'), 'utf8')).toBe(FLA_DAT);
      expect(readFileSync(join(out, 'data', 'vehicle-features.txt'), 'utf8')).toContain('admiral UP/DOWN_LIGHTS');
    });

    it('writes an EMPTY ledger for an install with no vehicle mods at all', () => {
      const game = join(root, 'game');
      const mods = join(root, 'in');
      const out = join(root, 'out');
      mkdirSync(join(game, 'data'), { recursive: true });
      for (const file of DATA_FILES) {
        cpSync(join(DATA, file), join(game, 'data', file));
      }
      mkdirSync(mods, { recursive: true });

      install({ gamePath: game, inPath: mods, outPath: out });

      // Present-and-empty is a different fact from absent: one says the build looked, the other says the
      // build predates the ledger. Downstream they mean the same thing; to a diagnosis they do not.
      expect(parseVehicleMods(readFileSync(join(out, 'data', 'vehicle-mods.txt'), 'utf8'))).toEqual(new Set());
    });

    it('installs the new/ candidate for a slot models/ also holds, and none of the incumbent (plan 007)', () => {
      const game = join(root, 'game');
      const mods = join(root, 'in');
      const out = join(root, 'out');

      mkdirSync(join(game, 'data'), { recursive: true });
      for (const file of DATA_FILES) {
        cpSync(join(DATA, file), join(game, 'data', file));
      }
      mkdirSync(join(game, 'models'), { recursive: true });
      const baseImg = createImg();
      baseImg.set('admiral.dff', Uint8Array.of(9)); // stock
      writeFileSync(join(game, 'models', 'gta3.img'), baseImg.build());

      // The incumbent ships an extra txd of its own — the candidate must not inherit it either.
      const incumbent = join(mods, 'models', 'admiral - 1976 Mercedes-Benz 230 - k1real24');
      mkdirSync(incumbent, { recursive: true });
      writeFileSync(join(incumbent, 'admiral.dff'), Uint8Array.of(1));
      writeFileSync(join(incumbent, 'admiral1.txd'), Uint8Array.of(1));
      writeFileSync(join(incumbent, 'admiral.settings.txt'), [IDE, HANDLING].join('\n\n'));

      const candidate = join(mods, 'new', 'admiral - 1994 Dodge Stealth RT 1.1 - mad_driver');
      mkdirSync(candidate, { recursive: true });
      writeFileSync(join(candidate, 'admiral.dff'), Uint8Array.of(3));
      writeFileSync(join(candidate, 'admiral.txd'), Uint8Array.of(3));

      // Never installed, never scanned for a car.
      mkdirSync(join(mods, 'screenshots'), { recursive: true });
      writeFileSync(join(mods, 'screenshots', 'admiral - 1976 Mercedes-Benz 230 - k1real24.png'), Uint8Array.of(0));

      install({ gamePath: game, inPath: mods, outPath: out });

      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(new Uint8Array(img.get('admiral.dff')!)[0]).toBe(3);
      expect(img.has('admiral1.txd')).toBe(false);
      // The incumbent's settings did not merge either — an overridden car contributes nothing at all.
      expect(parseVehicleDefs(readFileSync(join(out, 'data', 'vehicles.ide'), 'utf8')).get('admiral')?.txd).not.toBe(
        'admtxdmod',
      );
    });

    it('appends custom palette colours and resolves the carcols newN refs (cabbie-style)', () => {
      const game = join(root, 'game');
      const mods = join(root, 'in');
      const out = join(root, 'out');

      mkdirSync(join(game, 'data'), { recursive: true });
      for (const file of DATA_FILES) {
        cpSync(join(DATA, file), join(game, 'data', file));
      }
      mkdirSync(join(game, 'models'), { recursive: true });
      const baseImg = createImg();
      baseImg.set('dummy.dff', Uint8Array.of(0));
      writeFileSync(join(game, 'models', 'gta3.img'), baseImg.build());

      const folder = join(mods, 'cabbie - 1989 Chevrolet Caprice Taxi');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'cabbie.dff'), Uint8Array.of(1));
      writeFileSync(join(folder, 'cabbie.txd'), Uint8Array.of(2));
      writeFileSync(join(folder, 'cabbie.settings.txt'), [CABBIE_PALETTE.join('\n'), CABBIE_CARCOLS].join('\n\n'));

      install({ gamePath: game, inPath: mods, outPath: out });

      const carcolsText = readFileSync(join(out, 'data', 'carcols.dat'), 'utf8');
      const carcols = parseCarcols(carcolsText);
      // Stock palette has 127 colours (ids 0–126) → the two custom colours become ids 127 and 128.
      expect(carcols.palette).toHaveLength(129);
      expect(carcols.palette[127]).toEqual([233, 199, 40]);
      expect(carcols.palette[128]).toEqual([186, 208, 125]);
      // The 4-colour cabbie line resolved its newN refs to those ids and landed in car4.
      expect(carcols.cars4.get('cabbie')).toEqual([
        [6, 0, 6, 0],
        [128, 0, 128, 0],
        [127, 0, 127, 0],
      ]);
      expect(carcolsText).not.toMatch(/\bnew[12]\b/); // no unresolved refs left in the file
    });

    it('--strip reduces gta3.img + the four data files to only the installed vehicle', () => {
      const game = join(root, 'game');
      const mods = join(root, 'in');
      const out = join(root, 'out');

      mkdirSync(join(game, 'data'), { recursive: true });
      for (const file of DATA_FILES) {
        cpSync(join(DATA, file), join(game, 'data', file));
      }
      cpSync(PARKED, join(game, 'parked.json'));
      mkdirSync(join(game, 'models'), { recursive: true });
      const baseImg = createImg();
      baseImg.set('admiral.dff', Uint8Array.of(9)); // stock model we replace
      baseImg.set('player.dff', Uint8Array.of(8)); // unrelated model — must be stripped
      writeFileSync(join(game, 'models', 'gta3.img'), baseImg.build());

      const folder = join(mods, 'admiral - test');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'admiral.dff'), Uint8Array.of(1));
      writeFileSync(join(folder, 'admiral.txd'), Uint8Array.of(2));
      writeFileSync(join(folder, 'admiral.settings.txt'), [IDE, HANDLING, CARCOLS, CARMODS].join('\n\n'));

      install({ gamePath: game, inPath: mods, outPath: out, strip: true });

      // gta3.img: only the installed vehicle's entries remain.
      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(
        img
          .names()
          .map((n) => n.toLowerCase())
          .sort(),
      ).toEqual(['admiral.dff', 'admiral.txd']);

      // the four data files: only `admiral` survives (and the carcols `col` palette + carmods link/wheel).
      const defs = parseVehicleDefs(readFileSync(join(out, 'data', 'vehicles.ide'), 'utf8'));
      expect([...defs.keys()]).toEqual(['admiral']);
      const handling = parseHandling(readFileSync(join(out, 'data', 'handling.cfg'), 'utf8'));
      expect([...handling.keys()]).toEqual(['ADMIRAL']);
      const carcols = parseCarcols(readFileSync(join(out, 'data', 'carcols.dat'), 'utf8'));
      expect([...carcols.cars.keys(), ...carcols.cars4.keys()]).toEqual(['admiral']);
      expect(carcols.palette.length).toBeGreaterThan(100); // col palette kept
      const carmods = parseCarmods(readFileSync(join(out, 'data', 'carmods.dat'), 'utf8'));
      expect([...carmods.mods.keys()]).toEqual(['admiral']);
      expect(carmods.wheels.size).toBeGreaterThan(0); // wheel section kept

      // cargrp.dat: every group keeps only admiral (other models dropped).
      const groups = parseCarGroups(readFileSync(join(out, 'data', 'cargrp.dat'), 'utf8'));
      expect(groups.every((group) => group.models.every((model) => model === 'admiral'))).toBe(true);
      expect(groups.some((group) => group.models.includes('admiral'))).toBe(true);

      // parked.json: only the installed model's parked entries remain.
      const parked = JSON.parse(readFileSync(join(out, 'parked.json'), 'utf8')) as { model: string }[];
      expect(parked.every((entry) => entry.model === 'admiral')).toBe(true);
    });
  });
});
