import { datChildUrl, iplBasename } from '@opensa/renderware/archive/resolve-paths';
import {
  BANK_HEADER_BYTES,
  readBankHeader,
  readBankLookup,
  readPakFiles,
  type SfxBank,
  type SfxPackage,
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

/** How many distinct sample rates the summary prints before it starts counting the rest. */
const RATES_SHOWN = 12;

function bytesOf(file: string): ArrayBuffer {
  const bytes = readFileSync(file);

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * What the DISTANCE between consecutive bank headers says the header size really is.
 *
 * **This is the one number in the whole format nobody should take from documentation.** A bank is a header
 * followed by its PCM, and `BankLkup` gives both the header's offset and the PCM's size — so the gap between
 * one bank's offset and the next one's, minus that size, IS the header, measured off the file. A constant
 * that is wrong here is SILENT in every other check this script makes: every sound's byte range shifts by the
 * same amount, the derived lengths stay positive, and nothing runs past the end.
 */
function headerGaps(packages: readonly SfxPackage[], banks: readonly SfxBank[]): Map<number, number> {
  const gaps = new Map<number, number>();
  for (const entry of packages) {
    const mine = banks
      .filter((bank) => bank.packageIndex === entry.index)
      .sort((a, b) => a.headerOffset - b.headerOffset);
    for (let index = 0; index + 1 < mine.length; index += 1) {
      const current = mine[index];
      const next = mine[index + 1];
      if (!current || !next) {
        continue;
      }
      const gap = next.headerOffset - current.headerOffset - current.sizeBytes;
      gaps.set(gap, (gaps.get(gap) ?? 0) + 1);
    }
  }

  return gaps;
}

function main(): void {
  const game = gameArg();
  const asked = flag('--dir');
  const tree = resolveTree(game);
  if (!tree) {
    console.log(
      asked
        ? `[audio-census] SKIPPED — '${asked}' carries no audio/CONFIG/BankLkup.dat, so there is nothing to read there.`
        : `[audio-census] SKIPPED — no audio tree for '${game}'. Looked for audio/CONFIG/BankLkup.dat under ` +
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
  const byRate = tally(rates);
  const top = [...byRate.entries()].sort((a, b) => b[1] - a[1]).slice(0, RATES_SHOWN);
  console.log(
    `  rates ${byRate.size} distinct · ${top.map(([rate, count]) => `${rate}:${count}`).join(' ')}` +
      (byRate.size > RATES_SHOWN ? ` · and ${byRate.size - RATES_SHOWN} more` : ''),
  );
  const implausible = rates.filter((rate) => rate < 4000 || rate > 48000).length;
  if (implausible > 0) {
    console.log(`  ${implausible} sound(s) claim a rate outside 4 000..48 000 — the smell of a wrong offset`);
  }

  const gaps = headerGaps(packages, banks);
  console.log(
    `  header size DERIVED from consecutive banks: ${[...gaps.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([size, count]) => `${size}×${count}`)
      .join(' ')} (the constant in use is ${BANK_HEADER_BYTES})`,
  );

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
      `${JSON.stringify(
        {
          banks: banks.length,
          disagreements,
          headerBytesInUse: BANK_HEADER_BYTES,
          headerBytesObserved: Object.fromEntries([...gaps].map(([size, count]) => [size, count])),
          loops,
          packages: reports,
          pcmBytes,
          perBank,
          rateHistogram: Object.fromEntries([...byRate].sort((a, b) => b[1] - a[1])),
          rates: rates.length,
          tree,
          zones,
        },
        null,
        2,
      )}\n`,
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
      const declared = new DataView(bytes).getUint16(bank.headerOffset, true);
      disagreements.push({
        bank: index,
        detail: `${error instanceof Error ? error.message : String(error)} — the header declares ${declared} sounds, which needs ${4 + declared * 12} bytes`,
      });
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

/**
 * The tree to read, or `null` when this machine carries none of the candidates.
 *
 * **An explicit `--dir` is checked the same way a default is**, and against the same file: it used to be
 * accepted whenever the DIRECTORY existed, which let a tree with no `audio/` through to an unguarded
 * `readFileSync` on `PakFiles.dat`. That is the exact class 2026-09-06 closed across four debug scripts — a
 * tool that dies with a stack trace where it owes a sentence — and it had crept back in through the flag.
 */
function resolveTree(game: string): null | string {
  const asked = flag('--dir');
  const candidates = asked
    ? [asked]
    : [gameDir(game), join(process.cwd(), 'build', game, 'opensa'), join(process.cwd(), 'build', game, 'sa')];

  return candidates.find((candidate) => existsSync(join(candidate, 'audio', 'CONFIG', 'BankLkup.dat'))) ?? null;
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

/** How many times each value occurs. */
function tally(values: readonly number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
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
