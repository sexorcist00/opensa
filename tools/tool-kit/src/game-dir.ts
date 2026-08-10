import { cpSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';

/**
 * The chain's `--game` in / `--out` out convention (plan opensa-pack/003): every tool copies the whole game
 * dir into `--out` and mutates the COPY, so each stage hands the next a complete, bootable game tree
 * (`perfect-map-builder/src/pipeline.ts` relies on exactly that).
 */

/**
 * Wipe `--out` and mirror the game dir into it. Guard the paths with {@link guardOut} first.
 *
 * **`dereference` is what keeps `--out` a real tree.** With the default, a SYMLINKED `--game` is copied as a
 * symlink — so `--out` becomes a second name for the game dir, and every stage after this one (the archive
 * rewrite above all) writes into the source. That is not theory: on 2026-08-10 the guard passed on two
 * genuinely different paths, and then this copy created the very aliasing the guard exists to prevent —
 * the run rewrote the game archives that had been restored an hour earlier.
 */
export function copyGameDir(gamePath: string, outPath: string): void {
  rmSync(outPath, { force: true, recursive: true });
  cpSync(gamePath, outPath, { dereference: true, force: true, recursive: true });
}

/**
 * Refuse a dangerous `--out` before anything is wiped: the filesystem root, a path that IS one of the source
 * dirs, one that CONTAINS one (wiping `--out` would take the source with it), or one that sits INSIDE one
 * (the copy would feed on itself).
 *
 * The comparison is on REAL paths, symlinks resolved, because the names alone do not tell you where a wipe
 * lands. On the phone `build/*` and `game-src/*` are routinely symlinks into shared storage, and two of them
 * pointing at one folder is exactly how a converter run ate its own source archives (2026-08-09) — the guard
 * saw two different names and let it through.
 */
export function guardOut(outPath: string, ...sources: readonly string[]): void {
  const out = realPath(outPath);
  if (out === parse(out).root) {
    throw new Error(`refusing to wipe the filesystem root as --out: ${outPath}`);
  }
  for (const source of sources) {
    const real = realPath(source);
    const where = real === resolve(source) ? source : `${source} → ${real}`;
    if (out === real) {
      throw new Error(`--out must differ from the source dirs: ${outPath} and ${where} are the same directory`);
    }
    if (real.startsWith(out + sep)) {
      throw new Error(`--out must not contain a source dir (would wipe it): ${outPath} contains ${where}`);
    }
    if (out.startsWith(real + sep)) {
      throw new Error(`--out must not sit inside a source dir (would copy into it): ${outPath} is inside ${where}`);
    }
  }
}

/**
 * Where a path really lands, symlinks resolved. `--out` does not have to exist yet, so an unresolvable tail
 * is rebuilt onto the nearest ancestor that does resolve — which is the directory a wipe would sit in.
 */
function realPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);

    return parent === absolute ? absolute : join(realPath(parent), basename(absolute));
  }
}
