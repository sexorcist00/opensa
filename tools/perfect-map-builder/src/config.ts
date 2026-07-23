import type { OptimizerPasses } from '@opensa/map-optimizer/run';

/** perfect-map-builder run config (plan 001). */
export interface BuilderConfig {
  /**
   * Cell size for the OpenSA cell-LOD bake. MUST equal opensa-pack's render grid (`CELL_SIZE`, 250) so an
   * object's HD and LOD land in the same streaming slot (plan 002's invariant; the old 256 matched the
   * THREE-ERA streaming grid). Field-proven on gostown (plan 087, 2026-07-23): with a 256 bake the bridge
   * main span had HD in slot 5,−7 and LOD in 5,−6 — at spawn neither loaded. Collision streaming and
   * procobj scatter keep their own `GAME_CELL_SIZE` (256) — this knob does not touch them.
   */
  lodCellSize: number;
  /** map-optimizer pass toggles; `{}` = all on (the default full-feature build). */
  optimizerPasses: Partial<OptimizerPasses>;
  /**
   * The opensa-pack stage (plan opensa-pack/003 phase 6) — the final conversion of the `opensa` target.
   * `rect` is an optional per-RUN override; normally the pipeline resolves the game's `full` rect from
   * {@link PACK_RECTS} (and auto-fits when the game has none). The old single hardcoded ±12 covered SA but
   * silently dropped a TC's far islands (plan 087 — a quarter of gostown's LOD map fell outside it).
   */
  pack: { ao: boolean; bakes: boolean; bakeWorkers?: number; rect?: readonly [number, number, number, number] };
  /** LOD texture size for the procobj bake. */
  procobjTex: number;
  /** The `--in` (mods-src) subfolder names, one per stage. */
  subfolders: { mods: string; peds: string; procobj: string; vegetation: string; vehicles: string };
  /** LOD atlas texture size for the tree impostor bake. */
  treeTex: number;
}

/**
 * Per-game convert rects, inclusive GTA CELL coordinates [x0, y0, x1, y1] (user directive, plan 087):
 * every game names its own rects instead of one hardcoded map size. `full` is what the pipeline passes to
 * the pack stage; the other keys are pinned debug/bench districts for standalone `opensa-pack --rect` runs.
 * A game absent here (or without `full`) auto-fits to the occupied world grid — pin a new TC's true
 * extent with `scripts/debug/grid-extent.ts <game-dir>` first.
 */
export const PACK_RECTS: Record<string, Record<string, readonly [number, number, number, number]>> = {
  gostown: {
    // Measured 2026-07-23 (plan 087, grid-extent on the merged build): the far islands reach cell x 37 /
    // y −16 — the old hardcoded ±12 silently dropped a quarter of the lod map.
    full: [-8, -16, 37, 5],
  },
  original: {
    // True occupied extent measures [-12,-12,11,11]; ±12 is kept because it is what every existing
    // original pak was built with — same rect ⇒ same chunking ⇒ byte-identical reruns.
    full: [-12, -12, 12, 12],
    // The pinned LS bench district (074/11 bench scenes: ls-bench / ls-close / ls-sweep).
    ls: [8, -9, 11, -5],
  },
};

export const config: BuilderConfig = {
  lodCellSize: 250,
  optimizerPasses: { addNormals: true }, // all passes on; normals created for OpenSA's SSAO (plan 015)
  // AO stands in for prod's SSAO, so it stays on. The heavy SUN-VIS bake is OFF for now (user,
  // 2026-07-19) — the gating logic itself is due for a rework, and until then a pipeline run should not
  // pay for it. A shipping build wants it back: without sun-vis the direct sun renders unshadowed under
  // bridges and in canyons.
  pack: { ao: true, bakes: false },
  procobjTex: 128,
  subfolders: { mods: 'mods', peds: 'peds', procobj: 'procobj', vegetation: 'vegetation', vehicles: 'vehicles' },
  treeTex: 512,
};
