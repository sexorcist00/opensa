import type { EditableImg } from '@opensa/tool-kit/archive/img';

import { ver2EntryCount } from '@opensa/renderware/archive/img-archive';
import { createImg, openImg, writeImgFile } from '@opensa/tool-kit/archive/img';
import { registerImgArchives } from '@opensa/tool-kit/game-dir';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, parse, resolve, sep } from 'node:path';

import type { Bucket } from './classify';

import { claimsFromIde, classifyEntries, vehiclePartsFromCarmods } from './classify';

/** A bucket that gets its own archive. `map` is not one — it keeps `gta3.img`, which the game loads anyway. */
export type SplitBucket = Exclude<Bucket, 'map'>;

export interface SplitOptions {
  /** Which buckets get their own archive. Anything left out stays in `gta3.img`. Default: all three. */
  buckets?: readonly SplitBucket[];
  /** The base game tree (`gta.dat` + `data/` + `models/gta3.img`). */
  gamePath: string;
  /**
   * Set once our ASI raises `CStreaming::ms_files`. Without it {@link assertArchiveSlots} refuses a tree the
   * game would die loading — see the constant's own note for why that gate is not optional.
   */
  liftedArchiveLimit?: boolean;
  outPath: string;
}

export interface SplitSummary {
  /** Every archive the split produced or rewrote, in emit order. */
  archives: { bytes: number; entries: number; name: string }[];
  /** Entries claimed by two buckets, kept in `gta3.img` (see `classifyEntries`). */
  contested: string[];
  /** Registered archives the built tree needs, against the stock table. */
  slots: { needed: number; stock: number };
  /** Entries no IDE row declares, kept in `gta3.img`. */
  unclaimed: number;
}

/**
 * **`CStreaming::ms_files` holds 8**, derived from gta-reversed rather than remembered
 * (`docs/gta-sa-original/img-archive-limit.md`), and three of them are spent before `gta.dat` is read:
 * `gta3.img`, `gta_int.img`, `player.img` are hardcoded. Past the eighth the game **crashes at load**, which
 * is why this is a build gate and not a warning: nothing downstream can tell an over-full tree from a good
 * one, and the field cost is a boot that never happens.
 */
export const STOCK_ARCHIVE_SLOTS = 8;

/** The archives SA registers before reading `gta.dat`. */
export const HARDCODED_ARCHIVES = 3;

/**
 * Fail a tree that registers more archives than the target's table holds.
 *
 * The one ceiling in this design that the game enforces with a crash rather than a symptom. `lifted` is our
 * own ASI raising it; until that ships, a split that wants more than the free slots has to leave a bucket in
 * `gta3.img` — which is exactly the shape plan 001 step 5 field-tests.
 */
export function assertArchiveSlots(gtaDatImgLines: number, lifted: boolean): void {
  const needed = HARDCODED_ARCHIVES + gtaDatImgLines;
  if (lifted || needed <= STOCK_ARCHIVE_SLOTS) {
    return;
  }
  throw new Error(
    `${needed} registered IMG archives of ${STOCK_ARCHIVE_SLOTS} stock slots (${HARDCODED_ARCHIVES} hardcoded ` +
      `+ ${gtaDatImgLines} in gta.dat) — the game CRASHES at load past the eighth, and no adjuster on the ` +
      'target lifts it (see docs/gta-sa-original/img-archive-limit.md). Split fewer buckets, or set ' +
      'liftedArchiveLimit once our ASI raises CStreaming::ms_files.',
  );
}

/**
 * Split `models/gta3.img` into typed archives over a full copy of `--game`.
 *
 * Runs BEFORE any installer, which is what makes every entry name land in exactly one archive — see
 * `docs/architecture/img-archive-layout.md` for why that ordering is the point rather than a convenience.
 * `cutscene.img` / `player.img` / `gta_int.img` are left alone.
 */
