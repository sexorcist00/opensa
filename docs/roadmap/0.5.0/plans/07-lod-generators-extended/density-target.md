# The density target — what a shipping mod actually places

Part of [07 — LOD generators, extended](readme.md). The procobj chain says "more procobj" without ever naming a NUMBER,
so every plan under it has been tuned against a feeling. This file fixes the target against a real, shipping
reference and costs it in the two currencies that decide whether it can ship: **permanent text-IPL rows** and
**gta.dat IPL slots**.

Everything below was read off a run on **2026-08-07** — our side off `build/original/opensa` (built 09:06),
the reference off `NO_COMMIT/ProperFixes 2.2.1`. Nothing here is derived from a diff or from an older doc.

## The reference: ProperFixes 2.2.1, "(optional) increase vegetation distance"

Junior_Djjr / MixMods. It solves exactly our problem — far more ground clutter than vanilla — and it solves
it the opposite way, which is what makes it useful.

| What | Value |
| --- | --- |
| Static instances placed | **57 583** |
| Files / gta.dat IPL slots | 6 (`procobj1..6.ipl`, 9 520–9 627 rows each) |
| Distinct model ids | 46 |
| Rows carrying a LOD link | **0** — every row is `lod = -1` |
| `procobj.dat` shipped alongside | a REPLACEMENT with 14 rules left, all `P_UNDERWATERBARREN` |

The last row is the mechanism: the mod **deletes the land scatter from `procobj.dat` and re-ships it as
static IPL rows**, keeping only the underwater rules procedural. That is the same trade our
`lod-procobj-generator` makes (`procobj-strip.ts` / `--modloader` disable rows) — placement moves from
runtime to build time. The difference is entirely in the LAYOUT of what comes out.

Its own header states the price: _"Requires increased game limits (included in Proper Fixes and Urbanize)
otherwise will lag and crash"_, and the suite's readme: _"REQUIRES Open Limit Adjuster (or well configured
f92la)"_.

The distribution is heavily skewed — ids 865 and 866 alone are **22 863 rows, 40 % of the whole set**, and the
tail runs down to a couple of hundred. Worth carrying into
[01 — species representation](lod-procobj-generator/01-species-representation-floor.md): a hand-tuned
reference set is this lopsided on purpose, so "every species survives" is a floor argument, never an
equal-share one.

## Our side, same day

| What | Value |
| --- | --- |
| Procobj objects placed (HD) | **24 552**, in 51 binary stream tiles inside `gta3.img` |
| Permanent text LOD rows | **6 954**, across 9 text IPLs (`plobj0..7`, `plotr0`) |
| **Objects per permanent text row** | **3.53** |
| Distinct models in the text layer | 63 |
| Map-wide permanent text `inst` rows | **20 146** / 32 767 ceiling (pmb guard 30 000) |
| — of which stock | 12 629, in 28 slots |
| — of which generated | 7 517, in 10 slots (the 9 procobj areas + `lods.ipl`, 563 tree-LOD rows) |
| gta.dat IPL slots carrying `inst` | **38** / 40 ceiling (pmb guard 39) |

