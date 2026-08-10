# The reference install — what the real game we target actually provides

**Declared the baseline by the user on 2026-08-07.**

**The install the game actually RUNS from is a CrossOver bottle:**
`~/Library/Application Support/CrossOver/Bottles/Win10/drive_c/GTA SA/GTA San Andreas`. `NO_COMMIT/gta_sa` is a
COPY the user uploads for diffing, and it is not what launches — patching a file there changes nothing about the
next run. That cost a wasted launch on 2026-08-10, when an `.asi` probe was swapped into the copy and the crash
that came back was the probe's, from the bottle, still carrying the previous build. Read logs from the bottle;
diff against the copy. Every plan that
adds map placements is designed against THIS, not against unmodded SA 1.0 — and the difference is not
cosmetic: **two of the four ceilings [sa-target.md](../restrictions/sa-target.md) makes a plan budget for do not exist here.**

Read this before costing a map-content plan. Costing one against stock ceilings that the target lifts is how
plan 07 spent a fortnight organised around a limit nobody would have hit.

## What it runs, measured 2026-08-07 off the install itself

| | Value |
| --- | --- |
| Permanent text-IPL `inst` rows, map-wide | **72 914** — **2.23× the int16 ceiling** |
| gta.dat IPL lines / slots carrying `inst` | 52 / **36** |
| Largest single text IPL | **9 627 rows** — **2.35× stock's 4 096 per-file buffer** |
| Map content | ProperFixes 2.2.1 (via modloader) incl. its "Increased Vegetation Distance" optional — 57 583 of those rows in 6 files |

It boots and plays. That is the fact every ceiling below has to be read against.

## The three plugins that decide limits, and how they divide the work

Dozens of `.asi` files are installed; only these three touch the structures a map-content plan cares about,
and **they partition cleanly** — which is what makes the configuration legal under "exactly ONE adjuster may
own IPL limits" ([sa-target.md](../restrictions/sa-target.md)).

| Plugin | Owns | Evidence |
| --- | --- | --- |
| **OLA** (`III.VC.SA.LimitAdjuster.asi`) | the IPL/pool zones | its ini, below |
| **FLA** (`$fastman92limitAdjuster.asi`) | everything else — handling lines, car generators, ID limits, error reporting | **its whole `[IPL]` section is disabled**: 0 active lines in `[IPL]`, while `[HANDLING.CFG LIMITS]` is active and matches `fastman92limitAdjuster.log` |
| **`perfect-map.asi`** (ours) | the int16 `IplDef` truncation + the 2dfx `FxSystem_c` lifetime | `perfect-map-asi.log`, below |

In fastman92's ini format a leading `#` **disables** the setting — confirmed against its own log, where the
uncommented `Number of standard lines = 500` appears and no IPL limit does. So FLA is present and loud, and
touches no IPL limit at all.

Our own log records the whole picture in six lines:

```
[perfect-map] loaded — built Jan  1 1980 00:00:00 (APPLY)
[perfect-map] fingerprint OK — GTA:SA 1.0 US
[perfect-map] adjuster present: fastman92 (FLA)
[perfect-map] adjuster present: LimitAdjuster (OLA)
[perfect-map] int16 APPLIED (buildings): IncludeEntity observed + RemoveIpl snapshot + bounds int32
[perfect-map] fx2dfx APPLIED: FxSystem_c::Stop/Play null-blueprint guarded (2dfx UAF fixed)
```

## The ceilings, stock versus here

`EntitiesPerIpl` and `EntityIpl` are the two OLA growers our own source study named in
[`asi/perfect-map` 004](../../asi/perfect-map/docs/plans/004-limit-patches.md): `EntitiesPerIpl` grows
`gpLoadedBuildings` (0xBCC0E0 @ 0x5B892A) — the per-file `LoadScene` buffer — and `EntityIpl` grows
`IplEntityIndexArrays` (0x8E3F08 @ 0x5B8A36) — the slot array.

