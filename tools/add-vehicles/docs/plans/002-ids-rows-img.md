# 002 — Ids, the four rows, the IMG

**Status: PLANNED 2026-08-19.** The part of an added car that IS a replacement car — once it has an id.

## Decisions

- **The window is 19 001–19 999** (the user, 2026-08-19, after the measurement: the built tree uses 0 ids
  there, 999 free in one run; demand today 161 = 115 cars + 46 re-modelled parts; the map allocators stop at
  19 000 — `docs/edge-cases/sa-formats.md` — so the windows never meet; FLA's DFF range ends at 19 999).
- **Deterministic**: ids are assigned in folder order (the slot sorted ascending, parts after their car),
  starting at 19 001, skipping any id the built tree already uses. A rebuild over the same source gives the
  same ids — parked cars and ModelVariations entries land in SAVES
  (`docs/gta-sa-original/fla-id-limits-are-part-of-the-savefile.md`), so an id that moved between builds is
  a save that spawns the wrong car.
- **The ledger records the id** (`data/vehicle-adds.txt`: slot, id, base(s), folder) and a rebuild reads it
  FIRST: a slot already in the ledger keeps its id even if the folder order changed; a new slot takes the
  next free. Deleting the ledger is the only way to renumber, and the tool says so when it does.
- `<:id>` is the only placeholder; a literal id in an added car's ide line is refused (it would be an
  author guessing the window).

## Steps

1. **`tool-kit/free-ids.ts`** — read every IDE the built tree loads (`gta.dat` + `modloader/` — the same
   walk `checkImgIdBudgets` does), return the used set; `allocate(window, used, ledger, slots)` pure and
   tested. Refuses when the window is exhausted, naming the count.
2. **`settings.ts` accepts `<:id>`** in the ide line (substituted before the existing classification; a
   literal id on an added car → refusal from add-vehicles, not from the parser).
3. **`applyVehicle({ id })`** — the existing IMG stage (dff/txd by name; `install.ts` already picks
   `models/vehicles.img` when the split tree has it, else `gta3.img` — `docs/architecture/img-archive-layout.md`:
   cars AND their shop parts belong there; added cars are NEW names, so no "replaces" warnings, but the
   writer's spill cap applies — 115 cars are ~1.5 GB more payload, priced in 007), the ide/handling/carcols/
   carmods merges, `features.txt`, `cleo/` — unchanged code, called with the id.
4. **Guards** — `checkImgIdBudgets` on the result (FLA TXD pool: up to 5 TXDs per car), an id-collision
   refusal (the allocator's used set vs the tree after install — belt and braces), the ledger written last.
5. **Tests** — allocator (window, skip used, ledger precedence, exhaustion), `<:id>`, the refusal of a
   literal id; an e2e over two fixture cars against a data fixture tree.
6. **Verification** — `add-vehicles --game build/original/sa --in mods-src/original/add-vehicles --out <tmp>
   --only 001veh`: `vehicles.ide` +1 row at 19 001, `handling.cfg`/`carcols.dat`/`carmods.dat` +1 each,
   `gta3.img` +2 entries, ledger 1 row; run twice → identical tree.

## Measured

*—*
