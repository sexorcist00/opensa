# Reference install — the captured configuration

The **verbatim record** of the declared baseline install, taken 2026-08-07 from `NO_COMMIT/gta_sa`. It exists
because that copy is temporary: **this file is what survives when it is deleted.** What the configuration
MEANS for our plans is [reference-install.md](reference-install.md); this page is the evidence under it.

Nothing here is summarised or normalised. If a future symptom does not reproduce, diff the install against
this page first.

## Executable

| | |
| --- | --- |
| Size | **14 383 616 bytes** |
| SHA-1 | `8c23ceffafa9fd88ea567be7926a33413b8e3c00` |
| SHA-256 | `f01a00ce950fa40ca1ed59df0e789848c6edcf6405456274965885d0929343ac` |

This is **the one exe `asi/perfect-map` accepts** — GTA:SA 1.0 US, HOODLUM-relocated. Its fingerprint check
passes on it (`fingerprint OK — GTA:SA 1.0 US`), and any other build is refused rather than guessed at.

## Plugins loaded (root `.asi`)

```
$fastman92limitAdjuster.asi   CLEO.asi              CrashInfo.SA.asi     FirstPersonModFix.asi
GFXHack.asi                   Hooks.asi             ImprovedStreaming.SA.asi
III.VC.SA.LimitAdjuster.asi   MixSets.asi           PedFuncs.asi         RealSkybox.SA.asi
SanViveMemoryFix.asi          StarrySkies.asi       VehDeform.SA.asi     VehFuncs.asi
_noDEP.asi                    gsx.asi               imfast.asi           modloader.asi
perfect-map.asi               skygfx.asi            skygrad.asi
```

Also present as loaders/support: `DllTricks.dll`, `GTAINTERFACE.dll`, `MinHook.x86.dll`, `bass.dll`,
`libcurl.dll`, `libsquish.dll`, `zlib1.dll`, `vorbisHooked.dll`.

Of these, only three touch anything a map-content plan budgets against: **OLA**
(`III.VC.SA.LimitAdjuster.asi`), **FLA** (`$fastman92limitAdjuster.asi`) and **ours** (`perfect-map.asi`).

## `perfect-map-asi.log`, verbatim

```
[perfect-map] loaded — built Jan  1 1980 00:00:00 (APPLY)
[perfect-map] fingerprint OK — GTA:SA 1.0 US
[perfect-map] adjuster present: fastman92 (FLA)
[perfect-map] adjuster present: LimitAdjuster (OLA)
[perfect-map] int16 APPLIED (buildings): IncludeEntity observed + RemoveIpl snapshot + bounds int32
[perfect-map] fx2dfx APPLIED: FxSystem_c::Stop/Play null-blueprint guarded (2dfx UAF fixed)
```

Both patches **APPLIED** (not deferred, not verify-only) with **both** adjusters detected. The `Jan 1 1980`
timestamp is our own `SOURCE_DATE_EPOCH` pinning, not a stale build — see the trap noted in
[reference-install.md](reference-install.md).

## OLA — `III.VC.SA.LimitAdjuster.ini`, `[SALIMITS]` verbatim

The section that matters, complete and unedited. **`EntitiesPerIpl` and `EntityIpl` are the two lines that
change what our generators may emit.**

```ini
PtrNodeSingle = unlimited
PtrNodeDouble = unlimited
EntryInfoNode = unlimited
ExtraObjectsDir = 512
Peds = 140
PedIntelligence = 140
Vehicles = 110
Buildings = 100000
Objects = 10000
Dummys = 50000
ColModel = unlimited
Task = unlimited
Event = unlimited
PointRoute = unlimited
PatrolRoute = unlimited
NodeRoute = unlimited
TaskAllocator = unlimited
PedAttractors = unlimited
VehicleStructs = unlimited
MatrixList = unlimited
OutsideWorldWaterBlocks = 500
AlphaEntityList = unlimited
VisibleEntityPtrs = unlimited
VisibleLodPtrs = unlimited
StreamingObjectInstancesList = 30000
AtomicModels = unlimited
DamageAtomicModels = unlimited
TimeModels = unlimited
ClumpModels = unlimited
VehicleModels = unlimited
PedModels = unlimited
WeaponModels = unlimited
EntitiesPerIpl = unlimited
EntityIpl = unlimited
StaticShadows = 2048
Coronas = 20000
ScriptSearchLights = 1024
MemoryAvailable = 30%
```

