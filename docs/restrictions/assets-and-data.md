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

## A per-asset decision cached by CONTENT may not depend on its caller

`TexturePlanner` dedups textures by content hash and plans each one on FIRST use. Any decision the caller
supplies — plan 092's vegetation `preferCutout` was the live case — is therefore taken by whichever caller
the build happened to reach first, and every later caller silently inherits it. 38 of the map's TXDs are
shared between vegetation and non-vegetation defs, so this was not theoretical.

The rule for a new design: a cached per-asset verdict is either a pure function of the asset's bytes, or the
caller's preference is part of the CACHE KEY. Never a third thing.

**Caught:** no — the output is a plausible class, just the other one, and only on the machines where the
build order differs.

## A dictionary is not a material list

A model's TXD serves several models. "This dictionary contains a glass texture" says nothing about whether
THIS model draws it — plan 092's first glass field-control was picked that way and turned out to have
painted-on OPAQUE windows (`marinawindow1_256`, no alpha channel at all). Read the DFF's materials
(`scripts/debug/dump-dff-materials.ts`), not the dictionary's contents.

**Caught:** no — you get a real model, a real texture and a wrong conclusion.

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
