# 013 — Impostor parity: why every tree LOD looks nothing like its HD, and the fixes in order

**Status: IN PROGRESS** — step 01 BUILT 2026-08-21 (ledger below), 02–05 open. Reach: `tools/lod-trees-generator` (the rule), `tools/rw-codec`
(the DXT5 endpoint fit), `tools/map-placement` (the impostor IDE row), and — phase B only, OpenSA target only —
`packages/cell-weld` + `packages/engine`.

**The report** (the user, 2026-08-21, sa-map-viewer with `?lod=1` at HD range, `sm_veg_tree7vbig` and
`sm_veg_tree5`): "every tree differs, not only these two" — the LOD is a solid dark mass where the HD is an airy
canopy with sky through it, the leaves carry white speckle, and the trunk shows as crossed planes. Plan 012
made the impostor colour-correct and it still looks wrong, because colour was never the whole of it.

## What was measured (2026-08-21, the 2026-08-17 build, both targets' archives)

Instruments: the built `lodtrees.txd` + `lodsm_veg_tree5.dff` out of `build/original/sa/models/gta3.img`, the
`.osm` pair out of `build/original/opensa/models/gta3.img`, the HD source in `mods-src/original/vegetation/`.

| Fact | `sm_veg_tree5` | `sm_veg_tree7vbig` |
| --- | --- | --- |
| HD | 4 065 tris, NO normals, prelit trunk 70 / branches 181 / leaves 145 (after the `--prelight` transfer) | 8 820 tris, NO normals, 64 / 152 / 144 |
| Impostor | 16 tris = 4 cards × 2 tris × 2 windings, prelit 148, night 21 | same, prelit 143, night 19 |
| Atlas | 512² DXT5, 4 tiles of 256² | same |
| Canopy fill per card (upper 60 % of the silhouette box) | **54–57 %** | **56–61 %** |
| Isolated opaque texels (≤ 1 opaque 4-neighbour) | **5.1–7.2 %** | 4.1–4.7 % |
| Atlas texels clipped (any channel ≥ 250) | 0.0 % | 0.3 % |
| Atlas mean RGB over opaque texels vs source leaf texture | 41/47/37 vs 39/44/30 | 64/75/62 vs 55/69/47 |
| Normals in the built `.osm` | HD and LOD both `(0,0,1)` on every vertex | same |
| IDE flags | HD `2105476` = `0x202084` (double-sided + **IS_TREE** + draw-last); LOD `2097284` = `0x200084` — no `IS_TREE` | same |

## The causes, in the order they matter

1. **Over-density by construction — the dominant one.** A card is the orthographic projection of the WHOLE
   canopy, so ONE card seen head-on has exactly the HD's coverage (~55 %). The impostor draws FOUR such cards
   crossed at 45°, and from any viewpoint all four contribute: `1 − 0.45⁴ ≈ 96 %` fill against the HD's 55 %.
   The sky and ground that show through nearly half of the HD canopy are replaced by leaf texels — that is the
   "solid dark blob", and no amount of colour work changes it. On top of it every card is emitted with BOTH
   windings while its IDE row already says `DISABLE_BACKFACE_CULLING` (both engines draw it cull-none), so each
   card is drawn twice; in a blend path with no depth write that doubles every partial-coverage edge texel.
2. **Point-sampled bake — the speckle.** `rasterizeTriangle` takes ONE bilinear sample of the source texture
   per atlas texel (a 1024² leaf texture on a 256 px card: a ~16×16-texel footprint collapsed to one point) and
   a binary 0.5 alpha test. Bright twig texels the HD's mips average away survive as single white dots, thin
   leaves pass or fail the test at random — the 5–7 % isolated texels above. Real SA shows the same atlas, so
   this is visible on both targets.
3. **Wrong alpha class, and no wind.** The impostor row carries `0x200084` — `DEFAULT_FLAGS` in
   `map-placement/ide.ts`, copied from Proper-Fixes' LOD vegetation — and the HD row carries `IS_TREE`. In
   OpenSA `isVegetationDef` reads that bit: the HD canopy is welded CUTOUT (depth write, sharpened edge,
   `fsWorldCutout`) and the impostor SOFT BLEND (no depth write, sorted, `fsWorld`): a different pipeline and a
   different edge for the same leaves, and the blend path is what turns cause 1 from stacking into full
   compositing. The same bit is what makes the HD sway; the LOD stands still beside it.
