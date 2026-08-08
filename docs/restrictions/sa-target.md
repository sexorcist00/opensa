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

> **The install we actually target lifts two of these.** [reference-install.md](../gta-sa-original/reference-install.md) records
> the declared baseline (`NO_COMMIT/gta_sa`, 2026-08-07): OLA sets `EntitiesPerIpl = unlimited` (the 4 096
> per-file buffer) and `EntityIpl = unlimited` (the 40 slots), and it runs 72 914 permanent rows in files of
> up to 9 627. So the row-count table above is the **stock** budget; costing a plan against it when the
> target has neither ceiling silently under-builds. The one ceiling no adjuster lifts is int16 — that is
> `perfect-map.asi`'s, and at 2.23× the ceiling this install depends on it.

## A ceiling is enforced on the branch whose target has it — never on the shared build

The two facts above cut in opposite directions and both are live:

- `checkImgIdBudgets` reads the built `sa/` tree, so an opensa-only run never runs it — an `sa/` ceiling
  going **unchecked**;
- `checkTextIplSlotBudget` runs on the **common baked build**, before the `sa/`/`opensa/` split
  (`perfect-map-builder/src/pipeline.ts:206`), so an opensa-only run is still refused past
  `TEXT_ROW_CAP = 30 000` and warned at 39 slots — an `sa/` ceiling wrongly **enforced**. Neither number
  reaches an OpenSA code path: our engine reads a pak, and has no building pool, no int16 index and no
  `IplEntityIndexArrays`.

The rule for a new plan: **decide which target a ceiling belongs to, and put its guard on that branch.** A
shared-stage guard is not "safe by default" — it silently rations the target that does not have the limit.
The escape currently in the tree (`--allow-text-row-overflow`) is the shape of the problem, not a fix: an
operator flag is what a missing target split looks like.

**Caught:** no, in both directions, and the enforcement half is the worse one — the build SUCCEEDS. It just
carries a fraction of what the target could hold, which is indistinguishable from success. Owned by
[07/04](../roadmap/0.5.0/plans/07-lod-generators-extended/lod-procobj-generator/04-slot-economy-and-budgets.md).

## In-game bisection of pool exhaustion gives false negatives

Removing ANY img entry can make the symptom disappear without the removed entry being the cause. Diagnose
pool exhaustion by COUNTING against the ini, never by bisecting in the field.

**Caught:** no — and the failure mode is a confident wrong answer.

## Only one limit adjuster may patch IPL/pool limits — but both may be INSTALLED

FLA and OLA patching the same zones crash in `LinkLods`. What the rule forbids is the overlap, not the
coexistence: the [reference install](../gta-sa-original/reference-install.md) runs **both**, and boots,
because FLA's entire `[IPL]` section is disabled and OLA owns those zones alone. So "which adjuster is
installed" is the wrong question — a plan that raises a limit has to name **which adjuster owns that
limit's zone**, and check the other one's ini is not also set for it.

**Caught:** no. And the failure is a boot crash with no attribution, so read both inis before blaming a
build.

## An exe address or expected byte is DECLARED ONCE, in the catalogue — never in the patch

Everything an `.asi` writes into the game is blind: there is no type system on the other side, and a byte that
is wrong by a nibble corrupts a running process. So the address, the expected original bytes and any
continuation the patch resumes at all come from the plugin's typed catalogue through its generated header
(`asi/sdk`, `asi::FindSite` / `asi::VerifySitesOrDefer`). A patch may NAME a site; it may not restate what is
at it. The same rule kills the near-miss shape: a trampoline's continuation must be DERIVED
(`entry + site->length`), because a literal silently desyncs the moment the catalogue's byte window changes.

**Caught:** partly, and only since 2026-08-06. The generator now rejects duplicate site names (a duplicate is
a `FindSite` key collision — the framework would hand a patch the wrong entry's bytes and verification could
not see it, because the site it picked really is pristine), and `asi/perfect-map/gen/generate.test.ts` asserts
that every name the payloads look up still exists in the catalogue and that the catalogue agrees with the
shared fingerprint wherever both name the same site. Nothing catches a hand-written address that merely
disagrees with the catalogue.

Before that it was **silent in the worst available way**: perfect-map's payloads carried seven hand-copied byte
arrays, and three of them — the `RemoveIpl` trampoline continuations — were verified ONLY inside the apply
path, so no dry run in the field could ever see them. The project's own architecture doc claimed "a hand-edited
address is structurally impossible" while the payloads had been doing exactly that since 004. Detail:
[`asi/sdk/docs/plans/004-shared-runtime-apis.md`](../../asi/sdk/docs/plans/004-shared-runtime-apis.md).

## opensa-lod-generator output is for OpenSA only

Uncapped per-cell LODs (hundreds of materials) are not loadable by real SA. The two LOD generators are not
interchangeable, and a plan may not "just reuse" the cell bake for the `sa/` target.

**Caught:** yes in practice — the real game will not load it.

## `gta.dat` is read top-down

An IDE line must precede the first IPL line that uses its ids, and an IDE id may not be defined twice — a
baked IDE redefining a stock id must strip the older definition. Binary IPL streams reference text rows **by
index**, so removing a row renumbers everything after it.

**Caught:** no — wrong or missing objects, no error.
