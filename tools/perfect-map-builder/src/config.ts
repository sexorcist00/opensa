import type { OptimizerPasses } from '@opensa/map-optimizer/run';

/** perfect-map-builder run config (plan 001). */
export interface BuilderConfig {
  /** Grid cell size for the OpenSA cell-LOD bake (must match the engine streaming grid). */
  cellSize: number;
  /** map-optimizer pass toggles; `{}` = all on (the default full-feature build). */
  optimizerPasses: Partial<OptimizerPasses>;
  /** LOD texture size for the procobj bake. */
  procobjTex: number;
  /** The `--in` (mods-src) subfolder names, one per stage. */
  subfolders: { mods: string; peds: string; procobj: string; vegetation: string; vehicles: string };
  /** LOD atlas texture size for the tree impostor bake. */
  treeTex: number;
}

export const config: BuilderConfig = {
  cellSize: 256,
  optimizerPasses: {}, // all passes on
  procobjTex: 128,
  subfolders: { mods: 'mods', peds: 'peds', procobj: 'procobj', vegetation: 'vegetation', vehicles: 'vehicles' },
  treeTex: 512,
};
