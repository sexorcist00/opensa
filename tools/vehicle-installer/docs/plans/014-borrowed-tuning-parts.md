# 014 — a replacement car's BORROWED tuning parts, derived

**Status: PLANNED 2026-08-19.** Field-found the same evening: the blade's rear bumper is modelled for a
1960 Impala. Grew out of central [plan 102](../../../../docs/plans/102-add-vehicles/readme.md)'s field round;
the issue it closes is
[`docs/open-issues/vehicle-part-name-clash-between-mods.md`](../../../../docs/open-issues/vehicle-part-name-clash-between-mods.md).

## What is broken

A vehicle mod for a STOCK slot may ship tuning parts under names that belong to a DIFFERENT car
(`voodoo - 1960 Chevrolet Impala - chezy` ships `rbmp_lr_bl1.dff`, the blade's rear bumper, and eight of the
slamvan's). An archive entry name is global — one model per name — so the installer stages both and **the
last one silently wins**. Measured on the built tree: **9 clashes, all `.dff`**, and the voodoo mod wins every
one. Blade loses its rear bumper, slamvan loses eight parts, and the symptom is geometric — the part loads,
mounts and renders in the wrong place.

The stock game has no such problem because it ships one model per name. **The mod author is not doing
anything unusual**: a car with no tuning of its own borrows a neighbour's part names to have any, and that
works right up until a second mod does it.

## The rule, and it is DERIVED — no table, no new file kind

> A part `.dff` in a vehicle folder whose name is **not in that slot's STOCK `carmods.dat` line** is a NEW
> part of that car, not a replacement of the stock one.

Checked against the three folders that clash, and it lands exactly:

| folder | own (replacements, keep the name) | BORROWED (new parts) |
| --- | --- | --- |
| `blade - … - gross` | 6 | 3 — `bnt_b_lr_bl`, `spl_b_lr_bl`, `wg_r_lr_bl1` |
| `slamvan - … - alfamodding` | 9 | 4 — `bnt_lr_slv1/2`, `wg_r_lr_slv1/2` |
| `voodoo - … - chezy` | 0 | **11** — exactly the eleven of the user's earlier hand-written map |

That last row is the acceptance test for the derivation: his old tool carried the map by hand, and the rule
reproduces it from `game-src/original/data/carmods.dat` plus the folder listing, with nothing authored.

The same rule subsumes two things we have been treating separately: the two parts `blade`'s
`tuning_new_parts.txt` declares by hand (their names are borrowed, so they derive), and the mirrored parts a
mod adds where the stock car has only one side (`wg_r_*` — stock blade and slamvan have no right skirt).

## What already exists

`tools/add-vehicles/src/tuning.ts` (plan 005) does this for an ADDED car: `deriveTuning(gameDir, slot, base,
shipped)` clones the stock part's IDE row, shop item, price row, `link` to its mirror and its place on the
`carmods.dat` line, under a new name and a new id. Everything is read from the built `data/`; the module's
own header states the two rules it turns on — the TXD column decides base-specific vs generic, and the name
ceiling is **refused, not truncated**.

**A replacement car is the same operation with `base = slot`.** The work is to lift that module to serve
both callers, not to write it again.

## The one thing that must change: the derived NAME

Today's scheme is `<stock part>_<slot>`, and it **overflows on this very data**:

```
wg_r_lr_slv1_slamvan   20 chars   <-- over the 19-character ceiling, so today it REFUSES
wg_l_lr_slv1_voodoo    19 chars   <-- lands exactly on it
```

The ceiling is `docs/gta-sa-original/carmods-upgrade-ceilings.md` (an IMG entry name is 24 bytes including
`.dff`, so 19 characters is the last safe length) and it is now **field-confirmed at exactly 19**.

**New scheme: `<stock part>_<token>`, where the token is the shortest prefix of the slot name that is unique
across every slot in the built `vehicles.ide`, minimum 3 characters.** Derived, deterministic, no registry:
`wg_r_lr_slv1_sla` (16), `rbmp_lr_bl1_voo` (15). The suffix stays an APPEND for the reason plan 005 gives —
SA derives a component's flags from the name PREFIX, so nothing in the middle may move.

**Added cars keep working unchanged** (`_059veh` is already ≤ 19 for everything the fleet ships), but the
same token rule should serve them too so there is one scheme, not two — and it lifts a latent refusal: a
future added car whose base has a `misc_c_lr_rem1`-length part would be refused today at 21 characters.
Verified not currently hit: the `059veh` folder ships no `misc_c_*` part, so nothing has been dropped
silently.

## Steps

### 1 — Move the derivation into `vehicle-installer`, unchanged in behaviour — **DONE 2026-08-20**

`tuning.ts` → `tools/vehicle-installer/src/tuning-derive.ts`; `add-vehicles` imports it (it already imports
six modules from this tool). No behaviour change, no new name scheme yet. **Verify**: the add-vehicles suite
is green and `--rebake --kind sa --only 059veh` writes byte-identical `data/*` to the current build.

**Measured.** The move is byte-identical bar one line: the private `VEH_MODS_IDE` copy is gone and the
constant comes from `tuning-parts.ts`, which already exported the same value (`git show
HEAD:…/tuning.ts | diff` = those two hunks and nothing else). Both suites green, **25 files / 259 tests**,
`tsc --noEmit` and eslint clean.

The build check was done WITHOUT writing to the tree — an in-place rebake would edit the tree the bottle
matches. Instead the derivation was run from its new home over the real `build/original/sa` for all **115**
added slots (`slots=115 sha1=587bbaef34667a592396ddc70bf0358d02326f66` over renames+rows+links+shop, the
invariant step 2 will move), and `059veh`'s 10 derived rows were compared against what the tree actually
carries at ids 19051–19060: identical, columns and all.

### 2 — The token, and one scheme for both callers — **DONE 2026-08-20**

Derive the token (shortest unique prefix, min 3) from the slots in the built `vehicles.ide`; re-point both
callers at it. **Verify**: unit tests for the token — uniqueness across the full 212-slot table, the
minimum-3 floor, and the `copcarla`/`copcarsf`/`copcarvg` family, which needs more than three. Every derived
name of the current fleet ≤ 19, and the longest is reported.

**Measured.** `slotTokens` + `vehicleSlots` in `tuning-derive.ts`; `deriveTuning` now takes an options
object with the caller's `token`. Suites green, **25 files / 268 tests**.

| | |
| --- | --- |
| stock slots tokenised | **212, all distinct** — 142 at 3 characters, 33 at 4, 19 at 5, 2 at 6, 14 at 7, 2 at 8 |
| longest token | **8** (`monstera`/`monsterb`, which reach past `monster`) |
| longest derived name, stock `carmods.dat` | **≤ 19** where `_<slot>` overflowed |
| longest derived name, the added fleet | **16** (`fbmp_lr_rem1_059`), 46 parts, **0 over 19** |

**`vehicleSlots` reads the `cars` rows itself rather than through `parseVehicleDefs`**, which needs the
wheel columns and so drops the eleven boats (`predator` … `launch`). A slot missing from the table is a slot
two tokens can collide on, and nothing would say so.

**The cost the plan had not priced, and the user's call on it.** One scheme means the added fleet's 46
derived parts change name (`fbmp_lr_rem1_059veh` → `fbmp_lr_rem1_059`), and `data/vehicle-adds.txt` promises
ids BY NAME because a part id is in the player's save. So `renameAddsRows` moves the ledger row with the
name, keeping the id, instead of the part taking a fresh one and the old row reserving one forever.
Rehearsed against a copy of the real ledger: **161 rows in, 161 out, all 46 part rows moved, every id
identical, none left under an old name.**

### 3 — Replacement cars derive their borrowed parts

`applyVehicle` reads the slot's STOCK `carmods.dat` line, splits the folder's shipped parts into own and
borrowed, and runs the borrowed set through the derivation: new name, new id, IDE row cloned from the stock
part (**flags included** — see below), shop item and price row anchored after the stock part, `link` pair
kept whole, and the car's `carmods.dat` line repointed. **Verify**: 9 clashes → 0; the archive holds each
mod's own geometry under its own name; `blade` keeps `rbmp_lr_bl1` and `voodoo` gets `rbmp_lr_bl1_voo`.

### 4 — The guard that survives the fix

Two vehicle folders shipping the same part file name with DIFFERENT content is refused, naming both mods and
both sizes. After step 3 it should be unreachable from `vehicles/`, which is exactly why it is worth having:
it is the check that says so, and it still fires for anything the derivation cannot classify.
**Verify**: it fires on the pre-fix tree (9) and is silent on the post-fix one.

### 5 — `tuning_new_parts.txt` keeps only its real job

A part that exists NOWHERE in stock, with its own price, name and shop anchor. The blade's two hand-written
rows are removed from it: their names are borrowed, so they derive — and the hand-picked ids `1194`/`1195`
go with them, which also removes the crash of
[`veh-mods-col-and-the-upgrade-object.md`](../../../../docs/gta-sa-original/veh-mods-col-and-the-upgrade-object.md):
a derived row inherits the stock part's flags, and that is precisely why the added fleet's derived parts do
not crash while a hand-written `0` does.
**Verify**: `spl_b_lr_bl` and `bnt_b_lr_bl` no longer appear at ids 1194/1195; the shop previews them.

## Docs to update in the same change

- `docs/contracts/vehicles.md` — the borrowed-part rule, the derived name scheme, and what happens when a
  folder ships a part name that is neither its own nor derivable. This is a name that carries behaviour and a
  mod author cannot guess it.
- `docs/open-issues/vehicle-part-name-clash-between-mods.md` → `fixed/` with the measured before/after.
- `docs/gta-sa-original/carmods-upgrade-ceilings.md` — the 19 is field-confirmed; add what the new scheme
  buys in margin.
- `tools/vehicle-installer/docs/plans/009-tuning-new-parts.md` — its scope narrows in step 5.

## Measured (fill in as the steps land)

| | before | after |
| --- | ---: | ---: |
| part-name clashes in the built tree | **9** | |
| longest derived part name | **20** (refused) | |
| cars wearing another car's part | **2** (blade, slamvan) | |
