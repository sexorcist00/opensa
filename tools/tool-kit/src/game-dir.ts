import { cpSync, rmSync } from 'node:fs';
import { parse, sep } from 'node:path';

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
