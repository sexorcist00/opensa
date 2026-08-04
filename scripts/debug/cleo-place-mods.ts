/**
 * Hand-place the two class-A CLEO corpus mods (Ferris Wheel + Wind Farm) into the ORIGINAL build for
 * field runs (plan 097/04 decision 8): scripts into `build/original/opensa/cleo/`, mod IDEs into
 * `data/maps/`, models as a small `models/cleomods.img` override (the install source merges every
 * `models/*.img`). The `gta.dat` IDE lines must be present too — this script appends them once.
 * TEMPORARY BY DESIGN: plan 097/06's packaging pipeline retires it (installers carry CLEO files).
 *
 * Run: `npx tsx scripts/debug/cleo-place-mods.ts`
 */
import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BUILD = 'build/original/opensa';
const FERRIS = 'NO_COMMIT/cleo/46. Pacific Park Rotating Ferris Wheel';
const WIND = 'NO_COMMIT/cleo/wind_farm';

mkdirSync(join(BUILD, 'cleo'), { recursive: true });
copyFileSync(join(FERRIS, 'CLEO/Rotating Ferris Wheel (Junior_Djjr).cs'), join(BUILD, 'cleo/ferris.cs'));
copyFileSync(join(WIND, 'CLEO/Wind Farm (Junior_Djjr).cs'), join(BUILD, 'cleo/windfarm.cs'));
copyFileSync(join(FERRIS, 'data/maps/ferriswheel.IDE'), join(BUILD, 'data/maps/ferriswheel.ide'));
copyFileSync(join(WIND, 'data/maps/windfarm.ide'), join(BUILD, 'data/maps/windfarm.ide'));

const entries: { data: Uint8Array; name: string }[] = [];
const add = (dir: string, name: string): void => {
  entries.push({ data: new Uint8Array(readFileSync(join(dir, 'gta3_img', name))), name: name.toLowerCase() });
};
for (const n of [
  'ferriswheel_base.dff',
  'ferriswheel_lights.dff',
  'ferriswheel_lights.txd',
  'ferriswheel_seat.dff',
  'ferriswheel_seat.txd',
  'ferriswheel_wheel.dff',
  'ferriswheel_wheel.txd',
])
  add(FERRIS, n);
for (const n of [
  'windturb_base.dff',
  'windturb_fan.dff',
  'lodwindturb_base.dff',
  'lodwindturb_fan.dff',
  'windfarm.txd',
  'lodwindfarm.txd',
])
  add(WIND, n);
writeFileSync(join(BUILD, 'models/cleomods.img'), buildVer2Buffer(entries));
const gtaDatPath = join(BUILD, 'data/gta.dat');
const gtaDat = readFileSync(gtaDatPath, 'latin1');
if (!gtaDat.toLowerCase().includes('ferriswheel')) {
  writeFileSync(
    gtaDatPath,
    `${gtaDat.replace(/\n+$/, '')}\nIDE DATA\\MAPS\\ferriswheel.ide\nIDE DATA\\MAPS\\windfarm.ide\n`,
    'latin1',
  );
}
console.log(`placed: 2 scripts, 2 ides, gta.dat lines, cleomods.img with ${entries.length} entries`);
