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

## The experiments that would separate them, cheapest first

1. **No rebuild:** approach the missing LOD from different distances and headings. A visible-pointer overflow
   depends on how many LODs are in the frustum, so the LOD should appear when fewer compete; a per-model
   failure never appears. **This one test splits the two families.**
2. **One ini line:** `PreLoadLODs = 0` in `ImprovedStreaming.ini`. If the LODs come back, it is the preload
   budget rather than the render array.
3. **One build (~11 min):** `--exclude trees`. If the building LODs return with the impostor layer gone, the
   ~9 500 vegetation LOD entities are what crowd them out, and the fix is a density/grouping decision rather
   than a limit lift.

## If it is the array

We already lift a SA ceiling nobody else reaches — the int16 `IplDef` in `asi/perfect-map` — and
`ms_aVisibleLodPtrs` is the same kind of static array. Lifting it there is the honest fix; reducing the
impostor entity count (fewer, bigger cards) and decimating the clone LODs are the levers that cost nothing at
runtime. **None of that is worth building until experiment 1 says which family it is.**