4. **DXT5 fitted over black transparent texels.** The bake's raster starts at RGBA 0 and nothing dilates colour
   into the transparent texels before `encodeDxt('dxt5')`; `endpoints()` excludes transparent texels only in
   DXT1 punch-through mode, so every 4×4 block that touches an edge spans black↔leaf and its leaf texels
   quantise toward black. The engine's `processAlphaTexture` dilates AFTER decoding — too late. Contributes to
   both the darkness and the noise; it is in both targets' atlases.

**Ruled out, with the numbers above**: prelit clipping by plan 012's normalisation (0.0 % clipped; atlas mean
tracks the source leaf texture), atlas resolution (512 px per tree, 256 per card — not the 128 default), and
normals (both HD and impostor carry `(0,0,1)` in the built `.osm`, so the viewer lights them the same; in the
PAK the cell bake rebuilds smooth normals — plan 015 — and a flat card's rebuilt normal is its plane, which
phase B addresses by authoring the normal on purpose).

**Where it was seen vs where it matters**: the screenshots force the LOD at HD range, the worst case. The
acceptance criterion is parity AT THE SWITCH and beyond (HD `vegetation` rows draw to 150, the impostor to
1 500), judged from the driver's seat; the viewer pair `?lod=0` / `?lod=1` at the same `&at=…&h=…&pitch=…&yaw=…`
pose is the offline instrument — it is what produced the report and it is reproducible.

## Steps

| # | Step | Target | Lands in |
| --- | --- | --- | --- |
| 01 | supersampled, mip-aware bake; colour dilation before DXT5; DXT5 endpoints ignore transparent texels | both | `lod-trees-generator/core/raster.ts`, `render.ts`; `rw-codec/dxt-encode.ts` |
| 02 | the impostor row inherits the source's vegetation bits; one winding per card | both | `map-placement/ide.ts` (flags param is already there), `lod-trees-generator/core/cards.ts` |
| 03 | density: measure the stack, pick the card rule — MEASURED, 4 cards stay | both | `lod-trees-generator` config + a benchmark |
| 04 | view-weighted cards (a billboard-set material): one projection from every angle | OpenSA; `sa` via an ASI render callback (see below) | `cell-weld`, `engine` shaders — go/no-go on 03's numbers |
| 05 | field verdict, numbers, docs | — | `docs/benchmarks/`, this file, tool readme |

### 01 — the bake stops aliasing

- `rasterizeTriangle` samples an `S×S` sub-grid per texel (start `S = 4`; it is a bake-time cost only —
  record the bake time before/after, the `trees` stage is ~2 min today), accumulating PREMULTIPLIED colour and
  coverage; the texel's alpha is its coverage, its colour the covered mean. The source texture is sampled at
  the mip whose texel size matches the sub-sample footprint (reuse `buildMipChain` on the decoded source), so
  a twig highlight contributes its share and no more.
- After the tile is rendered, dilate colour into transparent texels (nearest covered colour, 8 px is plenty
  for a 4×4 block fit) BEFORE the DXT5 encode; `endpoints()` gets the same transparent-exclusion it has for
  punch-through, for every format with an alpha channel. Both encodings (gamma and linear) take the same path.
- Keep the 0.5 test only where SA needs a decision: the gamma atlas for the `sa` target is alpha-tested by
  the game at the entity's reference anyway; the linear sidecar carries coverage as authored and the OpenSA
  weld classes it (02). Whether the `sa` atlas should stay coverage or be re-thresholded is a FIELD question
  — both go into the bottle and the user looks.
- **Done when** the isolated-texel share drops below 1 % on the two reference trees and the atlas mean RGB
  stays within ±3 of today's (the bake got smoother, not darker or lighter).

#### 01 — BUILT 2026-08-21 (not yet field-verified; that is step 05)

Numbers, conditions and the full tables: [`docs/benchmarks/tools/2026-08-21-lod-trees-impostor-bake.md`](../../../../docs/benchmarks/tools/2026-08-21-lod-trees-impostor-bake.md).
Instrument: `scripts/debug/impostor-atlas-census.ts` — bakes a named tree IN PROCESS in ~2 s (a full `trees`
stage is ~10 min), and it reproduced the plan's own baseline before anything was changed, which is the only
reason its "after" is worth reading.

