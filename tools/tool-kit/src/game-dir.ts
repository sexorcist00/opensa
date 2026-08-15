import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, parse, sep } from 'node:path';

/**
 * The chain's `--game` in / `--out` out convention (plan opensa-pack/003): every tool copies the whole game
 * dir into `--out` and mutates the COPY, so each stage hands the next a complete, bootable game tree
 * (`perfect-map-builder/src/pipeline.ts` relies on exactly that).
 *
 * Deduped from the installers' private copies — `mod-installer`, `vehicle-installer` and `ped-installer`
 * still carry their own `guardOut`; they can adopt this one whenever they are next touched.
 */

/** Wipe `--out` and mirror the game dir into it. Guard the paths with {@link guardOut} first. */
export function copyGameDir(gamePath: string, outPath: string): void {
  rmSync(outPath, { force: true, recursive: true });
  cpSync(gamePath, outPath, { force: true, recursive: true });
}

/** How many `IMG` lines `data/gta.dat` already carries — the archives the game registers beyond its three
 *  hardcoded ones. */
export function countImgArchives(gameDir: string): number {
  const datPath = join(gameDir, 'data', 'gta.dat');

  return existsSync(datPath)
    ? readFileSync(datPath, 'latin1')
        .split(/\r?\n/)
        .filter((line) => /^IMG\s/i.test(line.trim())).length
    : 0;
}

/**
 * Refuse a dangerous `--out` before anything is wiped: the filesystem root, a path equal to one of the
 * source dirs, or a path that CONTAINS one (wiping `--out` would take the source with it).
 */
export function guardOut(outPath: string, ...sources: readonly string[]): void {
  if (outPath === parse(outPath).root) {
    throw new Error(`refusing to wipe the filesystem root as --out: ${outPath}`);
  }
  for (const source of sources) {
    if (outPath === source) {
      throw new Error(`--out must differ from the source dirs: ${outPath}`);
    }
    if (source.startsWith(outPath + sep)) {
      throw new Error(`--out must not contain a source dir (would wipe it): ${outPath} contains ${source}`);
    }
  }
}

/**
 * Declare `models/*.img` archives in `data/gta.dat` and return how many `IMG` lines the file ends up with.
 *
 * **Whoever WRITES an archive registers it.** An archive the game never registers is invisible content: the
 * build succeeds, the file is on disk, and its entries simply never load. Both places that create one — the
 * split, and an installer whose family spilled into a sibling — call this, so the invariant does not depend
 * on a later stage remembering.
 *
 * Idempotent, and the lines are spliced after the LAST existing `IMG` rather than appended: `gta.dat` is read
 * top to bottom and archives are declared before the data that streams out of them.
 */
export function registerImgArchives(gameDir: string, names: readonly string[]): number {
  const datPath = join(gameDir, 'data', 'gta.dat');
  if (!existsSync(datPath)) {
    return 0;
  }
  const lines = readFileSync(datPath, 'latin1').split(/\r?\n/);
  const isImg = (line: string): boolean => /^IMG\s/i.test(line.trim());
  const wanted = names.map((name) => `IMG MODELS\\${name.toUpperCase()}`);
  const missing = wanted.filter(
    (line) => !lines.some((existing) => existing.trim().toUpperCase() === line.toUpperCase()),
  );
  if (missing.length > 0) {
    const lastImg = lines.reduce((last, line, index) => (isImg(line) ? index : last), -1);
    lines.splice(lastImg + 1, 0, ...missing);
    writeFileSync(datPath, lines.join('\n'), 'latin1');
  }

  return lines.filter(isImg).length;
}
