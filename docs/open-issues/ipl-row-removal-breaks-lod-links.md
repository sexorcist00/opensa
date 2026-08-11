# A LOD link that no longer points at its own LOD (`gaz9_law`), and two reports it does NOT explain

**Status: 🔴 open, one defect CONFIRMED and two reports UNEXPLAINED (2026-08-11). Fix deferred — the user's
call: record it, do not fix it yet.**

> **Corrected the same evening.** The first version of this file blamed all three field reports on a shifted
> row index and named `laehospital1` as the proof. **That was wrong**: it compared STOCK's link value against
> the BUILT file. Resolving the built tree properly shows `laehospital1`'s link is **132, not 133**, and 132 is
> `LODxhospital1` on the building's own footprint — the merge's rebase and its binary-stream patch both held.
> What survives is one confirmed defect (`gaz9_law`) and two reports with no data-level explanation yet. The
> lesson is the boring one and it is [[lessons-about-my-own-measurement]]'s: the built tree answers for the
> built tree, and a link is a number in ONE file — read both ends from the same tree.

## Symptom

Buildings and roads on the `sa` build render with **no LOD at all**. Field-confirmed by the user (his words:
only the ones he happened to see, not the full set):

| model | txd | position | verdict after the check |
| --- | --- | --- | --- |
| `gaz9_law` | `venice_law` | 721.4, −1458.8, 18.7 | **CONFIRMED broken, twice over** |
| `laehospital1` | `hospital_lae` | 2050.1, −1401.2, 41.7 | chain intact — unexplained |
| `road_lawn33` | `roads_lawn` | 797.5, −1234.4, 17.7 | chain intact — unexplained |

## The mechanism that matters

**A SA text IPL's LOD link is a ROW INDEX into the `inst` section, not a name.** Change the row order and
every index at or after the change points at a different object — silently, because the new target is a valid
row. The binary stream IPLs inside `gta3.img` carry indices into the area's TEXT file, so a text row that
moves also breaks LODs for objects that are not in that file at all.

The build DOES handle the mod-merge case: `removeInstWithRebase` (`tools/mod-installer/src/ide-merge.ts`)
decrements every surviving `lod > removed` and throws on a link pointing AT the removed row, and
`apply-mod.ts` calls `patchAreaStreams` (`stream-merge.ts`) to rewrite the `lod` field of every 40-byte INST
record in each `<area>_streamN.ipl`. **Measured: it works.** `5. SA Xbox Map Features` removes `LODroadbnj`
from `LAe.ipl` at index 93; `laehospital1`'s stream link came out **133 → 132**, landing on `LODxhospital1`
exactly as it should. `docs/contracts/mods.md` describes this and the description is accurate.

## The confirmed defect: `LAw.ipl`'s stock tail is misaligned, and its stream links were not rebased

`gaz9_law` is placed by `law_stream2.ipl` with `lod-link=158` into `LAw.ipl`. **Two independent things are
wrong there, and either alone would remove the LOD.**

**1. Three rows carry the transform of the row above them.** Built `LAw.ipl`, indices 153–157:

```
153: 3760, LODcanhou01_LAx, 0, 793.859375,  -1729.820313, 16.4296875          <- stock text, float32
154: 3760, LODcanhou01_LAx, 0, 790.8125,    -1749.851563, 16.4296875          <- stock text, float32
155: 6253, LODhedge_law,    0, 790.8125,    -1749.8515625, 16.429689407348633 <- row 154's transform, float64
156: 6255, lodmallb_law,    0, 1305.46875,  -1619.7421875, 13.39844036102295  <- hedge's transform, float64
157: 6256, LODgaz9_law,     0, 1117.585938, -1490.007813, 32.71875            <- mallb's transform
158: 729,  tree_hipoly07,   0, 864.5234375, -1694.328125, -300.0              <- appended trees layer
```

