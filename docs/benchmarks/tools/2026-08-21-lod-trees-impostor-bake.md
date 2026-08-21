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

## Stage cost — and the extrapolation that was wrong

A 9-tree sample across the roster's shapes (330 → 16 092 HD triangles, one portrait atlas), each tree loaded
with its OWN textures:

| | mean bake per tree | 9 trees |
| --- | ---: | ---: |
| before | 248 ms | 2.2 s |
| after (`--ss 2`) | 1 756 ms | 15.8 s |

**×7.1** — from which this file first extrapolated "the `trees` stage goes from ~2 min to roughly 9–10 min".
**The build measured 1 940.5 s — 32.3 min, against 83.4 s on 2026-08-20 (×23).**

The gap was a defect, not the supersampling: `renderImpostor` wrapped `tree.textures` in a mip chain per
tree, and the stage hands ONE folder-wide map (148 textures) to every tree — `io.loadTree` stores it
verbatim — so every chain in the folder was rebuilt 286 times. The census never saw it because it loads only
the textures a model names. Reproduced in the stage's own shape and fixed by memoising the chain ON the
texture, plus removing the per-fragment allocations from the sampler:

| per tree, stage shape (one folder-wide texture map) | `tree5` | `tree7vbig` | `ash1_hi` | `pinetree04` |
| --- | ---: | ---: | ---: | ---: |
| chain rebuilt per tree (the defect) | 11 024 ms | 11 438 ms | 10 753 ms | 12 736 ms |
| chain memoised | 2 363 ms | 2 761 ms | 2 172 ms | 3 792 ms |
| + allocation-free sampler | **1 713 ms** | **2 065 ms** | **1 698 ms** | **2 676 ms** |

The atlas is unchanged by both (the census reports the same numbers to the digit). Projected over the roster
that is ~10 min of bake; the stage's own measured time from the next build replaces this line.

**The lesson, again**: a per-item cost measured on a fixture that does not share what the pipeline shares is
not the pipeline's cost. The 9-tree sample was honest about the bake and blind to the stage.

## Step 02 — one winding per card

Same instrument path (`buildCardGeometry` + `encodeLodDff`, `sm_veg_tree5`, 4 cards):

| | triangles | LOD DFF |
| --- | ---: | ---: |
| two windings (before) | 16 | 2 844 B |
| one winding (after) | **8** | **2 684 B** |

The bytes are not the point (−160 B × ~286 trees ≈ −45 KB); the draw is. The IDE row already carried
`DISABLE_BACKFACE_CULLING`, which both engines read, so the mirrored copy was the same face drawn twice —
and in the impostor's blend path, with no depth write, every partial-coverage texel composited twice.

The same step gives each impostor row the vegetation bits of the HD row it replaces: on the integration
game-dir, HD `0x202084` → LOD `2105476` (was `2097284`), HD `0x204084` → `2113668`, and an HD row with
double-sided + additive but no vegetation bit leaves the LOD row unchanged.

## Step 03 — how dense the cage is against the tree

Instrument: `scripts/debug/impostor-density.ts` — HD mesh and card cage rendered from the SAME poses by the
same software rasteriser, 16 azimuths, at the size a tree really has on screen (a 15 m tree at SA's ~70° fov
on a 900 px viewport is ~64 px tall at the 150 u HD draw distance, ~32 px at twice it). `mass` is the mean
alpha over the canopy box — the coverage as rendered; `covered` is the share above the cutout; the bracket is
the per-azimuth spread around the mean.

**As the pair ships after steps 01–02** (cutout class, one winding, `--ss 2`, 512² atlas), 64 px:

| | covered | mass | spread | luma |
| --- | ---: | ---: | ---: | ---: |
| `sm_veg_tree5` HD | 27.7 % | 23.3 % | 0.92..1.06 | 27 |
| `sm_veg_tree5` LOD, 4 cards | 29.9 % (×1.08) | 22.7 % (**×0.97**) | 0.94..1.05 | 27 (×1.01) |
| `sm_veg_tree5` LOD, 2 cards | 20.6 % (×0.74) | 17.8 % (×0.77) | 0.94..1.05 | 26 (×0.98) |
| `sm_veg_tree7vbig` HD | 34.8 % | 27.0 % | 0.97..1.03 | 39 |
| `sm_veg_tree7vbig` LOD, 4 cards | 32.5 % (×0.93) | 23.3 % (**×0.86**) | 0.97..1.03 | 39 (×1.01) |
| `sm_veg_tree7vbig` LOD, 2 cards | 25.3 % (×0.73) | 20.4 % (×0.75) | 0.88..1.10 | 39 (×1.00) |

32 px moves nothing by more than 0.02 (`tree5` 4 cards ×0.97 mass, `tree7vbig` ×0.87).

**As the pair was when the field reported it** — the blend class (no depth write, cards composited), the
point-sampled atlas (`--ss 1`, whose alpha is exactly the old bake's) and two windings per card:

| | covered | mass |
| --- | ---: | ---: |
| `sm_veg_tree5` LOD, 4 cards | 38.7 % (×1.38) | 37.0 % (**×1.59**) |
| `sm_veg_tree7vbig` LOD, 4 cards | 41.3 % (×1.19) | 39.6 % (**×1.47**) |

Splitting that 1.59 into its causes, `sm_veg_tree5` 4 cards, mass against the HD:

| configuration | mass |
| --- | ---: |
| blend + two windings + point-sampled alpha (before) | ×1.59 |
| blend, one winding, antialiased alpha | ×1.24 |
| cutout, one winding, antialiased alpha (after) | ×0.97 |

The canopy was ~1.5× the tree's density, and the CLASS was most of it: the same cards drawn cutout instead of
composited go from ×1.24 to ×0.97. The plan's opening estimate — four cards at ~55 % fill stacking to ~96 % —
assumed the cards' opaque texels are independent; they are four projections of the same canopy, so their
union is far below what independence predicts.

## DXT5 endpoints (`rw-codec`)

Unit measurement, one 4×4 block of eight transparent-black texels plus eight leaf greens 100–156:

| | worst green error after a DXT5 round trip |
| --- | ---: |
| endpoints fitted over all 16 texels | **26** |
| endpoints fitted over the visible 8 | **10** |

The remaining 10 is BC1's own 4-level ramp over that range, not the background. Regression-tested in
`tools/rw-codec/src/dxt-encode.test.ts` (bound 12).
