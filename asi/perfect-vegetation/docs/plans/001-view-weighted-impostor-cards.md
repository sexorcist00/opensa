# 001 — View-weighted impostor cards (one projection from every angle, on the `sa` target)

**Status: PLANNED 2026-08-21; step 0 done 2026-08-21.** The `sa`-target half of
[lod-trees 013 step 04](../../../../tools/lod-trees-generator/docs/plans/013-impostor-parity.md). Read that
plan's measurements first: four crossed full-projection cards stack to ~96 % canopy fill against the HD's
~55 %, and that is the dominant reason every tree LOD reads as a solid dark mass. OpenSA fixes it with a
material class in its own engine; RenderWare cannot, so real SA gets it from this plugin — the user's call
(2026-08-21): "can we write our own ASI for it?" Yes; a CLEO script cannot reach an atomic's draw.

## The mechanism

1. **The data shape** (lod-trees 013/04 emits it; `docs/contracts/` will state it): an impostor's N cards are N
   MATERIALS of ONE atomic (the `objs` one-atomic rule stays satisfied), in card order, card i in the vertical
   plane at θ_i = π·i/N around the trunk. Its plane normal in model space is therefore `(cos θ_i, sin θ_i, 0)`
   — derived from the structure, never read from vertices. Every material references the same atlas texture.
2. **The hook**: the plugin wraps the RENDER CALLBACK of every impostor atomic (`RpAtomic::renderCallBack`,
   the function `RpAtomicRender`-path calls per atomic). Installed ONCE per model at the point the game
   stamps an atomic's callback at load, for atomics whose model's TXD is `lodtrees` — classification by the
   data's own name (the tool names the dictionary), never by an id range (ids move; CLAUDE.md's rule).
3. **Per draw**: camera position (`CRenderer::ms_vecCameraPosition`) minus the atomic frame's world position,
   rotated into the tree's frame (the LTM's rotation transposed), horizontal part only → `CardWeights()`
   (`src/patches/weights.hpp`): `w_i = |n_i · v|^p / Σ` → each card's `RpMaterial` colour alpha =
   `round(255 · w_i · N)` clamped to 255 (so the facing card stays fully opaque and the oblique ones fade),
   then the ORIGINAL callback runs. Materials are per-model and shared by every instance; the renderer is
   single-threaded and each atomic's draw sets them anew, so no restore is needed.
4. **Why material alpha reaches the pixel under every pipe on the install**: the fork's `ps2BuildingVS`
   multiplies the vertex colour by `matCol` and its PS is `tex × color`
   (`docs/gta-sa-original/skygfx-fork-building-pipe.md`); the stock building DN pipe and the plain
   fixed-function path modulate material colour too — **verified in step 4 on `buildingPipe=` (empty) as
   well**, because "the fork does it" is not a measurement of stock.

### What decides the visible result, and is NOT ours to assume

- **The alpha test.** The impostor row is `DRAW_LAST` (`0x4`), so it draws in the sorted entity pass at
  alpha-test ref 100 (perfect-cutscene plan 001 measured the refs: 140 in the outdoor pass, 100 deferred).
  `tex.a × mat.a < 100/255` is DISCARDED, not blended — a card weighted under ~0.4 vanishes rather than fading.
  With the fork's `dualPassBuilding` / `zwriteThreshold 200`, a card whose product falls under 200 loses its
  z-write and blends. Whether that reads as a clean fade or as popping cards is step 4's field question; the
  fallback is a two-level rule (full / off) keyed on the weight, which is the "render only the nearest 1–2
  splits" shape without a custom mesh loop.
- **The atlas alpha after lod-trees 013/01** is COVERAGE (0..1), no longer a binary cutout; the fade then has
  something to work on at the leaf edges.

## Steps

| # | Step | Lands in |
| --- | --- | --- |
| 0 | scaffold on the SDK — builds verify-only + APPLY, empty catalogue, `weights.hpp` pure | this folder, root `workspaces` |
| 1 | RE: the sites, read off the accepted exe, cross-checked against gta-reversed-modern | `gen/catalogue.ts`, `src/game.hpp`, `docs/gta-sa-original/` |
| 2 | census payload (`PVEG_CENSUS`): which atomics classify, how many draw per frame, at what cost | `src/patches/census.hpp` |
| 3 | the fix (`PVEG_FIX_CARDS`): the callback wrapper + material alpha from `CardWeights` | `src/patches/cards.hpp`; lod-trees emits N materials |
| 4 | field ladder: Wine smoke → the bottle; 013/03's metric on the `sa` target; stock pipe and fork; the exponent | `docs/benchmarks/`, this ledger |
| 5 | pmb packaging (`asiPairings`) + docs (`docs/contracts/`, `docs/commands.md`, `docs/gta-sa-original/`) | `tools/perfect-map-builder/src/pipeline.ts` |

### Step 1 — the RE, by function name (addresses are READ, not remembered)

The accepted exe is at `game-src/original/gta_sa.exe` (SHA1 `8c23ceff…`, 14 383 616 B — the fingerprint test
pins it); `.text` VA `0x401000` is file offset `0x400`, so a VA reads at `VA − 0x400C00` (`objdump -h` on
the exe is the authority if that ever looks wrong). Each entry below becomes a catalogue site with the bytes
read there and a provenance line naming the gta-reversed-modern file/function and commit. **An address that
was not read off this file does not go in the catalogue** — not even one a sibling plugin carries, unless
that plugin's provenance is cited.

