/**
 * Where the lab reads a district from (opensa-pack 003 phase 4).
 *
 * `?src=` now names an opensa-pack `--out`, which is a GAME DIR with our products under `opensa/`. That is
 * what lets the manifest stop carrying `timecyc`: the game's own `data/timecyc*.dat` sits right there, so
 * the lab reads the same file the production host reads instead of a copy frozen at convert time (the
 * 2026-07-18 black-night / fog-divergence class of bug).
 *
 * A `?src=` that points straight at a products directory — every pak under `apps/engine-lab/public/` today —
 * still loads; it simply has no game dir beside it, and the environment falls back to the parametric driver.
 */

/** Timecyc text plus which variant it is — prod's exact preference, resolved the same way here. */
export interface LabTimecyc {
  is24h: boolean;
  text: string;
}

export interface PakSource {
  /** Where `manifest.json` / `world.ospak` live. */
  base: string;
  /** The game dir holding `data/`, or null for a bare products directory. */
  gameDir: null | string;
}

/** The game's timecyc, with prod's preference: `timecyc_24h.dat` as authored, else vanilla `timecyc.dat`. */
export async function loadLabTimecyc(source: PakSource): Promise<LabTimecyc | null> {
  if (source.gameDir === null) {
    return null;
  }
  const authored = await text(`${source.gameDir}/data/timecyc_24h.dat`);
  if (authored !== null) {
    return { is24h: true, text: authored };
  }
  const vanilla = await text(`${source.gameDir}/data/timecyc.dat`);

  return vanilla !== null ? { is24h: false, text: vanilla } : null;
}

/** Resolve `?src=` to a products base, preferring the game-dir layout (`<src>/opensa/manifest.json`). An
 *  absolute URL (a build served cross-origin, e.g. `http://localhost:3001/build/...`) passes through as-is;
 *  a bare name is made root-relative to the lab's own origin. */
export async function resolvePakSource(src: string): Promise<PakSource> {
  const root = /^(?:https?:)?\/\//.test(src) ? src.replace(/\/+$/, '') : `/${src.replace(/^\/+|\/+$/g, '')}`;
  if (await exists(`${root}/opensa/manifest.json`)) {
    return { base: `${root}/opensa`, gameDir: root };
  }

  return { base: root, gameDir: null };
}

async function exists(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

async function text(url: string): Promise<null | string> {
  try {
    const response = await fetch(url);

    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}
