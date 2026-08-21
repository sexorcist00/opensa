import type { TreeLodConfig } from './core';

/** Default bake knobs (overridable via `--tex` / `--cards` / `--draw`). Tuned per the SA reference (`lodCedar1_hi`). */
export const config: TreeLodConfig = {
  // Trees taller than 2× their width bake into a portrait (width × 2*width) atlas so vertical detail isn't
  // squashed into a square tile. Below this they stay square.
  aspectThreshold: 2,
  cards: 4,
  drawDistance: 1500,
  // 2×2 sub-samples per atlas texel. Measured on the plan-013 reference trees: it takes the isolated-texel
  // share (the white speckle) from 6.0 %/3.7 % to under 1 % together with the mip-aware sampling, at ~4× the
  // bake — 4×4 buys another fraction of a percent for 4× more (`docs/benchmarks/`).
  superSample: 2,
  // 128 px DXT5 per tree — matches the reference LOD mod and keeps the shared TXD small enough for SA to load
  // (256 px would be ~4× larger). Override with `--tex` if you accept a bigger TXD.
  textureSize: 128,
};
