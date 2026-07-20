# @opensa/lod-procobj-generator

Convert **GTA-SA procobj scatter species** (bushes, rocks, scrub, joshua…) into **static IPL instances with
simplified-copy LODs** — a decimated low-poly mesh, not a billboard impostor (that's
[`lod-trees-generator`](../lod-trees-generator/)). The companion to it for the procobj clutter the impostor tool
deliberately leaves alone.

```sh
tsx tools/lod-procobj-generator/src/cli.ts --out <path> --game <path> [--in <dir>]
```

- `--in` — optional folder of HD procobj models (`<model>.dff` + `<model>.txd`), intersected with `procobj.dat` to
  pick the species. **Omit it to convert every `procobj.dat` species straight from the game's own `gta3.img`** (no
  model/texture swap). With `--in`, the LOD mesh decimates the **pack's DFF** (the model the HD is swapped to —
  decimating the stock model instead showed a different plant at LOD range) and LOD textures downscale from its
  TXDs, falling back to the stock game TXD. A path that does not exist, or a directory holding no `.dff`, means
  the same as omitting the flag: the library logs a line and converts every species. That tolerance is for
  callers that pass the folder unconditionally (perfect-map-builder passes `<mods-src>/procobj` either way) —
  an `--in` typed EXPLICITLY on the CLI is still validated, so a typo is loud.
- `--out` — output drop-in directory
- `--game` — game data (`gta.dat` + `data/` + `models/gta3.img`)
- `--tris` — QEM target triangles per LOD model (default `200`)
- `--tex` — LOD texture max size px (default `64`)
- `--draw` — LOD draw distance (default `290`). **Keep it below 300**, and note the emitted aliases are
  deliberately NOT `lod`-prefixed (`plo…`): SA classifies defs as big buildings/LODs by **either** trigger —
  drawDistance ≥ 300 (FLA's "LOD distance") **or a model name starting with `lod`** — and MASS text-IPL
  instances of big-building defs corrupt that path (script-gated IPLs — the barriers2 roadblocks — got
  ghost-loaded on any save; verified by in-game bisection: 30k instances of a stock lod def reproduce it,
  30k ordinary defs are fine).
- `--max` — cap on converted procobj objects (default `20000`, `0` disables)
- `--height` — optional min HD height (m) gate, drops short clutter (default `0` = off)
- `--prelight [info.json]` — copy each model's **stock** trunk prelight (day ambient) onto its decimated LOD mesh
  (and the swapped HD DFF when `--in`) so the simplified copy isn't black/washed-out next to stock geometry.
  Applied **trunk-only** (opaque surfaces; foliage — alpha-cutout — keeps its own prelit). Optionally pass a JSON
  of per-model overrides — `--prelight ./info.json` with `{ "cedar1_po": { "skip": true }, … }` opts those models
  **out** (LOD keeps its source prelit; HD packed verbatim). Bare `--prelight` applies to every model. Shared with
  `lod-trees-generator` via [`@opensa/sa-lod/prelight`](../sa-lod/src/prelight.ts).
- `--modloader` — emit **two** independent **Modloader mods** (real game) under `<out>`, so **no stock IDE is
  rewritten**:
  - **`<out>/lod/`** — the LODs: LOD DFFs + `lod_procobj.txd`/`.col` in `gta3img/` (injected into `gta3.img` by
    name; col auto-discovered), the new static IPL + stripped `procobj.dat` at their `data/` paths, and a
    `loader.txt` (`IDE` + `IPL`).
  - **`<out>/hd/`** — the swapped (prelit) `--in` procobj HD models + the custom TXD in `gta3img/`, plus a `txdp`
    IDE (`lod_procobj_hd.ide`) that **parents** each swapped model's stock TXD to the custom one — so the custom
    textures resolve without rewriting the stock IDE (the same approach as `lod-trees-generator`). Omitted with no
    `--in`.

  Without `--modloader`, repacks one `<out>/models/gta3.img` + patches `data/gta.dat` with the `--in` HD swap
  inlined. See [`docs/plans/004-modloader-output.md`](./docs/plans/004-modloader-output.md).

## What it does

Per converted species (every `procobj.dat` species, or the subset shipped in `--in`): build a model-local mesh
(frame-aware), **QEM-decimate** it, re-derive smooth normals, and encode a low-poly DFF. Textures resolve
through each species' **own IDE TXD** and land in the shared `lod_procobj.txd` under **scoped names**
(`<txd>_<name>` — SA reuses names across TXDs with different pixels; see lod-common plan 004). Then it reuses the engine's
vanilla procobj scatter to place each species as **static instances** (HD instance → its LOD, thinned by MINDIST

- a cap), strips those species from `procobj.dat`, swaps their HD DFF for the `--in` model (only when `--in` is
  given), and packs a drop-in `gta3.img` + `data/` files. The LODs share one `lod_procobj.txd` + `lod_procobj.col`,
  registered via `lod_procobj.ide` + a patched `gta.dat`. The never-touch `UNDERWATER_PROCOBJ` species
  (seaweed/starfish/searock) are skipped.

The placement ships **vanilla-style as binary IPL streams** (plan 007): per spatial area (≤1900 pairs, median
split) a small text `plobj<i>.ipl` holds the permanent LOD layer, and binary `plobj<i>_stream<k>.ipl` tiles
(≤512 inst, inside `gta3.img`; the short `plobj` base keeps names under IMG VER2's 23-byte cap) hold the HD
layer with `lod` fields indexing the area's text rows. NEVER emit the placement as one big text IPL: SA's `LoadScene` pushes every
text inst row through an unbounded 4096-slot static buffer, and overflowing it corrupts memory (the
"ghost barriers" bug — see plan 007 for the full post-mortem). A `lod_procobj.models` manifest lists the
converted species for downstream generators. Note the LOD layer is ~15k permanent buildings: the game needs
a `Buildings` pool raise (FLA `[IPL] Buildings` or OLA `Buildings`) — and only ONE limit adjuster may patch
the IPL limits (FLA+OLA both active on those zones crash at load).

`lod_procobj.txd` ships in the real-SA **gamma** convention; a **linear**-convention copy is written to
`<out>/linear-txd/` for the pmb opensa split (texel colour math must match the target renderer — see
lod-trees plan 012).

A shared `--in` TXD is **trimmed** to just the textures the swapped procobj models use (via
`@opensa/map-placement/retxd`), so a vegetation pack's tree/non-procobj textures don't bloat the output.
`--prelight` optionally corrects the swapped HD + decimated LOD's trunk prelight from the stock model (see above).

[`UNDERWATER_PROCOBJ`](../map-placement/src/procobj-strip.ts) species (seaweed/starfish/searock) are **never**
converted.

## Architecture

A thin orchestrator over two shared packages. Plans: [`001` architecture](./docs/plans/001-architecture.md) ·
[`002` build pipeline](./docs/plans/002-build-pipeline.md) · [`003` SA asset format](./docs/plans/003-sa-asset-format.md).

- **[`@opensa/sa-lod`](../sa-lod/)** — the simplified-copy LOD pipeline (decimate → normals → encode DFF/TXD/COL),
  shared with [`opensa-lod-generator`](../opensa-lod-generator/).
- **[`@opensa/map-placement`](../map-placement/)** — SA map-edit workflows (procobj scatter → static IPL, id
  allocation, IDE/gta.dat edits, swapped-HD retexture), shared with `lod-trees-generator`.
