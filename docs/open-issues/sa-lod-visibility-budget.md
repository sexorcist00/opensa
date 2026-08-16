# Building LODs that never draw on the `sa` build — the data is perfect, so the budget is the suspect

**Status: 🔴 open 2026-08-16, measured but NOT diagnosed.** Field report from the real game (helicopter over
LS): a number of building LODs simply do not appear, while the same models resolve and render in our own
`sa-map-viewer` off the SAME built tree. **Pre-existing** — `laehospital1`'s missing LOD was already in the
2026-08-11 report ([fixed/ipl-row-removal-breaks-lod-links.md](fixed/ipl-row-removal-breaks-lod-links.md))
as one of the two cases the stream-merge fix did NOT explain.

## The three reported cases

| LOD | txd | position | HD |
| --- | --- | --- | --- |
| `LODger01_LAw` | `salod0079` | 801.1, −1618.5, 19.8 | `ger01_law` |
| `LODxhospital1` | `salod0424` | 2050.1, −1401.2, 33.7 | `laehospital1` (a mod's model) |
| `LODIdlewood12` | `salod0433` | 2148.9, −1791.8, 19.1 | — |

## What was ruled out, by reading the built tree

Every one of these checks was run against `build/original/sa`, the tree the field run reads:

- **IPL rows** — identical to stock: same id, same position, `interior 0`, same draw distance. The only
  difference is float64 re-serialisation from the LOD-transform retarget.
- **IDE rows** — identical to stock except the `txd` column, which is the designed repoint to the generated
  per-LOD dictionary (`lod2lae1` → `salod0424`). Ids, draw distances and flags unchanged.
- **Assets** — every `.dff` present in `gta3.img`; every `salod*.txd` present, DXT1, sane sizes; **every
  texture the materials name is in the child dictionary** (no reliance on the `salodpar` txdp parent for
  these three).
- **LOD links** — `assertLodLinks` on the finished tree: 15 648 checked, 0 findings.
- **DFF structure** — the clone's chunk tree matches stock's shape (Clump → FrameList → GeometryList →
  Geometry → Atomic), one atomic, one geometry.

So nothing about these models is malformed. What changed is their COST.

## What our build does to the LOD set, measured

| | stock `game-src/original` | built `sa` | factor |
| --- | --- | --- | --- |
| `lod*` DFF payload | 4 140 files, **34.4 MiB** | 4 326 files, **189.4 MiB** | ×5.5 |
| LOD models over 100 KiB | 2 | **378** | ×189 |
| largest LOD model | 130 KiB | **1 960 KiB** | ×15 |
| LOD **instances** map-wide | 6 086 | **15 631** | ×2.6 |
| LOD instances within 1 500 u of the hospital | 1 807 | **4 527** | ×2.5 |
| … of `ger01_law` | 1 500 | **4 217** | ×2.8 |

Two of our own decisions produce that:

1. **Per-object clone LODs are the HD geometry** (`sa-lod-generator`, plan 002) — `LODxhospital1` is
   481 280 B, byte-for-byte the size of its HD, against stock's 12 288 B. `decimateBudget` rarely fires
   because SA's hand-modelled meshes have little tessellation to collapse.
2. **The tree impostor layer adds ~9 500 LOD entities.** Within 1 500 u of the hospital the top LOD models
   are all vegetation — `lodveg_palm04` ×582, `lodnew_bushsm` ×161, `lodsm_bevhiltree` ×158 … The top twelve
   alone are ~1 674 instances, i.e. the whole stock LOD population of that radius over again.

## The two ceilings that would produce exactly this

Neither is confirmed. Both are recorded so the next round starts from a hypothesis rather than a hunch.

- **`CRenderer::ms_aVisibleLodPtrs` — 1 000 entries in stock.** When the array fills, the LODs scanned after
  it are simply not drawn: no error, no missing asset, and the SAME building loses its LOD every time because
  the scan order is stable. The install's OLA ini sets `VisibleLodPtrs = unlimited`
  ([reference-install-config.md](../gta-sa-original/reference-install-config.md)) — and this project has a
  MEASURED precedent that an OLA `unlimited` can be a no-op: `EntityIpl = unlimited` was set, and the game
  still died on the 40th inst-bearing IPL (2026-08-10, [sa-target.md](../restrictions/sa-target.md)).
- **Streaming / LOD preload.** The install runs `ImprovedStreaming` with `PreLoadLODs = 1` and
  `StreamMemoryForced = 1024`; a 189 MiB LOD payload is 5.5× what that configuration was proven against.

## Both candidates are DEAD — field-tested 2026-08-16, same day

- **Approaching from different distances and headings changes nothing.** The HD swaps in when close; the LOD
  never appears at any range or angle. A visible-pointer overflow depends on how many LODs compete in the
  frustum, so this rules that family out.
- **`PreLoadLODs = 0` did not help.** The preload budget is not it either.

So it is neither of the two ceilings this file was opened on, and it is not the data. What is left is
something the `sa` LOD stage does to these models that SA rejects SILENTLY — a model whose TXD fails to load
is never marked loaded, and an unloaded model is never drawn, which is exactly this symptom.

**A byte-level look at our generated dictionaries against stock's, recorded but NOT yet accused:**

| field | ours (`salod*`) | stock (`lod2lae1`) |
| --- | --- | --- |
| raster format | `0x8300` — EXT_MIPMAP + **4444**, on DXT1 data | `0x0200` — **565** |
| mip levels | 6–7 | **1** |
| mask name | the texture's own name, duplicated | empty |
| shared txdp parent | `salodpar.txd`, **2.76 MB / 1 086 textures** | none |

## The experiments that would separate them, cheapest first

1. ~~Approach from different distances and headings~~ — **run, negative** (see above).
2. ~~`PreLoadLODs = 0`~~ — **run, negative** (see above).
3. **Built and waiting on the field, 2026-08-16:** a `--exclude trees` build (9m 40s) with the impostor layer
   gone — LOD instances 15 631 → 6 174 — and, in the SAME tree, three models reverted to their STOCK LOD by
   hand (`lodxhospital1`, `lodidlewood12`, `lodger01_law`: stock `.dff` written back over the clone in place,
   IDE `txd` column pointed back at `lod2lae1` / `lod_a_law`). One trip, three answers:
   - **only the three reverted LODs return** → the `sa` LOD stage's own output is the cause, and the next
     split is clone-DFF vs `salod*` TXD;
   - **all the missing LODs return** → the impostor layer was crowding them out after all;
   - **nothing returns** → the cause is upstream of the LOD stage entirely (mods or optimize), which would
     exonerate the whole clone/`salod` mechanism in one observation.

## Round 3 (2026-08-16): the impostors are innocent, and ONE revert rendered

Field verdict on the `--exclude trees` + three-reverts build:

- **`LODxhospital1`, reverted to its stock dff + stock atlas, is visible for the first time.** The single
  controlled change that has ever fixed one of these.
- `LODut01_LAwN` (`salod0558`, untouched) also appeared.
- `LODxhospground1` (`salod0424`) and `LOD711block02` (`salod0433`) are still missing — the first sits
  directly under the hospital LOD that now renders.
- **The impostor layer is not the cause**: with all ~9 500 tree LODs gone the missing set is "5–6 objects for
  the whole city, plus or minus the same ones" (his words). That also sets the SCALE — this is a handful of
  models, not a class.

So the `sa` LOD stage's own output breaks a small, specific set. What does NOT separate the broken from the
working, all measured on the built tree:

| candidate | broken | working | verdict |
| --- | --- | --- | --- |
| model size | `lodxhospground1` 98 KiB | `lodut01_lawn` 108 KiB | not it |
| atomics / geometries | 1 / 1 | 1 / 1 (only 10 clones map-wide have ≠1, none of them these) | not it |
| textures resolving | all resolve, 1 via the `salodpar` parent | all resolve, 3 via the parent | not it |
| DXT5 in the model's own textures | `lod711block02` 14 of 24 — but `lodxhospground1` **0** | 0 | not it ALONE |

**One fact worth keeping whatever the cause turns out to be:** stock SA ships **28 786 DXT1 + 2 095 DXT3
textures across 3 978 dictionaries and not a single DXT5**. Our clone dictionaries emit DXT5 for anything with
alpha — 399 of 995 carry at least one. That is outside the range the game's own content occupies, and
`encodeHalvedTxd` should be writing DXT3 for alpha regardless of how this issue resolves.

## Waiting on the field: the DFF/TXD split

The same build now carries a two-way bisect, patched in place (no rebuild), on the two still-missing models:

- **`lodxhospground1` — STOCK dff, our `salod0424` dictionary.** Its stock textures are not in that
  dictionary, so **white = the model loaded** (the dictionary is fine and the clone DFF was the fault);
  **still missing = the dictionary is what fails to load**.
- **`lod711block02` — our clone dff, the STOCK `lod2lae1` atlas.** Same reading, mirrored.

A model whose TXD never loads is never marked loaded, and an unloaded model is never drawn — which is why
"white or absent" is the question that splits the remaining half in one look.