`EntitiesPerIpl` grows `gpLoadedBuildings` (0xBCC0E0 @ 0x5B892A) — the 4 096-slot per-file `LoadScene`
buffer. `EntityIpl` grows `IplEntityIndexArrays` (0x8E3F08 @ 0x5B8A36) — the 40-slot array. Both addresses
come from our own OLA source study in
[`asi/perfect-map` 004](../../asi/perfect-map/docs/plans/004-limit-patches.md).

## FLA — `fastman92limitAdjuster_GTASA.ini`

**Its entire `[IPL]` section is disabled — 0 active lines.** In fastman92's ini format a leading `#` disables
the setting; every IPL entry carries one, at stock values:

```ini
[IPL]
#Buildings = 13000
#Dummies = 2500
#Inst entries per file = 4096
#Entity index array = 40
#Map zones = 39
...
```

That is why FLA and OLA coexist here without the documented `LinkLods` boot crash: **OLA owns the IPL zones
alone.** The `#` reading is confirmed against FLA's own log, which reports exactly the settings that are
uncommented and no IPL limit at all.

Everything FLA actually applies — **captured before the 2026-08-10 pool raise below; the two `FILE_TYPE_`
lines here are the OLD values**:

```ini
Accept any ID for car generator = 1
Apply ID limit patch = 1
FILE_TYPE_COL = 275
FILE_TYPE_IPL = 280
Count of killable model IDs = 20000
Apply handling.cfg patch = 1
Number of standard lines = 500
Number of bike lines = 50
Make paintjobs work for any ID = 1
Enable error reporting = 1
  Attempt to load object instance with undefined ID = 1
  Car generator with invalid model ID is getting registered = 1
  IMG archive needs rebuilding = 1
  Model does not have collision loaded = 1
  Stream handles limit exceeded = 1
Enable vehicle audio loader = 1
Enable train type carriages loader = 1
Enable model special feature loader = 1
Register global exception handler = 0
```

`fastman92limitAdjuster.log` closes with `Number of memory changes made: 3712`.

### The ID pools — read them off FLA's LOG, not off the ini

The ini is a request; the log is what FLA built. It prints the pools as ID RANGES, laid out consecutively, so
raising one shifts every pool after it:

```
New ID limits:
    0 - 19999 (20000) - DFF models defined within IDE files
20000 - 24999  (5000) - TXD texture archives.
25000 - 25274   (275) - COL collision archives.
25275 - 25554   (280) - IPL Binary IPL files.
25555 - 25618    (64) - DAT files limited to nodes*.dat
25619 - 25798   (180) - IFP animation archives.
25799 - 26273   (475) - RRR car recordings, carrec*.rrr files
26274 - 26355    (82) - SCM scripts
```

**`TXD` is 5000, and this document used to say 6000.** `FILE_TYPE_TXD` carries a `#` in the ini above — it is
one of the DISABLED lines — so the pool stays at FLA's default, which the log confirms. pmb's
`IMG_ID_BUDGETS` claimed 6000 from the start and nothing ever checked it against the install, so a build
measuring **4999 TXD archives** printed `4999 of 6000` while standing one archive short of a real wall. The
error is the kind this folder exists to prevent: a guard whose number is HIGHER than the install's is silent
by construction — it can only ever fail to fire.

**Changed 2026-08-10 — three pools raised**, after the first `sa` build at the recovered procobj density
(91 092 objects) exceeded the IPL pool with **522 binary IPL files of 280**. The layer's `plobj*_stream*`
tiles went 50 → 331 across the column fix; 191 more are stock's own. Per the target rule in `CLAUDE.md` an
FLA pool is a configured number, so it is raised rather than designed down to:

