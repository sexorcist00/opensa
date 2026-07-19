import type { OptimizerPasses } from '@opensa/map-optimizer/run';

/** perfect-map-builder run config (plan 001). */
export interface BuilderConfig {
  /**
   * Cell size for the OpenSA cell-LOD bake — the GAME-side grid (`GAME_CELL_SIZE`, 256): the one the world
   * adapter streams collision and scatters procobj on, and the one a baked impostor is PLACED in.
   *
   * NOT the render grid. opensa-pack welds `.oscell` blobs on its own `CELL_SIZE` (250) and the manifest
   * carries that to the engine; the two have never matched, and nothing requires them to — an impostor is a
   * placement like any other and welds into whichever render cell its position falls in. (Both this comment
   * and `lod.config.ts`'s claimed that they must match. They did not, and the field never noticed.)
   */
  lodCellSize: number;
  /** map-optimizer pass toggles; `{}` = all on (the default full-feature build). */
  optimizerPasses: Partial<OptimizerPasses>;
  /**
   * The opensa-pack stage (plan opensa-pack/003 phase 6) — the final conversion of the `opensa` target.
   * `rect` is inclusive GTA CELL coordinates; the default covers the whole map.
   */
  pack: { ao: boolean; bakes: boolean; bakeWorkers?: number; rect: readonly [number, number, number, number] };
  /** LOD texture size for the procobj bake. */
  procobjTex: number;
  /** The `--in` (mods-src) subfolder names, one per stage. */
  subfolders: { mods: string; peds: string; procobj: string; vegetation: string; vehicles: string };
  /** LOD atlas texture size for the tree impostor bake. */
  treeTex: number;
}

export const config: BuilderConfig = {
  lodCellSize: 256,
  optimizerPasses: { addNormals: true }, // all passes on; normals created for OpenSA's SSAO (plan 015)
  // AO stands in for prod's SSAO, so it stays on. The heavy SUN-VIS bake is OFF for now (user,
  // 2026-07-19) — the gating logic itself is due for a rework, and until then a pipeline run should not
  // pay for it. A shipping build wants it back: without sun-vis the direct sun renders unshadowed under
  // bridges and in canyons.
  pack: { ao: true, bakes: false, rect: [-12, -12, 12, 12] },
  procobjTex: 128,
  subfolders: { mods: 'mods', peds: 'peds', procobj: 'procobj', vegetation: 'vegetation', vehicles: 'vehicles' },
  treeTex: 512,
};