| Need | Where to look (gta-reversed-modern) | What the site is for |
| --- | --- | --- |
| the load-time point that stamps an atomic's render callback | `CAtomicModelInfo::SetAtomic`, `CVisibilityPlugins::SetAtomicRenderCallback`, `CFileLoader::LoadAtomicFile` (the `objs` path) | the ONE hook: wrap the callback for impostor atomics; verified bytes at its entry |
| `RpAtomic` layout — render-callback slot, geometry, frame | `RenderWare/rpworld.h` (`RpAtomic`), `RpAtomicGetFrame` | read the callback to wrap, the geometry for its material count, the frame for the LTM |
| `RpGeometry::matList` (`RpMaterialList`: pointer, count) and `RpMaterial::color` | `rpworld.h` | N = material count; the alpha byte we write |
| `RwFrameGetLTM` | `rwcore.h` / `CVisibilityPlugins::RenderAtomicWithAlphaCB` reads it the same way | the tree's world rotation + position |
| model → TXD name | `CBaseModelInfo::m_nTxdIndex` → `CTxdStore::ms_pTxdPool` name, or the `CKeyGen` hash of `lodtrees` against the slot | the classifier; compare the hash, never a string per frame |
| `CRenderer::ms_vecCameraPosition` | already read (perfect-cutscene plan 001, `0xB76870`) — cite, do not re-read | the view vector |
| the sorted-pass alpha refs (100 / 140) | perfect-cutscene plan 001 — cite | the interplay section above |

Also in step 1, to `docs/gta-sa-original/`: what an atomic render callback IS in SA's frame (who calls it, what
`CVisibilityPlugins` installs by model type, and that the fork leaves it alone), since a later plugin will
want the same seam.

**Done when** the catalogue renders, every site byte-verifies in a verify-only build against the exe copy
(the SDK's dry run prints the plan), and the RpAtomic/material offsets are in `game.hpp` with their source.

### Step 2 — census before the fix

`PVEG_CENSUS` wraps the callback with an OBSERVER only: once per model, log "impostor: <model> N cards"; per
second, the count of impostor draws and the wall time spent in the wrapper (QueryPerformanceCounter,
KERNEL32). The numbers size step 3's per-frame budget before anything is written to a material. **Done when**
a Wine boot logs a plausible census (Ganton: tens of impostors, not thousands, N = 4 each) and the wrapper's
cost is under 0.1 ms per frame.

### Step 3 — the fix

`PVEG_FIX_CARDS`: the wrapper computes `CardWeights` for the atomic (cached per frame per atomic is a later
optimisation — step 2's number says whether it is needed), writes the N alphas, calls the original callback.
A model whose material count is outside 1..8 or whose TXD is not `lodtrees` is never touched — the wrapper is
installed only on classified atomics to begin with. lod-trees 013/04's bake change (N materials) ships in the
same build; without it every impostor has ONE material, N = 1, weight 1 — the plugin is a no-op by
construction, which is the right failure.

### Step 4 — the field ladder (the verdict, and the two questions above)

Wine smoke first (boots, logs, no crash on a Ganton drive), then the bottle. Measurement = lod-trees 013/03's
metric on this target: HD vs LOD covered fraction and mean luminance of the canopy box from 8 azimuths at the
switch distance (the SA screenshot path the harness already drives), recorded in `docs/benchmarks/` BEFORE it
is read. Then the two open questions: does the fade read as a fade under ref 100 + the fork's dual pass, or
as popping (→ the two-level rule); and does the stock pipe (`buildingPipe=` empty) honour the alpha the same
way. The exponent `kWeightPower` is the one constant: if it stays a constant, it gets a `docs/hacks/` card
naming what it was judged on. **The user's eye closes the step.**

### Step 5 — ship

`perfect-map-builder` picks `dist/perfect-vegetation.asi` up like the other three (`asiPairings`), warns when
it is missing, pairs it with the `trees` stage (no impostors → nothing to ship). Docs in the same change:
`docs/contracts/` (material order = card order, and what happens when a bake breaks it: the weights land on
the wrong cards, silently), `docs/commands.md` (the build lines), `docs/plans/README.md` (the asi row), and
this chain's readme.

## Budget and risks, named before the build

- **Frame cost**: per visible impostor per draw — one LTM read, N ≤ 8 dot products, N byte writes. Expected
  unmeasurable; step 2 MEASURES it, step 4 confirms on the bottle's FPS counter. Anything above 0.1 ms/frame
  buys the per-frame cache.
- **Coexistence**: FLA/OLA never touch the atomic render path; the SkyGfx fork owns the pipeline, not the
  callback — but step 1 verifies the callback slot's contents at install time and DEFERS if something else
  already wrapped it (a foreign value that is not the stock `CVisibilityPlugins` callback for that model type).
- **The alpha test** (above) may turn the fade into a switch; the two-level rule is the prepared fallback, and
  the decision is the field's.
- **`RpMaterial` is shared across instances** — fine for a single-threaded renderer that sets before each draw;
  the day SA's renderer is not single-threaded is not this decade.
- **Stock SA's own sway** is unaffected: `IS_TREE` on the impostor row (lod-trees 013/02) is a flag the game
  reads in its own vegetation path; this plugin never looks at it.

## Ledger

| Step | Date | Result | Numbers |
| --- | --- | --- | --- |
| 0 | 2026-08-21 | scaffold built: `make` (verify-only) and `make APPLY=1` both link; catalogue 0 entries, 4 fingerprint anchors; 5 gen tests green | `dist/perfect-vegetation.asi` 8 192 B, import table `KERNEL32.dll` only (`objdump -p`) |
