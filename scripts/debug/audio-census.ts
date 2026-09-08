import { datChildUrl, iplBasename } from '@opensa/renderware/archive/resolve-paths';
import {
  BANK_HEADER_BYTES,
  readBankHeader,
  readBankLookup,
  readPakFiles,
  type SfxBank,
  soundRange,
} from '@opensa/renderware/audio/sfx-banks';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIplAudioZones } from '@opensa/renderware/parsers/text/ipl.parser';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { gameArg, gameDir } from '../lib/game';

/**
 * The audio census (plan 203/1-01): what the game's own SFX index actually contains, read off the real files.
 *
 * **This is the gate of the whole audio chain.** Every number the concept states — 12-byte `BankLkup`
 * entries, a 4 084-byte bank header of 400 `SoundMeta`, signed 16-bit mono PCM, no encryption — comes from
 * format documentation rather than from a file, because the machine the plan was written on has no game
 * data. Until this run agrees with them, nothing downstream may be built on them:
 * `packages/renderware/src/audio/sfx-banks.ts` therefore REFUSES a buffer that cannot be what it claims,
 * and this script is how the refusals get exercised against reality.
 *
 * It answers 1/03 in the same pass, because reaching the device is the expensive part: how many AUDIO ZONES
 * the map carries (`auzo`), which is the data SA picks its ambience by.
 *
 * Run: `npx tsx scripts/debug/audio-census.ts [--game original] [--dir <tree>] [--json <out>]`
 *
 * The tree defaults to the first of `game-src/<game>`, `build/<game>/opensa`, `build/<game>/sa` that exists.
 * An absent tree is a NAMED SKIP and not a crash — the class of failure that killed four of these scripts on
 * 2026-09-06, where a default naming a directory the phone does not have threw an unguarded `ENOENT` before
 * reaching the tree that had the answer.
 */

/** A disagreement between the documented layout and the real file. Empty is the outcome the chain wants. */
interface Disagreement {
  readonly bank: number;
  readonly detail: string;
}

/** What one package file turned out to be, or why it could not be read. */
interface PackageReport {
  readonly banks: number;
  readonly bytes: number;
  readonly index: number;
  readonly missing?: true;
  readonly name: string;
}

const RATE_BUCKETS = [8000, 11025, 16000, 22050, 32000, 44100] as const;

function bytesOf(file: string): ArrayBuffer {
  const bytes = readFileSync(file);

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const game = gameArg();
  const tree = resolveTree(game);
  if (!tree) {
    console.log(
      `[audio-census] SKIPPED — no audio tree for '${game}'. Looked for audio/CONFIG/BankLkup.dat under ` +
        `game-src/${game}, build/${game}/opensa and build/${game}/sa. Pass --dir <tree> to name one.`,
    );
    process.exit(0);
  }
  const config = join(tree, 'audio', 'CONFIG');
  const packages = readPakFiles(bytesOf(join(config, 'PakFiles.dat')));
  const banks = readBankLookup(bytesOf(join(config, 'BankLkup.dat')));
  console.log(`[audio-census] ${tree}`);
  console.log(`  packages ${packages.length} · banks ${banks.length}`);

  const disagreements: Disagreement[] = [];
  const rates: number[] = [];
  const soundsPerBank: number[] = [];
  const reports: PackageReport[] = [];
  let loops = 0;

  for (const entry of packages) {
    const file = join(tree, 'audio', 'SFX', entry.name);
    const mine = banks.map((bank, index) => ({ bank, index })).filter(({ bank }) => bank.packageIndex === entry.index);
    if (!existsSync(file)) {
      reports.push({ banks: mine.length, bytes: 0, index: entry.index, missing: true, name: entry.name });
      continue;
    }
    const read = readPackage(file, mine);
    disagreements.push(...read.disagreements);
    rates.push(...read.rates);
    soundsPerBank.push(...read.sounds);
    loops += read.loops;
    reports.push({ banks: mine.length, bytes: statSync(file).size, index: entry.index, name: entry.name });
  }

  const perBank = spread(soundsPerBank);
  const pcmBytes = banks.reduce((total, bank) => total + bank.sizeBytes, 0);
  for (const report of reports) {
    const state = report.missing ? 'MISSING' : `${(report.bytes / 1024 / 1024).toFixed(1)} MB`;
    console.log(`  ${String(report.index).padStart(2)} ${report.name.padEnd(8)} ${report.banks} banks · ${state}`);
  }
  console.log(`  sounds ${rates.length} · per bank min ${perBank.min} / median ${perBank.median} / max ${perBank.max}`);
  console.log(`  looping ${loops} · PCM ${(pcmBytes / 1024 / 1024).toFixed(1)} MB across every bank`);
  const histogram = RATE_BUCKETS.map((rate) => `${rate}:${rates.filter((value) => value === rate).length}`);
  const other = rates.filter((rate) => !RATE_BUCKETS.includes(rate as (typeof RATE_BUCKETS)[number])).length;
  console.log(`  rates ${histogram.join(' ')} other:${other}`);

  const zones = zoneCensus(tree);
  console.log(
    `  audio zones ${zones.boxes} box + ${zones.spheres} sphere (${zones.active} active) in ${zones.files} IPL(s)`,
  );

  console.log(
    disagreements.length === 0
      ? '  LAYOUT AGREES — every bank header parsed and every sound sits inside its package'
      : `  ${disagreements.length} DISAGREEMENT(S) with the documented layout:`,
  );
  for (const row of disagreements.slice(0, 20)) {
    console.log(`    bank ${row.bank}: ${row.detail}`);
  }

  const out = flag('--json');
  if (out) {
    writeFileSync(
      out,
      `${JSON.stringify({ banks: banks.length, disagreements, loops, packages: reports, pcmBytes, perBank, rates: rates.length, tree, zones }, null, 2)}\n`,
    );
    console.log(`  wrote ${out}`);
  }
}

