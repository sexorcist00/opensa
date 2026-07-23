# Debugging toolbox

The standing convention (2026-07-22): **a debug script that proved useful is kept in the repo** —
one-off inspectors live in `scripts/debug/`, and every kept script gets a row here (what it answers +
how to run it). Throwaway experiments run as `scripts/debug/.tmp-*.ts` (inside the repo so `@opensa/*`
path aliases resolve) and are deleted after; the moment one earns its keep, it is renamed, linted and
documented here in the same change.

## The triage method

Field bugs are traced to data BEFORE any code is touched (plans 084/085 proved the order):

1. **Symptom** — the user's in-game report, with a position and a model name if possible (F2 helps).
2. **Source asset** — is the DFF/TXD/IDE itself what we think it is? (`dump-texture`, `dump-chunks`,
   `find-instances`, `model-bbox`, IDE flags.)
3. **Pipeline stage** — which converter stage owns the transformation; its report/ledger first
   (`report.json` → `textures.missing` / `textures.crossTxd`, the pack log's ⚠/ℹ lines).
4. **Pak bytes** — what actually shipped (`dump-osm`, `dump-osm-meta`, `dump-texel-avg`). Byte-faithful
   output means the LOOK is the data's — see row G of plan 085: a "missing" radar texture was the mod's
   own near-black texture, proven by matching opaque texel averages source↔pak.
5. **Shader** — only after 1–4 are clean. The test suite cannot catch shader defects (the fake GPUDevice
   records, it does not validate); patch the shader to output its own terms as colour channels and shoot
   the game headless instead (that is how "ambient = 1.0 under the car" was found in 084).

The field verdict decides. Every measured number lands in the owning plan doc in the same change.

## Inspectors — source-asset side (`scripts/debug/`)

Run any of them as `npx tsx scripts/debug/<name>.ts …`; `--game <id>` picks the variant under
`game-src/` (default `original`).

| Script | Answers |
| --- | --- |
| `find-instances.ts <model\|id>…` | every placement of a model across ALL map IPLs (text + binary streams), with source file — "ghost text placement vs real streamed placement" |
| `inspect-area.ts <x> <y> [radius]` | every instance near a point and WHY it would (not) render: def, LOD class, interior, DFF/TXD presence, parse result |
| `dump-texture.ts <txd> <name> [out.png] [alpha]` | one TXD texture as PNG (software DXT decode). **Gotcha:** transparent texels take the viewer's background colour — always check the `alpha` dump too; for DXT1a ground truth decode blocks (3-colour mode ⇒ index 3 is transparent black) |
| `dump-chunks.ts <file> [filterHex]` | a RenderWare file's chunk tree — WHERE a plugin chunk lives |
| `model-bbox.ts <model>…` | render extents (DFF) vs collision extents (COL) — partial mesh vs transform/culling bug |
| `dump-dff-materials.ts <model>…` | per-material DFF breakdown: texture, tris/verts, DAY vs NIGHT prelit RGBA averages + per-material bbox — "which submesh is this and how does the artist light it at night" (closed 085 rows G/H) |
| `txd-alpha.ts <txd\|path>…` | per-texture format/hasAlpha — vanilla only puts a model through blended render states on its ALPHA pass, so a DXT1 no-alpha texture draws opaque even on an ADDITIVE-flagged def (085 row H) |
| `find-2dfx.ts [--img <path>]` | 2d Effect entries across the map: type histogram + decoded roadsigns; diff archives to expose re-export damage |
| `ide-flag-histogram.ts` | which IDE object-flag bits the map actually uses, with example models per bit (flag semantics: `packages/renderware/src/parsers/text/ide-flags.ts` — verify bits against a real asset before acting on them) |
| `audit-rw-coverage.ts` | what the archive's DFF/TXD data contains vs what our parsers handle (chunk histograms, parse failures, dropped textures) |
| `check-cell-signs.ts <x> <y>` | the cell build's roadsign path offline — where a missing sign drops out |
| `procobj-stats.ts <x> <y>` | procobj scatter counts for one cell, per model/category |
| `dump-fx-system.ts <system>` | one effects.fxp system: emitters, blend modes, textures, keyframed tracks |
| `wind-coverage.ts` | how each wind-listed model will sway; folder↔constant drift |
| `solve-roadsign.ts` | brute-forces the roadsign plate transform (kept as the method record) |

## Inspectors — pak side (what actually shipped)

| Script | Answers |
| --- | --- |
| `dump-osm.ts <model> [--pak dir]` | a built pak `.osm`'s sections + DESC fixture: parts, submeshes, texture-array refs, own-TEXS vs world-sourced |
| `dump-osm-meta.ts <model> [--pak dir]` | per-submesh texture-LAYER histograms (vertex meta) + each TEXS layer's size/format/mips/name-hash — the layer-mismatch finder |
| `dump-texel-avg.ts <model> [pakDir]` | average colour of each own-TEXS layer (BC endpoint scan) — tells a black/greyed bake from a faithful one in seconds |
| `dump-vehicle-ao.ts` | per-part night-alpha (vehicle AO channel) stats for the mods-src admiral/comet — bakes from the DFF, so it judges a sky-occlusion change offline (run · stash · run · diff) |
| `dump-cell.ts <x> <y> [pakDir]` | a WELDED cell's tables at a world point: objectTable rows (kind, timed window, per-group class/array/sphere) + placement boxes near the point — the pak-bytes step for bugs in the welded look (built for 085 row H) |

Default pak: `build/original/opensa/pak` (086 phase 8 — the game dir is self-contained; older builds are
probed at `opensa-pack/` and the nested `opensa/opensa`). The world-welded side of a model lives in
cell bundles, not its `.osm` — `dump-cell.ts` covers that path.

## Approaches beyond scripts

- **`report.json` ledgers first** — `textures.missing` (name → models that asked) and
  `textures.crossTxd` (donor txd per rescued name) at `<pak>/opensa/report.json`; one ⚠/ℹ pack-log
  line per event. A clean ledger rules out the resolver in one grep.
- **F2 debugger in game** — Position teleports (feature spots are pre-listed in
  `apps/web/src/game-config.tsx`), time-of-day presets, "Missing Textures: magenta" toggle.
- **Headless field check** — boot+screenshot+bench the real game without a window:
  `?loader=http-dir` + `npm run serve:static` (`tools-debug/bench-harness`); one-liners in
  [`docs/commands.md`](../commands.md). The served dir must be an opensa-pack `--out`.
- **Shader-term probe** — temporarily output a shader term as the fragment colour, shoot headless,
  compare against expectation. Reading the code had pointed at the wrong cause twice in 084.
- **Spot rebake (no full pmb run)** — APFS-clone the build (`cp -Rc build/original build/.x`), rebake
  one model, drop it in with `rewriteModelArchives` (inserts ONLY — a delete of the same name removes
  what you just inserted), serve, shoot, delete the clone.
- **Offline algorithm replica** — when a baked value looks wrong, rebuild the model through the SHARED
  builder in a `.tmp` script and instrument the exact function (per-azimuth traces pinned the 084 AO
  smudges to a scrap-ratio division in minutes; eyeballing histograms had only narrowed the part).
- **Real fixtures over synthetic** — a real GTA asset fixture is ONE manifest line
  (`npm run test:fixtures`); real files falsify what synthetic fakes confirm.