| Pool | Was | Now | Build uses | Why this value |
| --- | --- | --- | --- | --- |
| `FILE_TYPE_TXD` | 5000 (line disabled — FLA's default) | **6000** | 4999 | the line must be UNCOMMENTED; 4999 + the guard's 50-slot runtime margin does not fit 5000 |
| `FILE_TYPE_COL` | 275 | **400** | 264 | 264 + margin 8 left 3 slots — raised while the file was open, not because it bound |
| `FILE_TYPE_IPL` | 280 | **1024** | 522 | ~2× headroom over the density that broke it, so the next density change does not re-open this |

Both `COL` and `IPL` are already past 256, which is what makes FLA apply its `uint32_t` ID patches (its log
says so for each). `TxdStore` is not set in `[SALIMITS]`.

**The ini is SET** (confirmed by the user 2026-08-10, verbatim — `FILE_TYPE_TXD = 6000`, `FILE_TYPE_COL = 400`,
`FILE_TYPE_IPL = 1024`, the TXD line now uncommented). **The LOG is not re-captured**: FLA rewrites
`fastman92limitAdjuster.log` at boot, so the ranges printed above are still the old ones and nothing has yet
proven FLA accepts these values. Re-capture the `New ID limits:` block after the next launch — that, not the
ini, is what this section is read off.

## Streaming

`ImprovedStreaming.ini`:

```ini
StreamMemoryForced = 1024
DoubleStreamingMemoryLimit = 0
MaxRAM = 3200
PreLoadLODs = 1
PreLoadAnims = 0
RemoveUnusedWhenPercent = 90
RemoveUnusedIntervalMs = 120
```

`stream.ini`: `memory 13500`, `devkit_memory 13500`, `vehicles 12`.

`PreLoadLODs = 1` is worth remembering before any LOD-density measurement on this install — LODs are
pre-loaded rather than streamed on demand, so a naive "streaming smoothness" reading will not mean what it
means on a stock configuration.

## Map content installed (modloader)

| Folder | What it is |
| --- | --- |
| `Proper Fixes` | ProperFixes 2.2.1 — Map, Misc, SA Optimized Map, Additional Models/Textures, PS2 Grass, LOD Vegetation, Race maps, its own `cuts.img`/`cutscene.img`, **and `Increased Vegetation Distance`** (the 6 procobj IPLs, 57 583 rows) |
| `_ESSENTIALS` | SilentPatch, Widescreen Fix (ThirteenAG), FramerateVigilante, RepairGTA, RunDLL32 Fix |
| `Graphic` | Enhanced Classic Graphics — Improved 2DFX |
| `Car Addons` | Epoxi Wheel Pack, fm3_wheels |
| `Model_Variations` | ModelVariations.asi + peds/vehicles/weapons inis |
| `timecyc24h` | timecyc24h.asi + .dat |
| `RZL-Skin` | (empty) |

**`Graphic/Enhanced Classic Graphics - Improved 2DFX` is worth flagging**: it edits 2dfx, which is the
subject of half of plan 07. Any 2dfx observation made on this install is an observation about THAT mod's
2dfx, not Rockstar's — check it before treating a lamp or corona here as stock behaviour.

## CLEO

`CLEO.asi` plus `CLEO+.cleo`, `FileSystemOperations.cleo`, `IniFiles.cleo`, `IntOperations.cleo`, and five
`.cs` scripts: `TweaksSAv140.cs`, `reload_TweaksSA.cs`, `RZL-Trainer.cs`,
`Enhance ParticleTXD (Junior_Djjr).cs`, `Simple Free Camera (Junior_Djjr).cs`.

## What the install actually runs, counted

Measured off its own `data/` + `modloader/` on 2026-08-07 by
`npx tsx scripts/debug/ipl-row-census.ts NO_COMMIT/gta_sa` — gta.dat IPL lines resolved through modloader
overrides, then modloader `loader.txt` additions on top. **Re-runnable against any install or built tree**,
which is the point: these numbers were first taken by hand and the hand count was wrong by one slot.

| | Value |
| --- | --- |
| gta.dat IPL lines | 52 |
| Rows from gta.dat IPLs | 15 331, in 30 slots carrying `inst` |
| Rows added by modloader | 57 583, in 6 slots (`procobj1..6.ipl`; `properfixes.ipl` carries no `inst` rows, so it takes no slot) |
| **Permanent text `inst` rows, map-wide** | **72 914** — 2.23× the 32 767 int16 ceiling |
| **IPL slots carrying `inst`** | **36** — under the stock 40, so `EntityIpl = unlimited` is not exercised |
| **Largest single text IPL** | **9 627 rows** — 2.35× stock's 4 096 per-file buffer, allowed by `EntitiesPerIpl = unlimited` |
