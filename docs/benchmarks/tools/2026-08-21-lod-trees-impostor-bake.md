# Tree impostor bake: the supersampled, mip-aware atlas (lod-trees 013 step 01)

**Date:** 2026-08-21 · **Tool:** `@opensa/lod-trees-generator` (`core/raster.ts`, `core/render.ts`,
`core/dilate.ts`) + `@opensa/rw-codec` (`dxt-encode.ts`) · **Machine:** the dev Mac (darwin 25.6.0,
node 24.15.0) · **Inputs:** HD trees from `mods-src/original/vegetation`, stock trunk prelight from
`game-src/original` (the stage's `--prelight`), `--tex 512` (pmb's `treeTex`, NOT the 128 CLI default),
4 cards · **Instrument:** `scripts/debug/impostor-atlas-census.ts` (bakes in process, ~2 s per tree
against a ~10 min pmb `trees` stage).

## Why this run exists

Plan 013 measured four causes for a tree LOD looking nothing like its HD. Step 01 answers two of them —
the point-sampled bake (cause 2: 5–7 % isolated opaque texels = the white speckle) and DXT5 fitted over
black transparent texels (cause 4). The step's own acceptance is the atlas, so the atlas is what is
measured here; the field verdict comes in step 05, after 02 and 03.

## The two reference trees, before and after

`before` = the 2026-08-17 bake (point sample, binary 0.5 test, no dilation, endpoints over all 16 texels).
`after` = supersampled `--ss 2`, colour from the mip level matching one sub-sample, alpha still decided at
the base level, 6 rings of colour dilation, DXT5 endpoints fitted over visible texels only.

| | `sm_veg_tree5` before | after | `sm_veg_tree7vbig` before | after |
| --- | ---: | ---: | ---: | ---: |
| canopy fill (α ≥ 128, upper 60 % of the card) | 51.1 % | 40.9 % | 56.7 % | 47.0 % |
| **canopy mass** (mean α over the same box) | **33.5 %** | **33.7 %** | **36.8 %** | **36.9 %** |
| isolated texels (binary, ≤ 1 opaque 4-neighbour) | 6.0 % | 10.9 % | 3.7 % | 5.5 % |
| **speckle** (α ≥ 128 with 4-neighbour mean < 64) | **6.0 %** | **1.1 %** | **3.6 %** | **0.4 %** |
| mean RGB over surviving texels | 42/46/34 | 43/47/35 | 65/78/58 | 63/73/55 |
| alpha-weighted RGB over the whole tile | 44/47/35 | 44/47/35 | 66/77/58 | 64/73/56 |
| median luminance over surviving texels | 42 | 42 | 64 | 67 |
| bake (4 cards, 512²) | 285 ms | 2 135 ms | 401 ms | 2 533 ms |

**Reading the table — three of those rows exist because the first ones lie once alpha is continuous:**

- **Canopy fill falls and canopy MASS does not.** The bake stopped writing every canopy texel as fully
  opaque or fully absent; an edge texel now carries its coverage. The same amount of leaf is in the
  atlas (33.5 → 33.7 %, 36.8 → 36.9 %) — it is distributed, not removed. `canopyFill` is still worth
  reading because it is what the `sa` target draws (SA alpha-tests the sorted pass at reference 100), and
  that is exactly the field question step 01 leaves open.
- **Binary "isolated" rises while speckle falls.** With antialiased edges the survivors' neighbours drop
  below 128, so every canopy core counts as isolated by the binary measure. The continuous measure —
  a surviving texel whose 4 neighbours average below half the test — is the defect as reported, and it
  goes **6.0 → 1.1 %** and **3.6 → 0.4 %**.
- **The mean RGB falls on `tree7vbig` and the median RISES (64 → 67).** That is the bright tail being
  filtered out, not the bake going dark: the alpha-weighted mean of the whole tile moves the same −2/−4/−2,
  while the median — which a tail cannot move — goes up. `tree5`, whose atlas mean was already
  representative, does not move at all (44/47/35 both sides).

## Supersampling: what each step buys

`sm_veg_tree5` / `sm_veg_tree7vbig`, everything else equal:

| `--ss` | speckle | canopy mass | bake per tree | vs before |
| ---: | ---: | ---: | ---: | ---: |
| 1 (mip + dilation only) | 6.0 % / 3.6 % | 33.5 % / 36.8 % | 0.80 s / 0.86 s | ×2.8 |
| **2 (the default)** | **1.1 % / 0.4 %** | 33.7 % / 36.9 % | 2.13 s / 2.53 s | ×7.1 |
| 4 | 0.5 % / 0.1 % | 33.8 % / 36.9 % | 7.34 s / 9.19 s | ×25 |

The mip alone does nothing for the speckle (it is a geometric coin flip on thin leaf quads, not a texture
average); supersampling alone would keep the twig highlights. Both are needed, and the second sub-sample
step is where the defect goes.

## Stage cost

A 9-tree sample across the roster's shapes (330 → 16 092 HD triangles, one portrait atlas):

| | mean bake per tree | 9 trees |
| --- | ---: | ---: |
| before | 248 ms | 2.2 s |
| after (`--ss 2`) | 1 756 ms | 15.8 s |

**×7.1.** Extrapolated over the ~286-tree roster that is ~71 s → ~8.4 min of bake, so the pmb `trees`
stage goes from ~2 min to roughly 9–10 min — bake-time only, nothing at runtime. `--ss 4` would put it
near 35 min, which is what the 0.5 %/0.1 % row costs.

## DXT5 endpoints (`rw-codec`)

Unit measurement, one 4×4 block of eight transparent-black texels plus eight leaf greens 100–156:

| | worst green error after a DXT5 round trip |
| --- | ---: |
| endpoints fitted over all 16 texels | **26** |
| endpoints fitted over the visible 8 | **10** |

The remaining 10 is BC1's own 4-level ramp over that range, not the background. Regression-tested in
`tools/rw-codec/src/dxt-encode.test.ts` (bound 12).