/** Read every bank of one package, collecting what it holds and anything that contradicts the layout. */
function readPackage(
  file: string,
  banks: readonly { bank: SfxBank; index: number }[],
): { disagreements: Disagreement[]; loops: number; rates: number[]; sounds: number[] } {
  const bytes = bytesOf(file);
  const disagreements: Disagreement[] = [];
  const rates: number[] = [];
  const sounds: number[] = [];
  let loops = 0;

  for (const { bank, index } of banks) {
    let header;
    try {
      header = readBankHeader(bytes, bank.headerOffset);
    } catch (error) {
      disagreements.push({ bank: index, detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    sounds.push(header.sounds.length);
    for (let slot = 0; slot < header.sounds.length; slot += 1) {
      const range = soundRange(bank, header, slot);
      rates.push(range.sampleRate);
      if (range.loopOffset >= 0) {
        loops += 1;
      }
      if (range.byteLength <= 0) {
        disagreements.push({ bank: index, detail: `sound ${slot} derives a length of ${range.byteLength}` });
      }
      if (range.byteOffset + range.byteLength > bytes.byteLength) {
        disagreements.push({ bank: index, detail: `sound ${slot} runs past the end of ${file}` });
      }
    }
    if (bank.headerOffset + BANK_HEADER_BYTES + bank.sizeBytes > bytes.byteLength) {
      disagreements.push({ bank: index, detail: `bank runs ${bank.sizeBytes} bytes past the end of ${file}` });
    }
  }

  return { disagreements, loops, rates, sounds };
}

/** The tree to read, or `null` when this machine carries none of the candidates. */
function resolveTree(game: string): null | string {
  const asked = flag('--dir');
  if (asked) {
    return existsSync(asked) ? asked : null;
  }

  return (
    [gameDir(game), join(process.cwd(), 'build', game, 'opensa'), join(process.cwd(), 'build', game, 'sa')].find(
      (candidate) => existsSync(join(candidate, 'audio', 'CONFIG', 'BankLkup.dat')),
    ) ?? null
  );
}

/** Percentiles a reader can act on, from an unsorted list. */
function spread(values: readonly number[]): { max: number; median: number; min: number } {
  const sorted = [...values].sort((a, b) => a - b);

  return {
    max: sorted[sorted.length - 1] ?? 0,
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    min: sorted[0] ?? 0,
  };
}

/** How many audio zones the map carries, by shape — 1/03's half of the run. */
function zoneCensus(tree: string): { active: number; boxes: number; files: number; spheres: number } {
  const datFile = join(tree, 'data', 'gta.dat');
  if (!existsSync(datFile)) {
    return { active: 0, boxes: 0, files: 0, spheres: 0 };
  }
  const dat = parseGtaDat(readFileSync(datFile, 'utf8'));
  let active = 0;
  let boxes = 0;
  let files = 0;
  let spheres = 0;
  for (const iplPath of dat.ipl) {
    const file = datChildUrl(tree, iplPath);
    if (iplPath.toLowerCase().endsWith('.zon') || !existsSync(file)) {
      continue;
    }
    const zones = parseIplAudioZones(readFileSync(file, 'utf8'));
    if (zones.length === 0) {
      continue;
    }
    files += 1;
    for (const zone of zones) {
      active += zone.active ? 1 : 0;
      if (zone.shape === 'box') {
        boxes += 1;
      } else {
        spheres += 1;
      }
    }
    console.log(`  ${iplBasename(iplPath)}: ${zones.length} zone(s)`);
  }

  return { active, boxes, files, spheres };
}

main();