Stock has **six** `LODcanhou01_LAx` rows, the build has five: the id/name column took the deletion and the
transform column did not. **`LODgaz9_law` therefore sits at 1117.6, −1490.0, 32.7 instead of 721.4, −1450.9,
10.2 — 398.7 u off its object**, and `LODhedge_law` even wears a re-derived rotation
(`-0.02181999944150448` vs stock's `-0.02181491256`), so the row went through a float64 round-trip. No mod
ships `LAw.ipl` or a `LAw.ipl.merge`; this is ours.

**2. The stream link was not rebased.** `gaz9_law`'s link is **158 in both trees** — unlike `LAe.ipl`, nothing
patched `law_stream2.ipl`. Built index 158 is the first row of the appended trees layer, a `tree_hipoly07`
sunk to z = −300. So the game asks for a LOD and gets an exiled tree.

**Measured, `build/original/sa` vs `game-src/original` (2026-08-11 18:04 build):**

| file | stock inst rows | built | first divergence | note |
| --- | --- | --- | --- | --- |
| `LA/LAe.ipl` | 303 | 478 | index 93 | mod merge removed `LODroadbnj`; rebase + stream patch HELD |
| `LA/LAw.ipl` | 172 | 476 | **index 155** | one `LODcanhou01_LAx` short, tail misaligned, stream NOT patched |
| `LA/LaWn.ipl` | 293 | 435 | index 252 | past every link in question; no effect on the reports |

(Row counts grow because our layers append. Appending is safe — every index it could disturb is below it.)

## The two reports this does NOT explain

Checked against the built tree, both are clean at the data level, so **something else is producing the
symptom** and neither should be assumed fixed when `LAw.ipl` is:

- **`laehospital1`** — stream link 132 → `LODxhospital1` at 2050.07, −1401.21, 33.68, the building's own
  footprint. DFF and TXD both resolve.
- **`road_lawn33`** — text link 115 → `LODroad30` at 797.914, −1234.445, 17.719, the road's own position.
  Resolves too.
- **`standard01_lawn`** (his follow-up: "something very big looks like it slid or duplicated onto the
  crossroads") — one placement, at stock's 1024.44, −990.49, 44.97, link 175 → `LODndard01_LAwN` at the same
  spot. **Not moved and not duplicated in the map data.** Within 150 u of the crossroads the built map adds
  nothing that stock does not have, so whatever he is seeing there is not a placement.

**The one thing all the LODs have in common is ours**: every stock LOD is repointed from the shared stock
atlases to a generated per-LOD dictionary — `LODxhospital1` `lod2lae1` → **`salod0424`**, `LODroad30`
`lawnlodbig` → **`salod0645`**, `LODgaz9_law` `lod_a_law` → **`salod0551`**. Sampled offline they are fine
(`inspect-area` reports `dff ok` / `txd ok` for every LOD in the crossroads area, no failures at all), so this
is a suspect and not a finding. It is where the next round should start, because it is the only edit that
touches all three.

## Why nothing caught the confirmed half

Every guard counts rows or checks that a row is well-formed; **an index that lands on a valid row passes all
of them**, and a transform column that is off by one against its own name column is a perfectly legal file.
The unit tests prove `removeInstWithRebase` rebases; nothing proves the BUILD is still consistent once every
stage has had a turn at the file.

## For whoever picks it up

1. **Find the pass that rewrote `LAw.ipl`'s rows 155–157.** It is not the merge (`removeInstWithRebase` edits
   only the last cell of a line, and preserves text). The output signature is greppable: full float64
   serialisation of position and a re-derived quaternion, on rows that stock writes at float32 precision.
   Whatever it is, it is dropping a row from one column stream and not the other.
2. **Then ask why `law_stream2.ipl` was not patched** while `lae_stream0.ipl` was. `patchAreaStreams` only
   runs off a `.merge`'s `removedInst`; a row that disappears through any other path gets no stream patch at
   all. That is the actual hole in the design, and it is bigger than the one file.
3. **Add the guard this went without**, which is what turns the class from silent to caught: after the build,
   every lod link — text and binary-stream — must resolve to the same model NAME it resolved to in the source
   tree. A few lines, and it prints the blast radius as a side effect (this file's "scope" section is exactly
   what that guard would have printed).
4. **Design rule regardless: appending is safe, removing is not.** Retire a placement by exiling the row (the
   trees layer's z = −300/−1000 is the established shape) rather than deleting it — no renumbering, and
   nothing downstream can undo it. Now stated in
   [`docs/restrictions/assets-and-data.md`](../restrictions/assets-and-data.md).

Reproduce with the built tree beside the source one — the standing rule that a field report is chased against
`build/<game>/…` and never `game-src/` is what made this findable, and reading one end from each tree is what
made the first version of this file wrong:

```sh
# first row index where the built file stops agreeing with stock
paste <(awk '/^inst/{f=1;next}/^end/{f=0}f' game-src/original/data/maps/LA/LAw.ipl | cut -d, -f1-2 | tr -d '\r') \
      <(awk '/^inst/{f=1;next}/^end/{f=0}f' build/original/sa/data/maps/LA/LAw.ipl | cut -d, -f1-2 | tr -d '\r') \
  | awk -F'\t' '$1!=$2{print NR-1": "$1"  ->  "$2; exit}'

# what a given lod-link resolves to, in ONE tree (read the link from the same tree!)
awk -v k=158 '/^inst/{f=1;n=0;next}/^end/{f=0}f{if(n==k)print;n++}' build/original/sa/data/maps/LA/LAw.ipl
```

`scripts/debug/find-instances.ts <model>` prints a model's placement and its `lod-link`, and
`inspect-area.ts <x> <y> [r]` prints everything around a point with DFF/TXD resolution — **both read
`game-src/`**. To point them at a build, symlink it in (`ln -s "$PWD/build/original/sa" game-src/.tmp-built-sa`,
then `--game .tmp-built-sa`) and remove the link afterwards; that is how the corrections above were taken.

## Scope, honestly stated

One confirmed defect, in one file. The census behind the table compared text IPLs map-wide by name and
occurrence — it cannot see a row whose name stayed and whose transform moved except at a divergence point, and
it does not read the binary streams at all. So the blast radius of the `LAw.ipl` class is **unknown**, and the
two unexplained reports mean the field is seeing at least one defect this file does not describe.