export function split(options: SplitOptions): SplitSummary {
  const gamePath = resolve(options.gamePath);
  const outPath = resolve(options.outPath);
  const buckets = options.buckets ?? (['vehicles', 'peds', 'weapons'] as const);
  guardOut(outPath, gamePath);

  rmSync(outPath, { force: true, recursive: true });
  cpSync(gamePath, outPath, { force: true, recursive: true });

  const gta3Path = join(outPath, 'models', 'gta3.img');
  // A tree with no `gta3.img` has nothing to split, and that is not an error: the stage still owes the chain
  // a complete game dir, which the copy above already produced. (TCs and the pipeline's own fixtures.)
  if (!existsSync(gta3Path)) {
    return {
      archives: [],
      contested: [],
      slots: { needed: HARDCODED_ARCHIVES, stock: STOCK_ARCHIVE_SLOTS },
      unclaimed: 0,
    };
  }
  const gta3Bytes = new Uint8Array(readFileSync(gta3Path));
  const source = openImg(gta3Bytes);
  // Snapshotted before anything moves: `names()` reflects the deletes each bucket makes as it is emitted.
  const sourceNames = source.names();
  assertUniqueNames(ver2EntryCount(gta3Bytes.subarray(0, 8)), sourceNames);

  const dataDir = join(outPath, 'data');
  const carmodsPath = join(dataDir, 'carmods.dat');
  const parts = existsSync(carmodsPath)
    ? vehiclePartsFromCarmods(readFileSync(carmodsPath, 'latin1'))
    : new Set<string>();
  const claims = readIdeFiles(dataDir).flatMap((text) => claimsFromIde(text, parts));
  const { bucketOf, contested, unclaimed } = classifyEntries(sourceNames, claims);

  const archives: SplitSummary['archives'] = [];
  for (const bucket of buckets) {
    const names = sourceNames.filter((name) => bucketOf.get(name.toLowerCase()) === bucket);
    if (names.length === 0) {
      continue;
    }
    const target = createImg();
    for (const name of names) {
      target.set(name, source.get(name) ?? new Uint8Array(0));
      source.delete(name);
    }
    archives.push({ ...writeArchive(target, join(outPath, 'models', `${bucket}.img`)), name: `${bucket}.img` });
  }
  archives.push({ ...writeArchive(source, gta3Path), name: 'gta3.img' });

  const imgLines = registerImgArchives(
    outPath,
    archives.filter((archive) => archive.name !== 'gta3.img').map((archive) => archive.name),
  );
  assertArchiveSlots(imgLines, options.liftedArchiveLimit === true);

  return {
    archives,
    contested,
    slots: { needed: HARDCODED_ARCHIVES + imgLines, stock: STOCK_ARCHIVE_SLOTS },
    unclaimed: unclaimed.length,
  };
}

/**
 * Refuse a source archive whose directory declares more rows than it has distinct names.
 *
 * The whole layout rests on a name living in exactly one archive, so a duplicate has to be refused rather
 * than split. **The check has to be made against the DIRECTORY's own count**, not against the names the
 * reader hands back: `parseVer2Directory` keys a Map by name, so a duplicate is already collapsed — and
 * silently, taking one entry's bytes with it — by the time anything downstream can look. Comparing the two
 * numbers is what makes that visible at all.
 */
function assertUniqueNames(declaredEntries: number, names: readonly string[]): void {
  if (declaredEntries === names.length) {
    return;
  }
  throw new Error(
    `gta3.img's directory declares ${declaredEntries} entries but holds ${names.length} distinct names — ` +
      `${declaredEntries - names.length} duplicate(s), whose bytes the reader has already dropped. The split ` +
      'needs one name in one archive; rebuild the source first.',
  );
}

/** Refuse an `--out` that would wipe the source. */
function guardOut(outPath: string, gamePath: string): void {
  if (outPath === parse(outPath).root) {
    throw new Error(`refusing to wipe the filesystem root as --out: ${outPath}`);
  }
  if (outPath === gamePath || gamePath.startsWith(outPath + sep)) {
    throw new Error(`--out must not be, or contain, --game (would wipe it): ${outPath}`);
  }
}

/** Every `.ide` under `data/`, read as latin1 (the encoding the stock tables ship in). */
function readIdeFiles(dataDir: string): string[] {
  const texts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.toLowerCase().endsWith('.ide')) {
        texts.push(readFileSync(path, 'latin1'));
      }
    }
  };
  if (existsSync(dataDir)) {
    walk(dataDir);
  }

  return texts;
}

/** Stream an archive out and report what it cost. Size comes from `stat` — reading it back would reintroduce
 *  the very 2 GiB ceiling this tool exists to keep the tree under. */
function writeArchive(img: EditableImg, path: string): { bytes: number; entries: number } {
  const entries = img.names().length;
  writeImgFile(img, path);

  return { bytes: statSync(path).size, entries };
}
