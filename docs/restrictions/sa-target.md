# Real-SA target restrictions

The `sa/` target runs inside a 2004 engine with fixed pools and no bounds checks. **Any plan that adds map
placements, archive entries or IPL files has to be budgeted against these ceilings before it is written** —
not because the build might fail, but because it might NOT fail and corrupt the heap instead.

The measured numbers live in [`edge-cases/sa-runtime-limits.md`](../edge-cases/sa-runtime-limits.md) and
[`edge-cases/sa-formats.md`](../edge-cases/sa-formats.md). This page is the planning gate over them.

## Budget first — and against the TARGET's numbers, not stock's

**The `sa` target always runs OLA + FLA + our own `perfect-map.asi`, and a stock 1.0 is not a configuration
we build for** (the user's call, reaffirmed 2026-08-09). So the useful column is the third one:

| Ceiling | Stock | **On the target** | What overflowing does |
| --- | --- | --- | --- |
| Permanent text-IPL rows, map-wide | 32,767 (int16) | **lifted — `perfect-map.asi` patch #1** (the install runs 72,914) | `CIplStore::IncludeEntity` truncates building-pool indexes to int16; past 2^15 it corrupts stream-out ranges (the "ghost barriers" family) |
| Text IPLs carrying `inst` rows | 39 slots | **lifted — OLA `EntityIpl = unlimited`** | `IplEntityIndexArrays` is written past without a bounds check |
| Rows per text IPL + its boot streams | 4,096 | **lifted — OLA `EntitiesPerIpl = unlimited`** (runs a 9,627-row file) | `gpLoadedBuildings` static array is written past → trashed statics |
| `CPool<CBuilding>` | 13,000 | **`Buildings = 100000`** (OLA) — a number, raisable again | pool exhaustion at load |
| **FLA ID pools** | 5000/255/256 | **TXD 6000 / COL 400 / IPL 1024 — REAL, not `unlimited`; raised in the ini 2026-08-10** | heap corruption during data load — the crash lands right after `shopping.dat` |
| **Model id** | **≤ 18630** | **≤ 18630 — unchanged** | silently fails to load; "HD swapped but nothing changed" |

**The rule this table exists to enforce: do not design content down to a lifted ceiling, and do not add a
guard, cap or migration that shapes output to one.** Budgeting against a stock number the target does not
have silently under-builds, and it looks exactly like success. The bottom two rows are the ones that are
still real — those a plan must respect, and `checkImgIdBudgets` still FAILS the build on the FLA pools. **It
did, on the first `sa` build at the recovered procobj density** (2026-08-10: 522 binary IPL files of 280),
which is the row's proof that it is a gate and not a museum piece. The answer was to RAISE the pool in the
ini — a real ceiling is a number to move, not a reason to ship less content — and the same build showed the
opposite failure too: the guard's TXD limit had always read 6000 while the install's pool was 5000, so a
4999-archive build reported comfortable headroom while standing one slot short. **A guard number ABOVE the
install's is silent by construction — it can only fail to fire.** Take pool numbers from FLA's own log, never
from the ini alone (a `#`-disabled line still prints a value).

Where the numbers come from: [reference-install-config.md](../gta-sa-original/reference-install-config.md)
(verbatim ini capture) and [reference-install.md](../gta-sa-original/reference-install.md) (what it means for
a plan). Read that table rather than assuming a stock value.

**Caught:** the FLA pools and the model id, yes — on a `:sa` build only, since `checkImgIdBudgets` reads the
built `sa/` tree and an `--exclude sa` run never reaches it. Everything else in the table is not enforced
because it is not a limit here. **Designing down to a lifted ceiling is caught by nothing at all.**

## A ceiling is enforced on the branch whose target has it — never on the shared build

The rule for a new plan: **decide which target a ceiling belongs to, and put its guard on that branch.** A
shared-stage guard is not "safe by default" — it silently rations the target that does not have the limit,
and the build still succeeds, which is indistinguishable from success.

**Enforced since 2026-08-08** (07/04): the text-IPL check moved off the common baked build onto the `sa/`
branch, beside `checkImgIdBudgets`. Moving it also fixed a false PASS in the other direction: the sa LOD stage
appends hole-fill instances to the text IPLs *after* the split, so the shared-build count was never the count
SA loads.

**And on 2026-08-09 the other half of the rule landed: a guard for a ceiling the target LIFTED is not a guard
at all.** `checkTextIplBudgets` threw past an invented 30,000-row budget; after the procobj column fix the
layer alone costs 39,219 rows, so the condition was constant and the throw failed every `sa` build to ration
an install we never ship to. It is now `reportTextIplCensus` — rows, inst-bearing IPLs, census coverage, no
ceiling quoted — and the 30,000 budget, the 39-slot line and `--allow-text-row-overflow` are deleted with it.
Nothing had ever culled to fit that cap, so no content moved.

Two things neither move fixed, and both are live:

- `checkImgIdBudgets` reads the built `sa/` tree, so an opensa-only run never checks the FLA pools — a ceiling
  the target really HAS going unchecked on the common case;
- the `opensa/` branch has **no budget guard of its own**. SA's numbers reach no OpenSA code path (our engine
  reads a pak: no building pool, no int16 index, no `IplEntityIndexArrays`), and the streaming budget that
  should replace them has never been measured. The build ANNOUNCES the gap on every opensa run rather than
  leaving it silent, which is the most that can be said honestly until the measurement exists.

**Caught:** the enforcement half, yes. The unchecked half, no. Owned by
[07/04](../../tools/lod-procobj-generator/docs/plans/013-density-budgets-per-target.md).

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
