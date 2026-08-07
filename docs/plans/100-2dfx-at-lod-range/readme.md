# 100 — 2dfx survives to LOD range

**Chimney smoke, street lamps and street-name plates keep working when an area is only its LOD.** Decided
2026-08-07 by the user, after the research in [00](00-research-and-findings.md) killed the first attempt and
then reversed one of its conclusions.

Today every 2d-effect our engine consumes dies at the HD boundary. The three types that have a consumer —
**0 light, 1 particle, 7 roadsign** — are gathered from HD models only, so past ~440 u a district goes dark,
smokeless and unsigned while its baked LOD keeps drawing to 1000 u. The six types that have no consumer at
all (3 ped attractor, 4 sun glare, 6 enter/exit, 8 trigger point, 9 cover point, 10 escalator — 16 934 stock
entries between them) stay dropped, by policy, and this plan does not touch them.

## The shape of it

**Both LOD generators bake the three types into their LOD output, and the OpenSA consumer starts reading
what the cell bake produces.** That second half is what makes the first half real: `opensa-lod-generator`
already writes a 2dfx section into every baked cell and [00](00-research-and-findings.md) found that nothing
reads it. Either the generators feed a consumer or they write bytes into a void — so the two land together.

| Target | Who bakes | Who consumes | State today |
| --- | --- | --- | --- |
| real SA (`sa-lod-generator` clones) | per-object LOD clone carries the entry in its own DFF | **SA itself** reads 2dfx off whatever model streams | verbatim path already carries all three; decimate path drops particles |
| OpenSA (`opensa-lod-generator` cells) | the cell bake carries the entry in the merged cell DFF | `cell-weld` → the pak's LOD bundle | **nothing reads it** — the gap this plan closes |

## Steps

| # | Step | Lands in |
| --- | --- | --- |
| [01](01-policy-space-and-cell-carry.md) | the policy gains a per-type coordinate SPACE and the `cell` target carries 1 + 7 | `tools/lod-common` |
| [02](02-cell-bake-carries-effects.md) | the cell bake emits lights, emitters and plates with the right transform per space | `tools/opensa-lod-generator` |
| [03](03-lod-bundle-reads-2dfx.md) | `cell-weld` reads the LOD level's 2dfx into the LOD bundle, deduped against HD | `packages/cell-weld` (+ `opensa-pack`) |
| [04](04-authored-cull-distance.md) | honour each fx system's authored `cullDist` instead of one hardcoded 300, and raise the smoke systems | `apps/web` + `packages/renderware` |
| [05](05-sa-clone-parity.md) | the SA clones carry the same set on BOTH paths (verbatim and decimate) | `tools/sa-lod-generator` |

Order: 01 → 02 → 03 is the OpenSA line and must land in that order (03 is what makes 02 visible). 04 is
independent and can go first — it is the step that decides how far smoke is drawn at all. 05 is the real-SA
line and depends only on 01.

## The numbers this plan is budgeted against

From [00](00-research-and-findings.md) and the fx census, all measured 2026-08-07:

- **Streaming**: `HD_RADIUS` 380, `LOD_RADIUS` 1000, `HYSTERESIS` 60 — the band with no effects today is
  ~440 → 1000 u.
- **What is out there**: the pak welds **943 particle anchors**, **481 roadsigns**; the stock corpus carries
  2203 light entries in 327 models.
- **Authored cull distances** (`effects.fxp`, our engine currently ignores all of them for a flat 300):
  `ws_factorysmoke` **150**, `smoke30m`/`smoke30lit` 155, `smoke50lit` 255, `carwashspray` 70, `fire`/`flame`
  35, `water_fountain` 30, `vent`/`vent2`/`waterfall_end` 25, `insects`/`cigarette_smoke` 15.
- **Coordinate space per type** (this decides the transform, and getting it wrong throws a plate a kilometre):
  light and particle are **model-local**, roadsign is **WORLD**, 489 of 489.

## Two deliberate departures from the authored data

Both are the user's call, both get a `docs/hacks/` file when they land, because they are places where we
knowingly do not do what the game's own tables say:

1. **Smoke is drawn farther than SA drew it.** `ws_factorysmoke` is authored at 150 u; a chimney plume that
   vanishes at 150 while its factory is drawn to 1000 is the defect this plan exists to fix.
2. **`insects` and `cigarette_smoke` get a floor of 100 u, not their authored 15.** Read literally, the
   authored value would make them pop in almost at arm's length; 100 is the accepted compromise, and it is
   still 3× tighter than today's flat 300.