Note the two numbers that moved since [00's](lod-procobj-generator/00-limit-route-review.md) 2026-07-28
baseline (which measured `build/original/sa`, a different tree): rows are **down** 25 461 → 20 146, slots are
**up** 37 → 38. Headroom is now **12 621 rows and TWO slots** — one, against the build guard.

## The comparison that matters

| | ProperFixes | ours | ratio |
| --- | --- | --- | --- |
| Objects placed | 57 583 | 24 552 | **2.35× more** |
| Permanent text rows spent on them | 57 583 | 6 954 | **8.3× more** |
| IPL slots spent | 6 | 9 | 0.67× |

**Their density is 2.35× ours; their row cost per object is 8.3× ours.** The `linkedHeight` binary-stream
economy is doing exactly what it was built for — at an equal row budget our layout would place ~3.5× what
theirs does. This is the [directive-3](../../../../project-goals.md) case where we are already ahead, and the
plans below must not trade it away to buy density.

### Costing the target: 57 583 objects, our layout

Scale our current mix by 2.35× and it costs **57 583 binary HD rows + 16 312 permanent text LOD rows**.

- **Rows: it fits.** Map-wide permanent text becomes `20 146 − 6 954 + 16 312 = ` **29 504** against the
  30 000 guard and the 32 767 ceiling. 496 rows of margin — thin, but the int16 lift is **not** on the
  critical path for this target.
- **Slots: it does not fit, and no packing arrangement makes it.** SA's `LoadScene` buffer caps an area at
  ~4 000 rows text+binary (`AREA_ROW_CAP`, [sa-runtime-limits](../../../../edge-cases/sa-runtime-limits.md)).
  73 895 rows over a 4 000-row area is **≥ 19 areas** against the 9 we ship — total slots go 38 → **48**,
  against a ceiling of 40. Even at a theoretically perfect pack the target needs ~10 slots we do not have.

That closes [00's](lod-procobj-generator/00-limit-route-review.md) open option 3 ("fold the generated areas
into fewer, larger files") **with a number rather than a hope: folding cannot buy this target.** The area
count is set by the 4 000-row `LoadScene` budget, not by how the files are grouped, so fewer files means
areas that breach it. Something has to be lifted — and the thing to lift is the per-area budget or the slot
array, not the int16 row ceiling we were planning around.

### What ProperFixes is actually paying

Its 57 583 rows land on top of stock's 12 629 permanent rows, i.e. **70 212 map-wide — 2.14× the int16
ceiling** — and its 9 597-row files are **2.4× the per-area `LoadScene` budget**. Both are ceilings our own
[ghost-barriers record](../../../../open-issues/fixed/ghost-barriers.md) says are structural.

**Field-tested 2026-08-07, and the answer is its own `.asi`.** Remove `ProperFixes.asi` and the ghost
barriers appear on its data — so the mod really is over the ceiling, and OLA is not what saves it. Install
**`perfect-map.asi`** instead and the barriers go, along with the new-game 2dfx crash. Our own patch carries
a foreign 70k-row map; everything it had been proven on before was ours. Details and the caveats in
[00](lod-procobj-generator/00-limit-route-review.md).

The run leaves one number in this file open, and it is the important one: **their 9 597-row IPL files ran
clean at 2.4× our `AREA_ROW_CAP`.** If that budget is genuinely that conservative, the "≥ 19 areas" above
collapses to roughly their six slots and the slot problem with it. Their rows are pure text with no LODs and
no binary streams, so it is not a like-for-like comparison — but it is now the cheapest thing standing
between us and the target, and [04](lod-procobj-generator/04-slot-economy-and-budgets.md) owns measuring it.

## The target this plan adopts

**57 583 placed objects, map-wide, as the aiming point — not as a promise.** It is a demonstrated,
field-accepted density from a mod people actually run, which is the bar
[project-goals directive 4](../../../../project-goals.md) asks for; it is not a number we invented. Three
qualifications go with it:

1. **Distribution beats total.** Their 40 %-in-two-species skew is a hand-authored look, not a scatter model.
   [02](lod-procobj-generator/02-density-model.md) and [03](lod-procobj-generator/03-biome-zone-density.md)
   have to earn the same look from `procobj.dat` rules plus biome, and the target is the ceiling those
   profiles are allowed to reach — reaching it with the wrong species is a failure, not a pass.
2. **Perf is part of the specification.** 2.35× the clutter has never been measured in either host. The
   target is provisional until [04](lod-procobj-generator/04-slot-economy-and-budgets.md) has the frame and
   streaming numbers; if the engine says 1.6× is the honest ceiling, the target moves and this file records
   why.
3. **Our objects are not their objects.** Ours carry generated LODs and colliders; theirs carry neither
   (`lod = -1` throughout). Object-for-object parity therefore costs us more memory and more draw setup than
   it costs them, and buys visibly more at range. Compare counts, never costs.
