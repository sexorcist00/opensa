# A new tuning part is given `0x200000` because parts that carry it do not crash

**Taken 2026-08-20**, plan [`vehicle-installer/014`](../../tools/vehicle-installer/docs/plans/014-borrowed-tuning-parts.md)
step 5.

## What it is

`withNoColFlag` (`tools/vehicle-installer/src/tuning-parts.ts`) ORs `0x200000` into the flags column of
every `veh_mods.ide` row this project writes for a part outside the stock upgrade block (ids 1000–1193),
whatever the author wrote and whatever the stock part it was cloned from carried.
`assertUpgradeCollision` (`upgrade-collision.ts`) then refuses a built tree where any part has neither a
`veh_mods.col` entry nor that flag.

## What it stands in for

**Knowing what bit 21 of an IDE flags column actually means to the exe.** The crash it prevents is
understood exactly — a tuning part is previewed as an ordinary `CObject` and the constructor dereferences
`CBaseModelInfo::m_pColModel` with no null check (`0x59F8B4`), while `gta3.img : veh_mods.col` carries
collision for exactly the 194 stock parts. What is NOT recovered is why the flag changes that outcome. The
honest version reads the bit's meaning out of the reversed source or the exe and says either "this is the
no-collision bit, so setting it is correct" or "this is something else, and the real fix is a collision
entry per new part".

## What it was judged on

Measurement over a real install, written up in
[`gta-sa-original/veh-mods-col-and-the-upgrade-object.md`](../gta-sa-original/veh-mods-col-and-the-upgrade-object.md):
every part with no `veh_mods.col` entry that carries the flag survives the shop preview (the added fleet's
46 derived parts, field-played), and both parts measured without it crash — twice in the field, and the
crash followed them when their ids were moved to 19701/19702, so it is the flag and not the id. Stock parts
are not evidence either way: all 194 have an entry.

The census the guard produced the day it was written: **stock `game-src/original` clean, `build/original/sa`
7 offenders** — the blade's two hand-written rows (`1194`, `1195`, flags `0`) and all five parts derived from
the tornado (`19074`–`19078`, flags `4096` and `0`, inherited from stock rows that carry no `0x200000`). The
original write-up predicted two of those seven.

## What would retire it

Reading the bit in gta-reversed / the exe. Two outcomes:

- it IS the "has no collision" bit — this stops being a hack and becomes a documented contract; the guard
  stays as it is;
- it is something else — then the flag is a coincidence that happens to route around the null read, and the
  honest fix is to give every new part a collision model (append entries to `veh_mods.col`, which nothing in
  this project writes yet).

## Blast radius

Only rows this project writes, and only outside 1000–1193. A part that gets the flag wrongly changes
whatever the bit really does to a model that exists only because we added it — no stock part is touched, and
`assertUpgradeCollision` fails the build rather than shipping a tree that crashes the mod shop. If the flag
turns out to be wrong, the parts affected are the ones listed in the census above plus whatever a mod adds
later.
