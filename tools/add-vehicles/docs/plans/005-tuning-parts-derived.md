# 005 — Tuning parts, derived (no table)

**Status: PLANNED 2026-08-19.** An added car ships its base's tuning parts re-modelled to fit it, under the
STOCK part names (`wg_r_lr_rem1.dff` in `059veh (remingtn)`). Those names must NOT reach the archive — they
would overwrite the stock part for the base car — so each gets a new unique name, and everything the game
knows about the stock part is cloned under it. The old tool did this with a hand-written table per car
(recon §"Tuning parts"); this plan derives every value from the built `data/` and from the name itself.

## The derivation, per part dff whose base name is a stock part of the car's first `(base)`

| output | derived from |
| --- | --- |
| new name | the stock name's PREFIX (everything up to and including the component token the game reads in `SetupVehicleUpgradeFlags`: `wg_l_lr_`, `exh_lr_`, `spl_b_lr_`, …) + a slot token + the stock suffix digit: `wg_l_lr_` + `v059` + `1` → `wg_l_lr_v0591`. Prefix kept = behaviour kept; **≤ 19 chars or refuse**; unique by construction (the slot is unique) |
| `veh_mods.ide` row | the stock row's trailing columns (`drawDist, flags`), `txd` = the ADDED car's slot (the part textures live in the car's TXD — the old tool did this and it is how the stock rows work: `exh_lr_rem1, remingtn`), a new id from the allocator (002) |
| `shopping.dat` | the stock part's `item` in its section + its `prices` line, cloned under the new name after the stock one (012/009's insert-after-anchor) |
| `carmods.dat` `link` | if the stock name is one side of a stock `link` pair and the OTHER side is also shipped → `link <newLeft>, <newRight>`; if only one side is shipped → warning, no link (a wing without its partner is the author's gap) |
| the car's `mods` line | the base's carmods line with: stock parts shipped → their new names; base-specific parts NOT shipped → dropped (they fit the stock body, not this one); generic parts (nitro, and anything the base line names that is not a base-specific part — decided by "does the base's carmods line own it and does no other car's") → kept as-is |
| `tuning_new_parts.txt` | as 009, with `<:id>` allowed on the rows (002's allocator) |

## The guards (this is the plan that must refuse, see `docs/restrictions/sa-target.md`)

- **`link` pairs game-wide ≤ 30** (stock 23; each shipped wing pair costs 1): counted on the built
  `carmods.dat` AFTER this car; over → REFUSE naming `asi/perfect-vehicle` plan 002 and the count. The
  refusal is the in-reserve trigger — when the plugin ships and is detected in the tree (its `.asi` beside
  `perfect-map.asi`), the guard reads the lifted number instead.
- **Parts on the car's `mods` line ≤ 16** — same refusal shape. The guard lives in `vehicle-installer`
  (`carmods-guard.ts`) so a REPLACEMENT car's line is counted too (silent today).
- **Name ≤ 19 chars, prefix recognised** — a stock name whose prefix the derivation does not know is refused
  (better than a guessed prefix that drops the part's behaviour).
- `assertCarmodsModels` (009) stays the acceptance test: every token resolves.

## Steps

1. Prefix table = the list `SetupVehicleUpgradeFlags` switches on (from gta-reversed, cited in
   `docs/gta-sa-original/carmods-upgrade-ceilings.md`), as DATA with its source; a test pins it.
2. The derivation above as pure functions over (base carmods line, stock veh_mods rows, stock shopping,
   stock links, shipped part names, slot) → (rows, items, prices, links, line, renames); tests per output,
   negative first (unknown prefix, > 19, one-sided link, over-16, over-30).
3. Rename at IMG stage: the dff ships under the NEW name; the stock name never enters the archive.
4. Verification on `059veh (remingtn)`: 10 parts → 10 new rows, 10 shop clones, 2 links, a 13-part line;
   `assertCarmodsModels` green; counts 23 + 2 = 25 links.
5. Field: the car in the mod shop shows its parts with the base's names and they fit.

## Measured

*—*
