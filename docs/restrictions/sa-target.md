# Real-SA target restrictions

The `sa/` target runs inside a 2004 engine with fixed pools and no bounds checks. **Any plan that adds map
placements, archive entries or IPL files has to be budgeted against these ceilings before it is written** —
not because the build might fail, but because it might NOT fail and corrupt the heap instead.

The measured numbers live in [`edge-cases/sa-runtime-limits.md`](../edge-cases/sa-runtime-limits.md) and
[`edge-cases/sa-formats.md`](../edge-cases/sa-formats.md). This page is the planning gate over them.

## Budget first: the four ceilings a content plan can hit

| Ceiling | Value | What overflowing does |
| --- | --- | --- |
| Permanent text-IPL rows, map-wide | **30,000** | `CIplStore::IncludeEntity` truncates building-pool indexes to int16; past ~32.7k it corrupts stream-out ranges (the "ghost barriers" family) |
| Text IPLs carrying `inst` rows | **39 slots** | `IplEntityIndexArrays` is written past without a bounds check |
| FLA ID pools | TXD 6000 / COL 275 / IPL 280 | heap corruption during data load — the crash lands right after `shopping.dat` |
| Model id | **≤ 18630** | silently fails to load; "HD swapped but nothing changed" |

The first three are **checked by the pmb build** (`checkTextIplSlotBudget`, `checkImgIdBudgets`) — but
`checkImgIdBudgets` reads the built `sa/` tree, so **an `--exclude sa` run never runs it.** An opensa-only
build cannot tell you that you blew the real game's pools.

**Caught:** on a `:sa` build, yes, loudly. On a `:opensa` build, no — and that is now the common case.

## In-game bisection of pool exhaustion gives false negatives

Removing ANY img entry can make the symptom disappear without the removed entry being the cause. Diagnose
pool exhaustion by COUNTING against the ini, never by bisecting in the field.

**Caught:** no — and the failure mode is a confident wrong answer.

## Only one limit adjuster may patch IPL/pool limits

FLA and OLA active on the same zones crash. A plan that raises a limit picks one adjuster and says which.

**Caught:** no.

## opensa-lod-generator output is for OpenSA only

Uncapped per-cell LODs (hundreds of materials) are not loadable by real SA. The two LOD generators are not
interchangeable, and a plan may not "just reuse" the cell bake for the `sa/` target.

**Caught:** yes in practice — the real game will not load it.

## `gta.dat` is read top-down

An IDE line must precede the first IPL line that uses its ids, and an IDE id may not be defined twice — a
baked IDE redefining a stock id must strip the older definition. Binary IPL streams reference text rows **by
index**, so removing a row renumbers everything after it.

**Caught:** no — wrong or missing objects, no error.