| | `sm_veg_tree5` | `sm_veg_tree7vbig` |
| --- | ---: | ---: |
| speckle (α ≥ 128 with 4-neighbour mean < 64) | 6.0 % → **1.1 %** | 3.6 % → **0.4 %** |
| canopy MASS (mean α over the canopy box) | 33.5 % → 33.7 % | 36.8 % → 36.9 % |
| canopy fill (α ≥ 128) | 51.1 % → 40.9 % | 56.7 % → 47.0 % |
| median luminance / alpha-weighted RGB | 42 → 42 · 44/47/35 → 44/47/35 | 64 → **67** · 66/77/58 → 64/73/56 |
| bake, 4 cards at 512² | 285 ms → 2 135 ms | 401 ms → 2 533 ms |

**Three things the step learned that the plan had wrong, and they are the step:**

1. **Alpha may NOT come from the mip.** Sampling alpha at the footprint-matched level and putting it through
   the 0.5 test dissolves the canopy — 51 % → 20 % fill, with the survivors MORE speckled than the point
   sample (17.9 %). The mip supplies COLOUR; the cutout decision stays at the base level and the sub-samples
   vote on it `S²` times per texel. That is the whole of `sample()`'s split, and it is commented there.
2. **The mip chain is built over CUTOUT alpha (0/255), not raw alpha.** `downsample` weights colour by alpha,
   so a leaf's sub-threshold edge texels — dark, and never drawn — were pulling the mean down: −6 green on
   `tree7vbig`. Binarising the alpha the chain is built from is what put the colour back.
3. **The old metric stops working the moment alpha is continuous.** "Isolated opaque texel" RISES (6.0 →
   10.9 %) because antialiased neighbours fall below 128, and the atlas mean RGB FALLS because the bright
   tail it was measuring is the defect being removed. The measures that survive are canopy MASS (unchanged,
   so the canopy was redistributed and not thinned) and the median luminance (42 → 42, 64 → **67**: the bake
   is if anything lighter at the middle). Both are in the census script now.

Settled by measurement: `superSample` defaults to **2**, not the 4 the plan opened with — 4 buys 1.1 → 0.5 %
and 0.4 → 0.1 % for ×25 the bake instead of ×7.1 (stage ~2 min → ~9–10 min at 2, ~35 min at 4). `--ss` is a
CLI flag, so step 05's field round can raise it without a code change. **Still open for the field**: on the
`sa` target the sorted pass alpha-tests at reference 100, so partial coverage at a canopy edge is DISCARDED
rather than faded — that is why `canopyFill` fell while the mass did not, and whether the gamma atlas wants
re-thresholding is the question step 05 puts in front of the user.

