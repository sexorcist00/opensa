# Removing an inst row from a text IPL silently breaks every LOD link after it

**Status: 🔴 open, ROOT CAUSE FOUND 2026-08-11, fix deliberately deferred (the user's call: record it, do
not fix it yet).** Field-reported as "the original SA build has no LOD for these objects"; the diagnosis below
was taken the same hour off the built tree and the cause is ours, not the game's.

## Symptom

Buildings and roads on the `sa` build render with **no LOD at all** — they simply are not there at distance,
and pop in at their draw distance. Field-confirmed by the user (his words: these are only the ones he
happened to see, not the full set):

| model | txd | position |
| --- | --- | --- |
| `laehospital1` | `hospital_lae` | 2050.1, −1401.2, 41.7 |
| `road_lawn33` | `roads_lawn` | 797.5, −1234.4, 17.7 |
| `gaz9_law` | `venice_law` | 721.4, −1458.8, 18.7 |

## Mechanism

**A SA text IPL's LOD link is a ROW INDEX into the `inst` section, not a name.** Delete one row and every
index at or after it points one object too far — silently, because both the old and the new target are valid
rows. The binary stream IPLs inside `gta3.img` use the same indices against the area's TEXT file, so a text
row deleted map-side also breaks LODs for objects that are not in that file at all.

**Rows do get deleted.** `5. SA Xbox Map Features` ships `data/maps/LA/LAe.ipl.merge` whose whole body is:

```
remove from "inst":
5538, LODroadbnj, 0, 2041.726563, -1752.320313, 12.28125, 0, 0, -1, 2.35597272e-005, -1
```

**And this is exactly the case the merge was BUILT for, which is what makes the bug interesting.**
`docs/contracts/mods.md` states the guarantee — `remove` "for `inst` rebases every surviving `lod` link and
reports the removed indexes so the area's binary streams are patched the same way" — and the code is there:
`removeInstWithRebase` (`tools/mod-installer/src/ide-merge.ts`) decrements every surviving `lod > removed`
and throws on a link pointing AT the removed row, then `apply-mod.ts` calls `patchAreaStreams`
(`stream-merge.ts`), which rewrites the `lod` field of every 40-byte INST record in each `<area>_streamN.ipl`
inside `gta3.img`.

**So the defect is that this machinery did not hold on the shipped build, not that it is missing.** The
measurements below are what the built tree actually contains; which link of the chain broke is NOT yet
established, and the two candidates are named at the bottom.

**Measured on `build/original/sa` vs `game-src/original` (2026-08-11 18:04 build):**

| file | stock inst rows | built | first divergence | what was removed |
| --- | --- | --- | --- | --- |
| `LA/LAe.ipl` | 303 | 478 | **index 93** | `LODroadbnj` (5538) |
| `LA/LAw.ipl` | 172 | 476 | **index 155** | one of six `LODcanhou01_LAx` (3760) |
| `LA/LaWn.ipl` | 293 | 435 | index 252 | a `sjmpalmtall` row (trees region) |

(The row counts GROW because our own layers append; appending is safe, deleting is not.)

Two of the three reports resolve straight out of that table:

- **`laehospital1`** is placed by the binary stream `lae_stream0.ipl` with `lod-link=133` into `LAe.ipl`.
  Stock index 133 is `LODxhospital1` at the building's own position; on our build it is **`LODxroad08` at
  2155, −1382, 23** — a road LOD 105 u away. The hospital's LOD is not missing, it is drawing something else
  somewhere else, because one row was deleted 40 rows earlier.
- **`gaz9_law`** is placed by `law_stream2.ipl` with `lod-link=158` into `LAw.ipl`. Here the LOD does not need
  a stale index to be wrong — **the row itself moved**: three LOD rows come out carrying the transform of the
  row above them. `LODhedge_law` took the last `LODcanhou01_LAx` position AND rotation, `lodmallb_law` took
  hedge's, and **`LODgaz9_law` sits at 1117.6, −1490.0, 32.7 instead of 721.4, −1450.9, 10.2 — 398.7 u off its
  object** (confirmed twice: by text diff and by resolving the built tree through `loadMapDefsAt`). Those
  three rows are also re-serialised at full float64 precision while every untouched row keeps stock's text
  verbatim, which is both a cheap way to spot them and the clue about which pass wrote them.

