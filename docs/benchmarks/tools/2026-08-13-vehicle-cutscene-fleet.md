# vehicle-cutscene — full-fleet build (plan 002 step 10)

**Run 2026-08-13, the user's macOS machine (APFS).** The first build with all three branches live
(car / bike / boat): **23/23 slots converted, 0 skipped, 0 errors**, 400 paint materials baked on 20
models.

## Conditions

- Base: `game-src/original` (stock 1.0 tree). Mods: `mods-src/original/vehicles` (the 21-mod donor
  set of the census, plan 002 step 1).
- Flags: `--self-contained-txd` — the standalone-measurable configuration (over a stock base the txdp
  parents are stock, so the empty-TXD route fails closure by design; that route's numbers ride the
  pipeline run of step 11). Self-contained is also the reference-bottle delivery shape.
- Tool: `npx tsx tools/vehicle-cutscene/src/cli.ts --game game-src/original --in
  mods-src/original/vehicles --out <dir> --self-contained-txd`, commit `aebda312`.

## Headline numbers

| Measure | Value |
| --- | --- |
| Wall-clock (whole run: base copy + 23 conversions + img rebuild) | **3.55 s** (1.70 s user, 1.02 s sys; APFS copy-on-write makes the 1.7 GB base copy near-free) |
| `models/cutscene.img` | **25.7 MB → 310.8 MB** (325 949 440 B) |
| 23 converted DFF entries | 4 460 544 B → **155 539 456 B** (IMG VER2 sector-padded entry sizes) |
| 23 emitted cs TXD entries | **148 848 640 B** (self-contained: mod TXDs embedded; the empty-TXD pipeline route emits ~40 B per slot — 840 B measured across 21 slots at step 6) |

## Per-model table (IMG entry sizes, bytes, sector-padded)

| Slot | Vanilla DFF | Built DFF | Built TXD |
| --- | ---: | ---: | ---: |
| csbobcat92 | 194 560 | 5 435 392 | 6 617 088 |
| csbravura | 186 368 | 10 229 760 | 4 714 496 |
| csburrito92 | 196 608 | 4 499 456 | 11 030 528 |
| cscopcarla | 221 184 | 5 871 616 | 11 401 216 |
| cscopcarla92 | 206 848 | 5 871 616 | 11 401 216 |
| cscopcarsf | 223 232 | 3 452 928 | 4 497 408 |
| csdinghy | 71 680 | 628 736 | 788 480 |
| csfirela | 292 864 | 11 411 456 | 16 572 416 |
| csglendale92 | 180 224 | 8 955 904 | 6 651 904 |
| csgreenwood | 174 080 | 8 771 584 | 2 942 976 |
| csmonster | 264 192 | 1 759 232 | 233 472 |
| csmothership | 227 328 | 4 962 304 | 3 239 936 |
| csmtbike92 | 124 928 | 2 582 528 | 602 112 |
| csremington92 | 188 416 | 3 180 544 | 1 329 152 |
| cssabre92 | 174 080 | 3 430 400 | 2 062 336 |
| cssadler | 184 320 | 7 942 144 | 4 890 624 |
| cssavanna | 198 656 | 8 990 720 | 5 138 432 |
| cssecurica92 | 225 280 | 11 063 296 | 6 189 056 |
| cstaxi92 | 198 656 | 4 526 080 | 6 782 976 |
| csvoodoo | 165 888 | 12 404 736 | 4 222 976 |
| cswashington | 192 512 | 7 225 344 | 9 760 768 |
| cszr350 | 186 368 | 11 171 840 | 13 889 536 |
| cszr350b | 182 272 | 11 171 840 | 13 889 536 |
| **Totals** | **4 460 544** | **155 539 456** | **148 848 640** |

(`cszr350`/`cszr350b` and `cscopcarla`/`cscopcarla92` share a donor — the entries are equal-sized but
emitted per slot; IMG carries no dedupe.)

## Addendum — the plate bake (plan 003, same day)

The plates build (`NO_COMMIT/cs-mods-plates/`, commit after the table above) adds the baked
`carplate`+`carpback` pair to every plated slot: the run summary's RAW cs-TXD total (unpadded — a
different base than the sector-padded table above) went **148 828 601 → 149 092 025 B, +263 424 B
across 21 plated slots (~12.5 KB each)**; cutscene.img 310.8 → 311.1 MB. The bike and boat slots
carry no plate quads and gain nothing.

## Structural verification (the step-10 gate)

- All **317** DFFs in the rebuilt archive parse; all **317** skeletons consistent (hierarchy size =
  boned frames); **0 failures**.
- Converted-vs-vanilla diff over all 23 slots: **0 failures** — on every slot the FIRST frame carrying
  a vanilla name carries the vanilla bone id (anims bind by name to the first match, and template
  bones are emitted before adoption), hierarchy ids unique, node indexes contiguous.
- 20 adopted duplicate names across the fleet at THIS run (a mod mesh named like a vanilla part
  landing via adoption) — recorded as bind-safe by frame order. **Falsified the same day by plan 004
  round 1** (a duplicate still binds and double-transforms — DESERT9's floating door glass): the
  emit now renames adopted collisions with `_ad`, and the rebuilt fleet measures **0 duplicates**
  (`cutscene-fleet-verify.ts` fails on any).
