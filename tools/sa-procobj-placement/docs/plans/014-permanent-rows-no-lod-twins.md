# 014 — procobj without LOD twins: permanent rows on `sa`, runtime scatter on `opensa`

**Status: 🔴 in progress (2026-08-10).** The user's call, and the measurements behind it are in
[`map-placement/002`](../../../map-placement/docs/plans/002-ipl-slot-budget.md): the HD+LOD twin per clutter
object was the wrong shape from the start, and at the shipped density **it cannot fit SA at all**.

Supersedes the shape 007 built (binary streams) and retires `linkedHeight`'s job from 010/013.

## Why the current shape is not fixable by packing

A linked pair costs **2 entries** through SA's per-area boot buffer (one permanent text row + one HD stream
record), and both of the ceilings it meets are real:

| constraint | value | evidence |
| --- | --- | --- |
| entries per area (`gpLoadedBuildings`, text rows + its streams together) | **≤ ~4 096** | 4 000 shipped for a year; **8 520 crashed on the first area** (2026-08-10, `plobj0`) |
| inst-bearing text IPLs, map-wide | **≤ 40** (`IplEntityIndexArrays`) | the game died on slot 40; OLA's `EntityIpl = unlimited` does not lift it, measured with and without our own asi |
| slots left for our layer | **12** | 28 are stock |

25 560 linked pairs ÷ 2 048 pairs per area = **13 areas** against **12** available. Off by one, with no lever:
raising the per-area cap overflows the boot buffer (measured), and lowering it needs more areas than exist.

**And the twins buy almost nothing.** A generated LOD for a hand-modelled SA bush recovers ~**0.2 %** of its
geometry (the decimation measurement), while costing a whole entity — 182 184 entities for 91 092 objects.

## Why streams cannot deliver the range either

`CIplStore` loads an IPL slot only while the player is inside its bounding box grown by **190 units**
(`if (!def->bb.IsPointInside(posn, -190.f) || CStreaming::IsModelLoaded(...)) continue;` —
`gta-reversed-modern/source/game_sa/IplStore.cpp`). Our stream tiles hold 512 instances, so their boxes are
small and that gate binds long before any draw distance: **the layer's clutter cannot draw past ~190 m today, no
matter what the IDE says.** SA's own runtime procobj scatter draws at ~50 m, which is the problem this layer
exists to solve.

A permanent row has no such gate. That is why ProperFixes puts its whole 57 583-row vegetation layer in **6 text
IPLs, every row `lod = -1`, draw distance 299 from its own `data/maps/generic/procobj.ide`** — one metre under
the 300 threshold that puts an object on SA's big-building path.

## The design

**`sa` — bake the clutter as permanent rows, PF's shape.** One entity per object, `lod = -1`, no binary streams
for this layer, range from a re-declared IDE row.

| | now | after |
| --- | --- | --- |
| entities for 91 092 objects | 182 184 | **91 092** |
| permanent text rows (layer) | 25 560 | **91 092** |
| entries per area | ~8 520 (text + streams) | **~9 100, text only** — the path PF proves at 9 627 |
| inst-bearing areas (layer) | 6, and it still crashed | **~10 of the 12 available** |
| binary IPL files (layer) | 511 | **0** — frees the whole FLA IPL pool |
| draw distance | ~190 m (the stream gate) | **299 m** |

**The lift this leans on is the same one PF exercises, this time on the same path.** That distinction is the
whole point: 002 failed because it read PF's 9 627 (text-only) as a budget for text + streams together.

**`opensa` — drop the stage.** Our engine sets draw distance from settings, has no building pool, no int16 index
and no slot array, so a build-time bake buys nothing here and costs plenty: `convertProcObj` STRIPS the baked
species from `procobj.dat`, which is why the shipped runtime scatter is down to **9 rules of 96, all underwater**,
and why clutter density stopped being measurable in the field (013/P1 had to invent a two-pak workaround). With
the stage gone the runtime scatter gets all 96 rules back and density becomes a runtime knob again.

It also stops welding: the pak duplicates vertices **per instance**, so 91 092 baked objects are 91 092 copies of
geometry (against 105 815 501 HD vertices total and a 1.01-billion-ray AO bake). The runtime path uploads one
geometry per model type — ~48 of them — and draws instanced.

## What this costs, stated up front

- **`Buildings = 100000` will not hold.** Map-wide permanent rows go 44 523 → ~110 000. It is a number in OLA's
  ini (`[SALIMITS]`), so it is raised, not designed around — but the build cannot do it, so it is an INSTALL
  prerequisite and goes in `docs/gta-sa-original/`.
- **Baked AO is lost on `opensa` clutter.** `ao.ts` bakes 12 hemisphere rays per HD vertex (60 u max); runtime
  clutter is built through the vehicle-model path and drawn instanced, so it has nowhere to keep a per-instance
  value. Prelight is NOT lost (it lives in the stock DFFs and is identical either way). What goes is contact
  darkening under trees and against walls.
