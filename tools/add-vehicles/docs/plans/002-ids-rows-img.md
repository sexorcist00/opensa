# 002 — Ids, the four rows, the IMG

**Status: BUILT 2026-08-19.** The part of an added car that IS a replacement car — once it has an id.

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

**Built 2026-08-19.** `tool-kit/free-ids.ts` (the pure allocator + `usedModelIds` over `data/` and
`modloader/`), `add-vehicles/ledger.ts` (`data/vehicle-adds.txt`, merged so an `--only` run does not
unpromise the rest), `add-vehicles/install.ts` (in place on the built tree, like `--rebake --kind sa` — an
added car is added to a build that already exists, so there is no `--out` to wipe; the plan's `--out <tmp>`
was dropped for that reason). `applyVehicle` gained an `id` option that substitutes `<:id>` in the decoded
settings text; a folder without the placeholder is refused, naming it.

**The full run, on an APFS clone of `build/original/sa`** (`cp -Rc`, instant, so a 5.7 GB tree is a free
scratch target — worth remembering):

| | |
| --- | --- |
| 115 cars installed | **5.0 s**, ids **19 001–19 115** contiguous |
| `vehicles.ide` / `handling.cfg` / `carcols.dat` / `carmods.dat` | +115 rows each |
| the vehicles archive family | 2 members (1.87 + 1.23 GB) → **3** (1.87 + 1.88 + 0.72 GB), **+1.37 GB**; `vehicles3.img` registered in `gta.dat` |
| FLA id pools | DFF 15 596 → **15 711**, TXD 5 177 → **5 338** of the configured **6000** (margin 662; the 46 part DFFs of plan 005 are still to come) |
| ledger | 115 rows, sorted |
| a second run | **byte-identical** across `vehicles.ide`, `carcols.dat`, `vehicle-adds.txt` and the archives |

**Two real defects fell out of the idempotency check, and neither was ours to expect:**

1. **`handling.cfg` refused a digit-leading id.** `parseHandling` (and `mergeHandling`, and `stripHandling`)
   took "a car row starts with a letter" as the rule; an added car's handling id IS its slot (`001VEH`), so
   the whole handling block was dropped — the car installed and would have run STOCK physics, with one
   warning that named the line and not the reason. The game decides by the first character only to spot `;`
   and the punctuation-marked sub-tables (`!` bike, `$` flying, `%` boat, `^` anim), so the rule is now one
   shared `isHandlingCarLine` in the parser package, used by all three.
2. **The palette merge was not idempotent, and it walks a fixed-size table.** `addPaletteColors` appended a
   mod's custom colours on EVERY run: the shipping build carries three colours twice, and the second install
   pass grew the palette by five rows and re-pointed cars at the new ids. Fixed (RGB + description = the same
   colour, reused). The ceiling it was walking is now recorded —
   `docs/gta-sa-original/vehicle-colour-table-128.md`: the table is **128**, stock ships 127, the build
   carries **140**, the added cars take it to **145**. WARNED on every install path, not refused, because
   the 128 comes from FLA's stated default rather than a disassembly. **Raising `Vehicle colors` in the FLA
   ini is the free fix and is the user's call.**

Tests: 13 (`free-ids.test.ts` 8, `ledger.test.ts` 5) + 2 palette-idempotency cases; tool-kit 144 green with
add-vehicles, vehicle-installer 185.

`checkImgIdBudgets` stays pmb's (it already counts every archive, and a tool importing the builder would
invert the dependency) — the numbers above were read with the same rule and are the input to plan 007.