Also landed: 6 rings of colour dilation per TILE (never across the finished atlas — a card may not bleed into
its neighbour), and `rw-codec`'s `endpoints()` now fits over visible texels for every format with an alpha
channel: worst green error on a canopy-edge block **26 → 10** (BC1's own ramp is the remaining 10).

### 02 — one class, one draw, wind

- `buildLodIde` already takes `flags`; the placement stage passes `DEFAULT_FLAGS | (sourceFlags &
  (IS_TREE | IS_PALM))` per impostor, derived from the HD row it replaces — nothing per model name. On the
  `sa` target the bit is harmless on a 16-triangle card (SA's sway is a vertex shader on the vegetation
  pipeline; check `CCustomBuildingDNPipeline` / the vegetation flag path in gta-reversed before assuming, and
  record what it does to a LOD there).
- `buildCardGeometry` emits ONE winding per card; the row's `DISABLE_BACKFACE_CULLING` does the rest in both
  engines (verify on the `sa` target with the one-model swap, `scripts/debug/img-patch.ts`, not a rebuild).
- `docs/contracts/` does not change (no new name); `docs/edge-cases/converter-pipeline.md`'s "16-triangle
  impostor" line becomes 8.
- **Done when** the viewer welds `lodsm_veg_tree5` CUTOUT (the weld stats say so) and it sways.

#### 02 — BUILT 2026-08-21 (the weld/field confirmation rides with the next build)

- **The row inherits the bits, and nothing is per model name.** `sourceObjectRows` (was `sourceObjectIds`)
  now returns the FLAGS of every gta.dat IDE row that defines a source tree beside its ids, OR'd when a model
  is defined more than once — a mod's duplicate row without the bits cannot strip what another row grants.
  `lodVegetationFlags(sourceFlags)` (`map-placement/ide.ts`) = `DEFAULT_FLAGS | (sourceFlags & (IS_TREE |
  IS_PALM))`, and `buildLodIde` takes a per-model flags map because each impostor replaces a different row.
  Measured on the integration game-dir: HD `0x202084` → LOD row `2105476` (was `2097284`), HD `0x204084` →
  `2113668`, HD `0x200048` (double-sided + additive) → unchanged. Both output shapes carry it (`--out` and
  `--modloader`).
- **One winding per card**: `sm_veg_tree5`'s LOD goes **16 → 8 triangles**, its DFF 2 844 → 2 684 B. The row
  already carries `DISABLE_BACKFACE_CULLING` and both engines read it — real SA on the model info, OpenSA at
  `weld.ts:1015` — so the mirrored copy was never a second face, only the same one drawn twice (and in a
  blend path with no depth write, composited twice).
- **The `sa` half of the flag was checked before it was written, not after**: SA's sway is
  `CEntity::ModifyMatrixForTreeInWind`, called from `PreRender` on `SwaysInWind()`, and it shears the
  entity's matrix `at` vector rather than the vertices — the plan's own note guessed "a vertex shader on the
  vegetation pipeline". Recovered from gta-reversed and recorded as
  [`docs/gta-sa-original/tree-wind-sway.md`](../../../../docs/gta-sa-original/tree-wind-sway.md): the bit
  costs the same on an 8-triangle card as on the tree, and `IS_PALM` adds its own wind term on top.
- **What is NOT verified yet, and honestly**: the "done when" of this step is a weld statistic and a field
  look, and both need a build that carries the new `lodtrees.ide` — no pmb run has happened since. The
  mechanism either side of the row is unit-tested (`lodVegetationFlags`, the emitted row per output shape,
  `swayKindFor`/`isVegetationDef` reading the same bits), so what remains is confirmation, not design. The
  cheap `sa` check the plan names (`img-patch.ts` with one re-baked impostor DFF) is worth spending in the
  same round as step 03's field pass rather than alone.

### 03 — density, measured before it is decided

- Instrument: a headless pair of renders per tree (HD vs LOD, the viewer's `?lod=` with a fixed pose) from 8
  azimuths at 2 distances (the switch, 2× the switch), metric = mean luminance over the canopy's screen box
  and its covered fraction. `tools-debug/bench-harness/` drives it; `docs/development/benchmarks.md`.
- Candidates, all tool-side: 4 cards (today), 2 cards (SA's own impostors are an X — confirm on a stock
  `lod*` vegetation DFF before writing it down), and 4 cards with per-card coverage divided by the expected
  visible stack. Each is one `--cards` / one rule; the numbers pick.
- **Done when** a table in `docs/benchmarks/` shows covered-fraction and luminance per candidate against the
  HD, and the chosen rule is the one nearest the HD on both — or none is within 10 %, which is phase B's go.

#### 03 — MEASURED 2026-08-21: 4 cards stay, and phase B is NOT gated in

Numbers: [`docs/benchmarks/tools/2026-08-21-lod-trees-impostor-bake.md`](../../../../docs/benchmarks/tools/2026-08-21-lod-trees-impostor-bake.md) §
"Step 03". Instrument: `scripts/debug/impostor-density.ts`.

**Not the viewer pair this step opened with, and the swap is deliberate.** The HD mesh and the card cage are
rendered from the SAME poses by the same software rasteriser the bake uses, 16 azimuths at the size a tree
really has on screen (~64 px tall at the 150 u switch, ~32 px at twice it). It needs no build, it is
deterministic, and it isolates the geometry — the viewer pair would have measured the engine's shading at the
same time, and every run of it costs a ~50 min pak. The viewer pair is still what step 05 shoots for the
field verdict; this is what PICKS the rule.

| mass vs the HD's | `sm_veg_tree5` | `sm_veg_tree7vbig` |
| --- | ---: | ---: |
| 4 cards (today's rule) | **×0.97** | **×0.86** |
| 2 cards | ×0.77 | ×0.75 |
| per-azimuth spread, 4 cards | 0.94..1.05 (HD 0.92..1.06) | 0.97..1.03 (HD 0.97..1.03) |

- **4 cards is the rule.** It is inside 10 % on `tree5` and 14 % UNDER on `tree7vbig`; 2 cards is 23–25 %
  under on both. No coverage-divided variant was needed — nothing is over-covering to divide.
- **Phase B (04) is not justified by density.** The metric a view-weighted impostor exists to remove is the
  angular SWING, and the cage's is already the tree's own (0.94..1.05 against 0.92..1.06). The gate this step
  wrote — "none within 10 %, which is phase B's go" — did not fire.
- **Cause 1 was mostly cause 3.** The configuration the field reported on measured **×1.59** and **×1.47** the
  HD's canopy mass; of that 1.59, the CLASS is most (blend → cutout is ×1.24 → ×0.97 on the same cards). The
  plan's opening `1 − 0.45⁴ ≈ 96 %` assumed the four cards' opaque texels are independent — they are four
  projections of the same canopy, so their union is nothing like that.
- **What the numbers now say to watch is the other direction**: `tree7vbig`'s LOD is 14 % THINNER than its HD,
  and on the `sa` target partial coverage below reference 100 is discarded rather than faded, which thins it
  further. That is the same field question step 01 left open, and it now has a second reason to be asked.

### 04 — phase B: one projection from every angle (OpenSA)

The honest answer to cause 1 is a view-dependent impostor, and our engine can have one where RenderWare
cannot (`docs/project-goals.md` §2–3): the cards stay, each card's vertices carry its PLANE normal (authored by
the bake, not rebuilt by the cell bake — a weld rule for this material class), and a `billboardSet` material
scales each card's alpha by a normalised weight of `|n · viewDir|` so the cards facing the camera carry the
coverage and the edge-on ones fade — the sum over the set stays ≈ one projection. 16 vertices per tree; the
term is per-vertex. The `sa` target keeps 03's rule.

- **The `sa` target can have it too — by ASI, never by CLEO** (his question, 2026-08-21): a CLEO script has
  no reach into an atomic's draw, but an ASI does. Shape: the cards are baked as four MATERIALS of ONE atomic
  (the `objs` one-atomic rule, `docs/restrictions/assets-and-data.md`, stays satisfied), and the ASI installs
  an atomic render callback on the `lodtrees.ide` id range (the tool writes the range to a data file the ASI
  reads) that, per draw, takes the camera azimuth against the tree's frame and either renders only the 1–2
  nearest mesh splits or sets each card's `RpMaterialColor` alpha to its `|n · view|` weight — the fixed
  function multiplies material alpha by itself, no shader. Fourth consumer of `asi/sdk`, beside
  `perfect-map` / `perfect-vehicle` — its own chain is
  [`asi/perfect-vegetation/docs/plans/001`](../../../../asi/perfect-vegetation/docs/plans/001-view-weighted-impostor-cards.md)
  (scaffold done 2026-08-21). The one constraint: the install runs the SkyGfx fork, which assigns its
  building pipeline to every atomic — our callback WRAPS its render CB, it does not replace the pipeline
  (`docs/gta-sa-original/` carries the fork facts). A vertex-shader pipe (skygfx's way) is the heavier
  alternative and is not needed for this. Lands as its own sub-step of 04 after the OpenSA half is
  field-accepted — the same bake serves both.
- Gate: 03's numbers. Frame budget: no measurable change on the Ganton lap (`docs/benchmarks/` frame-cost
  family) — state the number.
- Docs in the same change: `docs/architecture/` (a new material class), `docs/features/` (vegetation LOD),
  `docs/restrictions/assets-and-data.md` if the authored-normal rule is silent when violated (it is — a
  rebuilt normal just makes the card lit like a wall again; say what catches it).

### 05 — close

Field verdict from the driver's seat at the switch distance on the `opensa` build (and the `sa` bottle for
01/02), the before/after pair in `docs/benchmarks/`, this file's ledger filled per step, the tool readme's
plan list extended, `docs/plans/README.md`'s chain row (it still reads `001`–`005`, `007`).

## Out of scope, deliberately

- **The trunk's crossed planes at HD range.** Four trunks crossing is what a crossed-card impostor IS; at the
  switch distance it is sub-pixel. Phase B's fading hides it for free; nothing else is spent on it.
- **A mid LOD** (a decimated mesh between 4 065 triangles and 8). `docs/edge-cases/converter-pipeline.md`
  names the gap; it is a different plan with its own budget.
- **The `vegetation/` HD models' own look** (the mod's prelit, its textures) — plan 007's `--prelight` is the
  standing answer; this plan only makes the LOD match whatever the HD is.
