# Asset & data restrictions

**Every slot in this game is a mod target.** Today a model sits on `comet`, tomorrow on `admiral`; today a
texture is 256², tomorrow a mod ships it at 2048². A rule that names a slot, or a size, or a car, is a rule
that will be wrong in the next build.

## A rule must derive from what the asset CARRIES, never from the slot it sits in

Never hardcode a value for a specific car, model or asset. The rule has to read the asset itself — its
handling row, its geometry, its collision — so it applies to whatever ends up in the slot.

The worked example: when a car stood on its bump stops, the fix was **not** "stiffen that car" but "static
sag may not exceed a share of the travel the car actually has" — a rule that touched only the car violating
it. Pop-up headlights are the same shape: derived from the model (a `misc_*` part holding head-lamp faces,
opening angle from the mean normal), not from a per-car list. 49 stock misc models → 1 hit.

**Caught:** no. A hardcoded name works perfectly until someone swaps the mod.

## Texture sizes are asset-driven

Never hardcode a size that belongs to a source asset. Texture arrays derive their size from `max(assets)`;
fixed slots resample rather than throw.

**Caught:** partly — a mismatch usually shows as a visibly wrong texture, not an error.

## Dig out the original game's real formula before fitting a constant

The reversed SA source (`docs/links.md` → gta-reversed) carries the actual data→physics mapping, and it is
**greppable offline**: `curl -sS https://raw.githubusercontent.com/gta-reversed/gta-reversed/master/source/game_sa/<path>`
then grep it. WebFetch summarises and LOSES detail; curl+grep settled both `CollapseFramesCB` and the
misc-component question in minutes.

A fitted constant is acceptable only as a MEASURED, documented bridge — state what was fitted, over what
range, and its residual — and **it is a debt, not an answer**: it gets a file in [`hacks/`](../hacks/) in the
same change. The same goes for global tuning constants; each one is a place where the game's own numbers are
not being read yet.

**Caught:** no — this is a review discipline, and the hacks ledger is its only record.

## Judge a mod's 2dfx by `extract2dfxEntries`, never by `geometry.lights`

`lights` holds only type-0 entries. A count taken from it is silently short.

**Caught:** no.

## `.osm` indices are BYTES

Decode by `index16` or every number belongs to somebody else. This mis-read already produced one wrong
verdict (`scripts/debug/dump-vehicle-materials.ts` carries the warning).

**Caught:** no — you get plausible numbers for the wrong submeshes.

## A name that carries behaviour must be in `contracts/`

A file the pipeline looks for, a frame or material the converter reads, a data row a tool writes — a mod
author cannot guess these and a reader cannot grep for them. Misspelling one is **silent by nature**, so the
contract must also say what happens when it is spelled wrong. New conventions extend
[`contracts/vehicles.md`](../contracts/vehicles.md) / [`contracts/mods.md`](../contracts/mods.md) in the same
change.

The live example of the failure: `mod-installer` recognises IMG folders only at the TOP level and only by
exact name — `models/gta3img/` is copied as loose files the game never reads, and **the mod is silently
inert**, with no error and no report line.

**Caught:** no, by construction.