**`road_lawn33` is a DIFFERENT defect and stays open.** Its chain is intact in the built data — `LaWn.ipl`
diverges only at index 252, well past its `lod-link=115`, which still resolves to `LODroad30` at the road's
exact position. What DID change is the LOD's texture dictionary: stock `LODroad30` reads `lawnlodbig`, our
build writes **`salod0645`** (same for `LODgaz9_law`: `lod_a_law` → `salod0551`). So for this one the suspect
is the generated `salod*` asset, not the link. Not investigated yet.

## Why nothing caught it

Every guard we have counts rows or checks that a row is well-formed; **an index that lands on the wrong valid
row passes all of them.** There is no assertion anywhere that a lod link still resolves to the same MODEL NAME
it resolved to in the source data, and the binary-stream half means the damage is not even visible in the file
that was edited. The unit tests for `removeInstWithRebase` prove the function rebases; nothing proves the
BUILD's output is still consistent after every stage has had its turn.

## For whoever picks it up

Two candidates, and they are cheap to separate — the first thing to do is decide between them, not to write a
fix:

1. **The stream patch did not survive.** `patchAreaStreams` rewrites `gta3.img` in place, per merge, at the
   moment that merge is applied. Any later mod that ships its own `<area>_streamN.ipl`, or any later stage
   that rebuilds the archive from a pre-patch source, silently restores the stale index. Check by reading
   `lae_stream0.ipl` out of `build/original/sa/models/gta3.img` and looking at `laehospital1`'s `lod` field:
   **132 means the patch held and the bug is elsewhere; 133 means it was reverted.**
2. **A second pass rewrites inst rows.** In `LAw.ipl` three rows — `LODhedge_law`, `lodmallb_law`,
   `LODgaz9_law` — come out carrying the transform of the row ABOVE them and re-serialised at full float64
   precision, while every untouched row keeps stock's text byte-for-byte. `removeInstWithRebase` only edits
   the last cell of a line, so it cannot produce that; something else parses and re-emits these rows and is
   off by one against the deletion. Find that pass (the float-precision signature makes its output greppable)
   before anything is changed in the merge.

Then, whichever it is, the design rule stands: **appending is safe, removing is not.** Retiring a placement
should exile the row (the trees stage's z = −1000 is the established shape) rather than delete it — no
renumbering, no cross-file patch to keep alive, and it costs one permanent row, which this target has room
for (`docs/restrictions/sa-target.md`).

**And add the guard this went without**, since it is what turns the whole class from silent to caught: after
the mods stage, every lod link — text and binary-stream — must resolve to the same model NAME it resolved to
in the source tree. A few lines, and it prints the blast radius as a side effect.

Reproduce the whole diagnosis with the built tree beside the source one — the standing rule that a field
report is chased against `build/<game>/…` and never `game-src/` is what made it findable:

```sh
# first row index where the built file stops agreeing with stock
paste <(awk '/^inst/{f=1;next}/^end/{f=0}f' game-src/original/data/maps/LA/LAe.ipl | cut -d, -f1-2 | tr -d '\r') \
      <(awk '/^inst/{f=1;next}/^end/{f=0}f' build/original/sa/data/maps/LA/LAe.ipl | cut -d, -f1-2 | tr -d '\r') \
  | awk -F'\t' '$1!=$2{print NR-1": "$1"  ->  "$2; exit}'

# what a given lod-link resolves to, in each tree
awk -v k=133 '/^inst/{f=1;n=0;next}/^end/{f=0}f{if(n==k)print;n++}' build/original/sa/data/maps/LA/LAe.ipl
```

`scripts/debug/find-instances.ts <model>` prints a model's placement and its `lod-link` (it reads
`game-src/`, so it answers for STOCK — the built side needs `loadMapDefsAt` pointed at `build/original/sa`).

## Scope, honestly stated

The user saw three; the census above found the misalignment in **two LA files**, and it was not run map-wide
for every area/stream pair. The true blast radius is "every object whose lod link is at or after a deleted
row, in any file a mod merge removes from" — unknown, and cheap to measure once someone writes the
name-resolution guard, which produces the list as a side effect.