- **The cross-target placement parity check narrows.** 2026-08-10 pinned "both targets are the same world" at
  182 184/182 184 placements with a test + `scripts/debug/pak-placement-parity.ts`. With clutter runtime-only on
  `opensa`, that check covers stock + mods + trees. It has to be re-scoped deliberately, not deleted.
- **`sa-procobj-placement` stops generating LODs.** No decimation, no LOD id allocation, no retxd for these
  species; the tool becomes a baker and its name starts to lie. Rename is churn — deferred, recorded here.
- **A scope call reverses.** Density stops being "one profile, both hosts" (2026-08-09): on `opensa` it becomes
  a runtime setting, on `sa` a build constant. Deliberate, not a side effect.

## Steps

1. **`buildPermanentAreas` in map-placement** — placements → text IPLs only, every row `lod = -1`, no streams,
   split under a row cap sized on PF's measured 9 627. Reports its inst-bearing file count for the gate.
2. **`convertProcObj` emits permanent rows** — drop the pair/`linkedHeight` path for this layer; re-declare the
   species' IDE rows at the configured draw distance (299 default, PF's proven number).
3. **pmb: the procobj bake moves into the `sa` branch**, after `buildSaLods` and before the census + gate, so
   the common build (and therefore `opensa`) never carries it and `procobj.dat` reaches our engine unstripped.
4. **Build `sa`, count rows/areas/slots on the artifact**, then the field run: does it boot, and does clutter
   now reach ~299 m instead of ~190.
5. **`opensa`: confirm the runtime scatter gets 96 rules**, and expose the draw distance as a setting.
6. **Per-category draw distance** — 299 flat is PF's compromise, and we would ship 91 092 objects against their
   57 583 (1.6×). The IDE distance is per model, so grass can be nearer than rocks. **Measured, not assumed** —
   this step exists only if step 4 shows a cost worth paying for.

## Measured numbers

**Steps 1–4 (build half) done 2026-08-10.** Same corpus, same density 1, read off the artifact:

| | before | after |
| --- | --- | --- |
| objects | 91 092 | 91 092 (unchanged — the shape changed, not the content) |
| permanent text rows, layer | 25 560 | **91 092** · rows/object 0.281 → **1.000** |
| permanent text rows, map-wide | 44 523 | **110 055** |
| entities for those objects | 182 184 | **91 092** — the twin is gone |
| inst-bearing area IPLs, layer | 47, then 6 | **10** |
| inst-bearing IPLs, map-wide | 75 (crashed on slot 40) → 35 | **39 of 40** |
| binary IPL files | 522 → 511 | **191** — every stream tile of this layer gone (only `plotr0_stream0`, the trees layer's, remains) |
| FLA TXD / COL slots | 4999 / 264 | **4998 / 263** — `lod_procobj.txd`/`.col` no longer exist |
| `procobj.dat` rules reaching `opensa` | 9 of 96 (stripped) | **95** — the common build is untouched |
| `procobj.dat` rules in `sa/` | — | **8**, the never-touch underwater set |
| species raised to 299 in `procobj.ide` | — | **39** of 107 (only the ones actually placed; the rest keep stock 59 for the runtime scatter) |
| procobj stage | 5.7 s | **3.2 s** — nothing is decimated |
| build wall clock | 9 m 53 s | **9 m 49 s** |

`Buildings` was raised 100 000 → **150 000** and verified in the live install for the 110 055 rows
(`docs/gta-sa-original/reference-install.md`). Headroom ~36 %, which is what a density rise prices against.

### A defect this introduced, found on the artifact

The bake runs in place and `sa/` is not wiped between runs, so the first build left **46 area files on disk for
10 registered areas** — 36 orphans from earlier runs, 4 492 rows. Unregistered, so the game never reads them,
but a census over the directory then read **95 584 rows for a 91 092-row run**, and that is the kind of number
that gets published. `removeStaleAreas` deletes `<areaBase><n>.ipl` files the run did not write, the count is
reported in the cost line rather than done silently, and the artifact now reads 10 files / 10 registered /
91 092 rows.

Also learnt: **the in-place bake consumes its own input** — the first run strips the converted species out of
`procobj.dat`, so a second run on the same tree finds only the underwater set. Harmless (it returns before
writing anything) but it used to report "no species", which reads like a missing `--in`; it now names the cause.

## Still open

- **Step 5** — confirm on the `opensa` side that the runtime scatter takes all 95 rules, and expose the draw
  distance as a setting. The build half is done: the common build's `procobj.dat` is no longer stripped.
- **Step 6** — per-category draw distance. 299 flat is PF's compromise at 57 583 rows; we ship 91 092 (1.6×), so
  58 638 bushes now draw to 299 m. Measure before tuning.
- **The field run.** Does it boot at 39 slots, and does the clutter reach 299 m instead of ~190?
- **AO on `opensa` clutter** — the runtime path has nowhere to keep a per-instance value. Prelight is unaffected.
- **The cross-target placement parity check** (`scripts/debug/pak-placement-parity.ts` + its test) still assumes
  both targets carry the same clutter. It has to be re-scoped deliberately.
