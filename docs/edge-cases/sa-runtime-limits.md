# Real-SA runtime pool ceilings

Limits of the _original_ game engine that the `sa/` build target must respect. The perfect-map-builder
guards them (`tools/perfect-map-builder/src/pipeline.ts`); `asi/perfect-map` lifts the int16 ceiling at
runtime, but the converter guards stand for any build not running that ASI.

- **int16 building-pool → ≤ 30,000 permanent text-IPL rows map-wide.** `CIplStore::IncludeEntity` truncates
  building-pool indexes to int16; past index 32,767 the ranges wrap negative and stream-out corrupts memory
  (the "ghost barriers" bug, bisected to exactly 32,768 rows). pmb caps at 30k (`TEXT_ROW_CAP`) and
  hard-fails **on the built `sa/` tree** (`checkTextIplBudgets`, since 2026-08-08 — an `--exclude sa` run
  never reaches it); `--allow-text-row-overflow` bypasses. Repro dial: `tools-debug/sa-int16-repro`.
- **Per-area 4,000-row budget.** An area's text rows + binary-stream rows pass through SA's unbounded
  4096-slot `LoadScene` buffer; overflow corrupts memory. `AREA_ROW_CAP = 4000`; over-budget instances
  migrate to the shared `plotr`/`plobj` overflow areas. Mirrored in mod-installer's IPL slot merge.
- **Text-IPL slot cap 39** (`IplEntityIndexArrays`; stock uses 30, generators add ~9). At zero headroom any
  modloader text-IPL with inst rows overflows in-game. Only a file carrying `inst` rows takes a slot. **The
  build no longer FAILS on it** (2026-08-08) — it prints what the artifact would cost on a stock install,
  because the target's OLA lifts the array.
- **The per-file 4 000-row budget and the 39-slot cap are STOCK numbers, and the install we target lifts
  both** — OLA's `EntitiesPerIpl`/`EntityIpl` are `unlimited` there, and it runs a 9 627-row IPL without
  complaint. Which set applies is a property of the install, not of the game:
  [`gta-sa-original/reference-install.md`](../gta-sa-original/reference-install.md). Count either with
  `scripts/debug/ipl-row-census.ts`.
- **FLA ID-pool budgets: TXD 6000 / COL 275 / IPL 280** (stock 5000/255/256). Archive-file counts are ID
  slots; exhausting a pool corrupts the heap during data load (crash right after `shopping.dat`). pmb's
  `IMG_ID_BUDGETS` guards the operative FLA ini values.
- **drawDistance ≥ 300 OR a `lod`-prefixed name = "big building" path.** Mass text-IPL instances of
  big-building defs corrupt streaming (ghost-loaded script-gated IPLs). Generated LODs keep draw distance
  below 300 and use non-`lod` aliases (`plo…`).
- **Only one limit adjuster may patch IPL/pool limits** — FLA and OLA active on the same zones crash at
  load.
- **Permanent LOD layers need a Buildings-pool raise** (~15k procobj + ~9.9k tree LOD instances exceed
  stock `CPool<CBuilding>`).
- **IDE id cannot be defined twice.** A baked IDE that redefines a stock id must strip the older definition
  everywhere — duplicate model-info ids corrupt SA's heap during data load.
- **IPL row order is data.** Binary IPL streams reference text rows by index (`lod` columns); removals
  require rebasing every surviving lod-index across text + binary in lockstep.
- **opensa-lod-generator output is for OpenSA only** — uncapped per-cell LODs (hundreds of materials,
  MB-scale models) crash the real-SA streamer.
- **`gta.dat` is loaded top-down — an IDE line must precede the first IPL line that uses its ids.**
  mod-installer appends mod IDE/IPL blocks at the end (self-contained, fine), but a tool injecting new ids
  into STOCK IPLs must insert its IDE before the first `IPL`/`ZON` line (`patchGtaDat` does), or the first
  stock IPL crashes with undefined-id.
- **In-game bisection of pool-exhaustion heap corruption gives FALSE NEGATIVES.** Removing ANY img entry
  reshuffles the heap so the crash lands somewhere silent — a boot that "flips" on ±1 entry with no content
  diff implicates nothing. Suspect a `FILE_TYPE_*` pool first and check/raise the FLA ini before bisecting
  generators (this cost two debugging days once).
