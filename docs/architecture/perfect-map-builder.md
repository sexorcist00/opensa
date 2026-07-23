# perfect-map-builder

The offline orchestrator (`tools/perfect-map-builder`) that turns a stock GTA SA install + a mods folder into
the **one canonical build** every dev surface reads. `--out` defaults to `./build/original` (git-ignored,
regenerated each reconvert):

```
NODE_OPTIONS=--max-old-space-size=12288 npx tsx tools/perfect-map-builder/src/cli.ts \
  --game ./game-src/original --in ./mods-src
```

Each stage is another tool's Node API; every stage hands the next a **complete game dir**, so the chain can
stop anywhere (`--until <stage>`, inclusive, keeps intermediates). Intermediates live under
`<out>/.work/<n>-<stage>` and are deleted as consumed unless `--keep-work`/`--until`.

![pmb pipeline](./assets/pmb-pipeline.svg)

<details><summary>diagram source</summary>

```mermaid
%%| pmb-pipeline
flowchart TB
  src[("game-src/original<br/>+ mods-src/")]:::data
  mods["mods · mod-installer"]:::stage
  veh["vehicles · vehicle-installer"]:::stage
  peds["peds · ped-installer"]:::stage
  opt["optimize · map-optimizer<br/>normals · prelit · dedupe"]:::stage
  trees["trees · lod-trees-generator<br/>impostor cards + atlas"]:::stage
  proc["procobj · lod-procobj-generator<br/>scatter → static IPL + LODs"]:::stage
  guard{{"guards<br/>int16 30k text rows · 39 IPL slots ·<br/>FLA pools TXD 6000 / COL 275 / IPL 280"}}:::guard
  sa["sa · sa-lod-generator<br/>per-object HD-clone LODs"]:::stage
  oslod["opensa · opensa-lod-generator<br/>cell-LOD bake + linear TXDs"]:::stage
  pack["pack · opensa-pack packGameDir<br/>weld cells · .osm per model · pak"]:::stage
  outsa[("&lt;out&gt;/sa<br/>real-SA build")]:::data
  outos[("&lt;out&gt;/opensa<br/>converted game dir")]:::data
  outpak[("&lt;out&gt;/opensa-pack<br/>world.ospak · manifest · water.bin")]:::data
  fetch["fetch-pack (npm run fetch:pack)<br/>content-hashed zip chunks + manifest"]:::stage
  hosted[("static/games/&lt;game&gt;-&lt;version&gt;/<br/>hosted fetch delivery")]:::data

  src --> mods --> veh --> peds --> opt --> trees --> proc --> guard
  guard --> sa --> outsa
  guard --> oslod --> pack --> outos
  pack --> outpak
  outos --> fetch --> hosted
  outpak --> fetch

  classDef stage fill:#d8f5e0,stroke:#1f9d55,color:#111
  classDef guard fill:#ffe6cc,stroke:#f55c07,color:#111
  classDef data fill:#f5efe1,stroke:#b08900,color:#111
```

</details>

## Stages (`STAGE_NAMES` in `src/pipeline.ts`)

| #   | Stage      | Runs                                          | Notes                                                            |
| --- | ---------- | --------------------------------------------- | ---------------------------------------------------------------- |
| 1   | `mods`     | `installMods` (mod-installer)                 | skipped when `--in`'s `mods/` is empty; overlays + Modloader bake into `gta.dat`/`gta3.img` |
| 2   | `vehicles` | `installVehicles`                             | skipped when `vehicles/` is empty                                |
| 3   | `peds`     | `installPeds`                                 | skipped when `peds/` is empty                                    |
| 4   | `optimize` | `runOptimizer` (map-optimizer)                | lossless conditioning; `broken-prelight.json` force-list         |
| 5   | `trees`    | `buildTreeLods`                               | skipped when `vegetation/` is empty; `--tex` 512 atlas, `prelight.json` |
| 6   | `procobj`  | `buildProcobjLods`                            | always (original ships no `procobj/` — bakes the built-in roster, no-op on a TC); `--tex` 128 |
| —   | guards     | `checkTextIplSlotBudget`, `checkImgIdBudgets` | the SA runtime ceilings — see [edge-cases](../edge-cases/)       |
| 7   | `sa`       | `buildSaLods` → `<out>/sa`                    | the real-game (RenderWare) target                                |
| 8   | `opensa`   | `buildOpensaLods` + `swapLinearTxds`          | cell 256 bake, `stripLods`, linear-convention TXD swap           |
| 9   | `pack`     | `packGameDir` (opensa-pack) → `<out>/opensa`  | the OpenSA target; pak → `<out>/opensa-pack` (086 phase 7); report mirrored to `<out>/report.json` |
| 10  | `lod`      | —                                             | special `--until` value: run everything, keep every intermediate |

Between stages 6 and 7 the pipeline collects generated models + `lod-exclude.json` into `excludeItems` for
both final LOD generators.

## opensa-pack (the `pack` stage, also standalone)

`packGameDir` (`tools/opensa-pack/src/pack.ts`) converts a game-ready dir into the native build. `--out` is a
**copy of the game dir** in which every converted model's `dff`/`txd` inside the IMGs is replaced by one
sectioned `.osm`; the pak products go to the `<out>-pack` **sibling** (`--pak-out` to override — plan 086
phase 7): `world.ospak` (welded cells + the shared world texture dictionary), `manifest.json` (with
`buildTime`), `water.bin`, `report.json`.

- **Weld first, models second** (order-critical): `weld.ts` merges the district into 250-unit render cells
  and produces the shared texture plan; `convertDistrict` then converts model classes
  (vehicles → breakables → clutter → props → anim-objects → peds → map objects). By-name classes keep private
  `TEXS` dictionaries; map objects reference the shared world dictionary
  (see [world-streaming.md](./world-streaming.md)).
- **`TexturePlanner`** (`textures.ts`) resolves `txdp` chains, runs the offline alpha pipeline
  (dilate/premultiply/mips/coverage), passes opaque DXT through untouched, and buckets textures into
  `texture_2d_array`s by exact (format, width, height, mips).
- Bakes: AO/skyVis **on by default** (`--no-ao` to skip — it replaces prod's SSAO); the heavy sun-vis shadow
  bake is opt-in (`--bakes`), and **off** in the pmb pack stage.

Point any host at the BUILD ROOT — the loaders probe the layout (`opensa/` game dir + `opensa-pack/` pak;
legacy nested-pak and raw game dirs still resolve): `?loader=http-dir&src=http://localhost:3001/build/original`
(game), `?src=…/build/original` (lab), `--after ./build/original/opensa` (viewers — a game dir compare).

## fetch-pack (downstream of the `pack` output, plan 086)

`tools/fetch-pack` (`npm run fetch:pack`) consumes `<out>/opensa` + `<out>/opensa-pack` and repacks them
into the hosted fetch delivery: ~50 MB content-hashed zip chunks + `manifest.json` under
`static/games/<game>-<version>/` (identity from the pak manifest's `game`/`appVersion`). One build serves
both surfaces — local play reads `build/<id>` directly, hosted fetch downloads chunks of the SAME bytes.
Not a pmb stage: it runs separately after a build. See [fetch-pack.md](../features/fetch-pack.md) and the
tool's `docs/plans/001-architecture.md`.
