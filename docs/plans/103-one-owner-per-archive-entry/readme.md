# 103 — one owner per archive entry: the vehicle bucket takes everything the vehicle tables name

**Status: PLANNED 2026-08-20**, the user's design. Field-found the same morning: the **slamvan has no
textures**, because `slamvan.txd` exists in `gta3.img` (stock, 14 336 B) and in `vehicles2.img` (the mod's,
9 359 360 B) at once and the stock one wins. The issue is
[`docs/open-issues/mod-file-shadowed-by-its-stock-twin.md`](../../open-issues/mod-file-shadowed-by-its-stock-twin.md);
this is how it gets closed. Spans `img-splitter`, `vehicle-installer` and the `sa` stage's census, which is
why it lives here rather than beside one tool.

## The rule

> **Everything `vehicles.ide` and `veh_mods.ide` name — models and dictionaries alike — belongs to the
> vehicle bucket, and is MOVED there: written to the vehicle archive and deleted from `gta3.img`.**
> No entry may then exist under one name in two archives of a built tree.

Today the splitter decides an `objs` row is a vehicle part only when `carmods.dat`'s `mods` line names its
model, and a name claimed by two buckets stays in `map`. Both halves fail on the same data:

- `slamvan.txd` is claimed by `vehicles.ide` AND by the `veh_mods.ide` rows of `bnt_lr_slv1`/`2` — the two
  stock parts no shop offers, so they are on no `mods` line, so they claim the MAP bucket and the dictionary
  is contested into `gta3.img`. It is the **same false premise 014 disproved this morning**: a car's parts
  are not the parts on its `mods` line (22 mirrored parts game-wide are on none).
- A paintjob dictionary (`blade1.txd`) is named by no IDE row at all, so all 36 of them stay behind.

**Measured before writing this:** under the new rule, dictionaries claimed by both a vehicle file and
something else in the whole stock tree = **0**. There is nothing to contest.

## What is broken today, measured on the built `sa` tree

| | |
| --- | --- |
| names living in two archives | **45** — 39 of them ours, on top of a stock baseline of 6 |
| the stock baseline (accepted, not a defect) | `changeme.txd`, `kbmiscfrn1.txd`, `barrier.txd`, `lawest1.txd` (gta3 + gta_int), `coach.dff`, `coach.txd` (gta3 + player) |
| of ours: paintjob dictionaries | **34** across 12 cars — those cars wear STOCK paintjobs, silently |
| of ours: a car's base dictionary | **1** — `slamvan.txd`, the visible one |
| of ours: tuning-part models | **3** — `bnt_lr_slv1.dff`, `bnt_lr_slv2.dff`, `coach.dff` |

Stock paintjob dictionaries, for the record: **36 across 13 cars** — 11 cars with 3, `broadway` with 2,
`camper` with 1.

## Steps

### 1 — The claim set is the vehicle TABLES, not `carmods.dat`

`claimsFromIde` gets its vehicle-part answer from the file a row is IN: every row of `vehicles.ide` and of
`veh_mods.ide` claims its model and its dictionary for `vehicles`. `vehiclePartsFromCarmods` goes.
**Verify**: 0 contested dictionaries over the stock tree; `slamvan.txd`, `bnt_lr_slv1/2.dff` land in the
vehicle bucket; the classifier's own unclaimed/contested counts are reported before and after.

### 2 — A paintjob dictionary belongs to its car, by name

`<car><n>.txd` for every car in `vehicles.ide` is a vehicle claim — derived from the car list and the
archive's own entry names, no table. **Verify**: all 36 stock paintjob dictionaries move; the 13 cars are
the ones listed above; nothing whose base name is not a car is dragged along.

### 3 — The guard: one name, one archive

A built tree is refused when a name lives in two of its archives, naming both archives and both sizes,
against the **stock baseline of 6** (which is a fact about the original game and stays allowed). The class is
silent by nature — every file valid, every archive registered, and one car quietly wearing another's
textures — so the guard is what says the fix held.
**Verify**: it fires on today's tree with 39 and is silent on the rebuilt one.

### 4 — A mod owns its slot's paintjobs

With 1–2 done, the stock paintjob dictionaries sit in the vehicle archive, where the installer replaces the
ones a mod ships. The leftovers are the open question: stock `blade` has 3, and a mod shipping 2 (or 0)
leaves stock artwork on a modded body under paintjob 3.

**First recover the original's own rule** — how the game decides how many paintjobs a car offers (the
reference install runs FLA's `Make paintjobs work for any ID = 1`, so the stock rule is id-based and is being
lifted). Only then decide between "delete every stock `<slot><n>.txd` the mod does not ship" and "keep the
count and warn". Until it is recovered this step ships nothing.
**Verify**: named once the rule is known; the census above is the before.

### 5 — `add-vehicles` needs nothing, and that is worth checking

An added car has no stock twin and its models go LOOSE into `modloader/added-vehicles/`, so it cannot shadow
anything. **Verify**: after 1–3, the duplicate count over a full build is the stock 6 with the added fleet
installed.

### 6 — a car is not split across two archives

**The user's call, 2026-08-20: not a correctness requirement, a diagnosability one.** Today
`writeImgFamily` places entries greedily one at a time and starts a sibling wherever the cap falls, so
**148 of 201 cars have their `.dff` in `vehicles.img` and their `.txd` in `vehicles2.img`**. Nothing breaks —
the game resolves by name across archives — but every question of the form "where does this car live" gets
two answers, and this morning's diagnosis spent its first minutes ruling that out as the cause.

So the writer takes an optional grouping: entries sharing a key are placed together, and a group that does
not fit starts the next sibling instead of straddling. The key is the car slot, derived from the entry name
against the vehicle tables (`<car>.dff`, `<car>.txd`, `<car><n>.txd`, and a part's model + its dictionary,
which after step 1 is the car's own). A single group larger than the cap still has to split, and says so.
**Verify**: cars whose files land in two archives 148 → 0; the archive count does not grow (today 2 for the
vehicle family); the family stays stable for a given input.

## Docs to update in the same change

- `docs/architecture/` — the splitter's bucket rule (its diagram names the claim source).
- `docs/contracts/vehicles.md` — that a slot's paintjob dictionaries are the mod's to ship, once step 4 lands.
- `docs/restrictions/assets-and-data.md` — one name, one archive, and the stock baseline that is not a defect.
- The open issue → `fixed/` with the before/after.

## Measured (fill in as the steps land)

| | before | after |
| --- | ---: | ---: |
| duplicate names in the built tree | **45** (39 ours) | |
| cars wearing stock paintjobs | **12** | |
| cars with no textures at all | **1** | |
| cars split across two archives | **148** of 201 | |
