import type { ProcObjDensityInput } from '@opensa/map-placement/procobj-density';

/** Build knobs for the procobj LOD generator (overridable via CLI flags). */
export interface ProcObjLodConfig {
  /** Build-time scatter density CUTOFF — **1 = vanilla**, up to the scatter's candidate ceiling
   *  (`PROC_OBJ_MAX_DENSITY` = 3; a higher cutoff has no candidates left to keep and is refused). The count
   *  scales with it until {@link ProcObjLodConfig.procObjMax} binds instead.
   *
   *  A plain number is the whole map. A `ProcObjDensityConfig` sets it per CATEGORY and per
   *  category×SURFACE — plan 010's density model, and the shape a shipped profile takes. **It is not keyed by
   *  target**: `sa` and `opensa` get the same density (decision 2), and what the target picks is caps and
   *  reporting. Every profile is priced by 013's perf budget before it ships; until that number exists the
   *  default stays 1. */
  density: ProcObjDensityInput;
  /** Emitted LOD draw distance (world units) — the visibility gate for the LOD def.
   *  MUST stay BELOW 300: SA classifies defs with drawDistance ≥ 300 (the FLA-configurable "LOD distance")
   *  as big buildings / the LOD layer, and MASS text-IPL instances of such defs overflow that path's
   *  internal structures — corrupted CIplStore state streamed in script-gated IPLs (the "ghost barriers2
   *  roadblocks" bug, isolated by in-game bisection 2026-07-06: dist 300 reproduces, 250 is clean; the
   *  budget is shared with lod-trees impostors). Bushes/rocks are sub-pixel past ~250 anyway. */
  drawDistance: number;
  /** Species at least this tall (m) get a permanent text LOD row + lod-link (SA hides the LOD while the HD
   *  is streamed in — matters when the LOD pokes out of the HD). Shorter species ship BOTH rows unlinked in
   *  the binary streams: the LOD hides inside the HD up close, and the avoided text rows protect SA's int16
   *  building-pool index budget — `IplDef::firstBuilding/lastBuilding` truncate pool indexes to int16, so
   *  PERMANENT (text) instances past ~32.7k corrupt CIplStore stream-out ranges (the FINAL ghost-barriers
   *  root cause, bisected to exactly 32,768 total text rows on 2026-07-06). */
  linkedHeight: number;
  /** Optional min HD height (m) gate — drops short clutter (grass) from conversion. 0 = off. */
  procObjHeight: number;
  /** Cap on statically converted procobj objects (0 disables the conversion). It is OUR safety cap, not a
   *  target ceiling: once it binds, the lowest-lottery cut is global, so raising one category displaces the
   *  others instead of adding to them (07/02 decision 8). Keep it clear of the authored count — a build that
   *  is capped is measuring the cap. `CAP DROPPED n` says when it bit. */
  procObjMax: number;
  /** Max texture dimension (px) in the shared `lod_procobj.txd`; sources are downscaled to it. */
  textureSize: number;
  /** QEM decimation target triangles per LOD model. */
  tris: number;
}

/** Defaults tuned for medium-distance procobj clutter (bushes, rocks, scrub). */
export const config: ProcObjLodConfig = {
  density: 1, // vanilla; every profile 07/02 ships moves this, and every measurement states which one it ran
  drawDistance: 290,
  linkedHeight: 4,
  procObjHeight: 0,
  // 20000 until 2026-08-09, when SPACING started being read as a length: the authored density is 91 067
  // objects for the 43 converted species, so the old cap threw away 78 % of them and every field verdict
  // would have been about the cap. Clear of that count, not a budget — 07/04 sets the per-target one.
  procObjMax: 100000,
  textureSize: 64,
  tris: 200,
};
