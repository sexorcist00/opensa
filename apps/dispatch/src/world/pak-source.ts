/**
 * Where the world comes from. `?src=` names a built game (a `perfect-map-builder --out`), and this probes the
 * layouts a build can have, exactly as the engine lab does — a dispatcher should not have to know whether the
 * pak sits under `opensa/pak/` or at the root of what was served.
 *
 * The default is `build/original`, because a field run reads `build/<game>/opensa` and nothing else: pointing
 * this at `game-src/` would render a world the game is not running.
 */

/** The default `?src=`, relative to whatever origin serves the app. */
export const DEFAULT_SRC = 'build/original';

/** Resolved location of `manifest.json` / `world.ospak` / `water.bin`. */
export interface PakBase {
  /** The URL base the streaming setup and the water loader both read from. */
  readonly base: string;
  /** The game dir beside the pak — where `data/timecyc.dat` lives, so the map is lit as the game lights it. */
  readonly gameDir: string;
  /** What was probed, for the error message when nothing matched. */
  readonly probed: readonly string[];
}

/**
 * Resolve `?src=` to a products base. An absolute URL passes through (a build served on another port); a bare
 * name is made root-relative to this app's own origin.
 */
export async function resolvePakBase(src: string): Promise<PakBase> {
  const root = /^(?:https?:)?\/\//.test(src) ? src.replace(/\/+$/, '') : `/${src.replace(/^\/+|\/+$/g, '')}`;
  const candidates = [`${root}/pak`, `${root}/opensa/pak`, `${root}/opensa`, root];
  for (const candidate of candidates) {
    if (await exists(`${candidate}/manifest.json`)) {
      return { base: candidate, gameDir: candidate.replace(/\/pak$/, ''), probed: candidates };
    }
  }

  throw new Error(
    `no pak manifest under '${src}'. Probed: ${candidates.map((path) => `${path}/manifest.json`).join(', ')}. ` +
      `Build one with \`npm run build:game:original:opensa\`, or pass ?src=<path to a built game>.`,
  );
}

async function exists(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}