| Ceiling | Stock | **Reference install** | Who lifts it |
| --- | --- | --- | --- |
| int16 `IplDef` building indexes | 32 767 rows map-wide | **lifted** (running at 72 914) | **only `perfect-map.asi`** — OLA leaves `0x404B4A` byte-stock |
| `gpLoadedBuildings` per-file buffer | 4 096 rows | **`EntitiesPerIpl = unlimited`** (running a 9 627-row file) | OLA |
| `IplEntityIndexArrays` | 40 slots | **NOT LIFTED — `EntityIpl = unlimited` is set and does not work** | nothing |
| `CPool<CBuilding>` | 13 000 | **`Buildings = 150000`** (raised 2026-08-10 for the clutter layer) | OLA |
| `CPool<CDummy>` | 2 500 | `Dummys = 50000` | OLA |
| Streaming object instances | — | `StreamingObjectInstancesList = 30000` | OLA |

**The consequence for our generators — corrected 2026-08-10, twice by the field.** The per-area row cap and the
slot count are NOT interchangeable:

- **The row cap is genuinely lifted**, and this install proves it by running a 9 627-row text IPL. But that
  proof is for a text IPL with **zero binary streams**; an area's rows and its stream records share the same
  buffer, and 8 520 mixed entries crashed on the first area. Read the number for the path it was measured on.
- **The 40-slot array is NOT lifted at all.** `EntityIpl = unlimited` is set, documents itself as *"Maximum
  number of IPL files that creates entities"*, and the game still dies loading the 40th inst-bearing IPL —
  measured with our `perfect-map.asi` and again with an `-DPM_FIX_INT16=0` probe of it, so nothing of ours is
  the cause. This install never crossed it (36 in use), which is why the setting looked like it worked.
  `checkInstBearingIplSlots` in pmb now fails the build on it.

### The building pool was raised for the permanent-row clutter layer (2026-08-10)

`sa-procobj-placement/014` puts one permanent text row per clutter object, which took map-wide rows
**44 523 → 110 055** (read off the build, not estimated). `Buildings = 100000` could not hold that — pool
exhaustion at load, and the 2026-08-10 `0x005381A5` crash was this pool at exactly 100 000.

**Raised to 150 000 and verified in the live install** (`[SALIMITS]`, ini mtime 15:51). It was checked rather
than assumed: the first attempt at this edit did not reach the file the game reads, and a number written here
above the install's own is silent by construction — it can only fail to warn (the `FILE_TYPE_TXD` lesson, same
day). Headroom over the measured 110 055 is ~36 %, which is what a density rise has to be priced against.

**And the piece only we supply:** OLA raises every pool and array it knows about and still cannot fix int16,
because the truncation is inside the `IplDef` struct rather than in a pool size. At 72 914 rows this install
is 2.23× past that ceiling, so `perfect-map.asi` is not an optimisation here — without it the map corrupts,
which is exactly what the 2026-08-07 A/B showed when `ProperFixes.asi` (its own equivalent patch) was
removed.

## What may and may not be assumed

- **May be assumed** for a plan targeting this install: no per-file row ceiling **for text rows alone** (9 627
  proven), a **150 000**-building pool, and `perfect-map.asi` present for int16.
- **May NOT be assumed here either, despite the ini saying so:** the 40-slot `IplEntityIndexArrays`. It is real
  on this install.
- **May NOT be assumed** for the stock target, which still has all four. A build that ships raised density
  must either keep the stock guards for the stock target or state plainly that it requires the adjusters.
- **May not be assumed to be stable.** This is one user's install, recorded on one day. `NO_COMMIT/gta_sa`
  is the copy to diff against when a symptom does not reproduce; re-read the two ini files before trusting
  any row of the table above.

**Caught:** partly. pmb's guards catch a stock-target violation loudly. Nothing catches the opposite mistake
— designing down to a ceiling this install does not have — and that one is silent by nature, because the
result is a build that works and simply carries less than it could.

## The trap in reading the log

The banner reads `built Jan 1 1980 00:00:00` on every build. That is our own reproducibility pinning
(`SOURCE_DATE_EPOCH` + `--no-insert-timestamp`, required for a byte-identical `.asi` A/B) doing its job, and
it means **the banner can no longer tell you which build loaded** — the one thing the recorded procedure says
to check first. Identify the file by hash or by an intentional log line, never by its timestamp.
