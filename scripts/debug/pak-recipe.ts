import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What is this pak, and is it the one being asked for? (201 chain 2 / the phone workflow.)
 *
 * A pak costs minutes to hours on a phone, so it is built once and reused for dozens of runs — and the
 * failure that makes reuse dangerous is silent: asking for a different rect, or the other side of the
 * collision A/B, while a pak already sits in the output folder gets the OLD one served, with nothing on
 * screen or in the log saying so. `report.json`'s `build` block (written since opensa-pack recorded its
 * recipe) is what makes the folder answerable, and this script is how it is read back.
 *
 * Run: `npx tsx scripts/debug/pak-recipe.ts <pakDir> [--expect key=value ...]`
 *
 * With no `--expect` it prints the recipe. With them it compares and exits 1 on the first difference, naming
 * both sides — which is what `npm run phone` gates on. A pak built before recipes were recorded has no block
 * to check: that is reported, and does NOT fail, so an existing pak keeps working.
 */
const args = process.argv.slice(2);
const expectations = new Map<string, string>();
const rest: string[] = [];

for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if (value === '--expect') {
    const pair = args[index + 1] ?? '';
    const eq = pair.indexOf('=');
    if (eq < 1) {
      console.error(`bad --expect '${pair}' (want key=value)`);
      process.exit(2);
    }
    expectations.set(pair.slice(0, eq), pair.slice(eq + 1));
    index += 1;
  } else {
    rest.push(value);
  }
}

const pakDir = rest[0] ?? 'build/phone/pak';
const reportPath = join(pakDir, 'report.json');

if (!existsSync(reportPath)) {
  console.error(`no ${reportPath} — is ${pakDir} a pak directory?`);
  process.exit(2);
}

interface Recipe {
  ao?: boolean;
  appVersion?: null | string;
  at?: string;
  bakeCollision?: boolean;
  commit?: null | string;
  game?: string;
  mapObjectsInRect?: boolean;
  maxTexture?: number;
  models?: boolean;
  peds?: null | string[];
  platforms?: null | string[];
  rect?: null | number[];
  rgba8?: boolean;
  vehicles?: null | string[];
}

const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { build?: Recipe };
const build = report.build;

if (build === undefined) {
  console.log(`${pakDir}: built before recipes were recorded — cannot say which rect or flags made it.`);
  console.log('REBUILD=1 npm run phone makes it self-describing (a phone convert is minutes to hours).');
  process.exit(0);
}

/** The keys whose value is a SET of names: the same subset in a different order is the same pak, so both
 *  sides are sorted before comparing. `rect` is NOT one of them — its four numbers are positional, and
 *  sorting them would make two different districts compare equal. */
const SET_KEYS = new Set(['peds', 'platforms', 'vehicles']);

/** `null` = everything, which is what `all` means on the command line. */
const norm = (key: string, value: boolean | null | number | readonly string[] | string | undefined): string => {
  if (value === null || value === undefined) {
    return key === 'rect' ? 'auto' : 'all';
  }
  const text = Array.isArray(value) ? value.join(',') : String(value);

  return SET_KEYS.has(key) && text !== 'all' ? text.split(',').sort().join(',') : text;
};

const shown: [string, string][] = [
  ['rect', norm('rect', build.rect ? build.rect.join(',') : null)],
  ['rgba8', norm('rgba8', build.rgba8)],
  ['maxTexture', norm('maxTexture', build.maxTexture)],
  ['mapObjectsInRect', norm('mapObjectsInRect', build.mapObjectsInRect)],
  ['bakeCollision', norm('bakeCollision', build.bakeCollision)],
  ['ao', norm('ao', build.ao)],
  ['models', norm('models', build.models)],
  ['vehicles', norm('vehicles', build.vehicles)],
  ['peds', norm('peds', build.peds)],
  ['platforms', norm('platforms', build.platforms)],
];

if (expectations.size === 0) {
  console.log(`${pakDir} — ${build.game ?? '?'} · built ${build.at ?? '?'}${build.commit ? ` · ${build.commit}` : ''}`);
  for (const [key, value] of shown) {
    console.log(`  ${key.padEnd(14)} ${value}`);
  }
  process.exit(0);
}

const actual = new Map(shown);
const differences: string[] = [];

for (const [key, want] of expectations) {
  const got = actual.get(key);
  if (got === undefined) {
    differences.push(`  ${key}: not recorded in this pak`);
  } else if (norm(key, want) !== got) {
    differences.push(`  ${key}: pak has ${got}, asked for ${norm(key, want)}`);
  }
}

if (differences.length > 0) {
  console.error(`the pak in ${pakDir} is not the one being asked for:`);
  for (const line of differences) {
    console.error(line);
  }
  process.exit(1);
}

console.log(
  `pak matches the request — ${build.game ?? '?'} · rect ${actual.get('rect')} · ` +
    `bake-collision=${actual.get('bakeCollision')} · built ${build.at ?? '?'}${build.commit ? ` · ${build.commit}` : ''}`,
);
