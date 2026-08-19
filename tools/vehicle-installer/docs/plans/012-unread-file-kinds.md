# 012 — The two file kinds the fleet ships and the installer never read

**Status: PLANNED 2026-08-19.** Part of [central plan 102](../../../../docs/plans/102-add-vehicles/readme.md);
opened by the 212-folder census (session 28) the user asked for: every file KIND under
`mods-src/original/vehicles/{models,new}` against what `applyVehicle` reads.

## What the census found

368 `dff`, 388 `txd`, 225 `txt` (205 `<slot>.settings.txt`, 9 `features.txt`, 2 `tuning_new_parts.txt`,
**8 `model-variations-extra.txt`, 1 `text.txt`**), 7 `cleo/` folders (7 `.cs`, 3 `.ini`), 5 `.DS_Store`.
Everything is read except the two in bold:

- **`model-variations-extra.txt`** — tug, baggage, linerun, petro, rdtrain, towtruck, tractor, utility: a
  section for `ModelVariations_Vehicles.ini` (`[tug]` / `Trailers1={{bagboxa}},{{bagboxb}},{{tugstair}}` /
  `Global=Trailers1` / `TrailersSpawnChance=95`, also `TrailersMatchColors`, `TrailersHealth` — keys the
  `ModelVariations.asi` strings confirm). The built `modloader/Model_Variations/ModelVariations_Vehicles.ini`
  is byte-identical to the mod's (`[Settings]` only): eight trucks ship trailer behaviour the game never sees.
- **`text.txt`** — slamvan: `SLASH Slamin Hood` / `SLACH Chromer Hood`, the GXT names of the two bonnets
  `tuning_new_parts.txt` already puts in `prices.CarMods`. Neither key is in the built `american.gxt`; the
  shop shows the parts nameless. The channel already in the build is CLEO's FXT loader
  (`build/original/sa/cleo/ResprayPrice.fxt`), and `text.txt`'s format IS `.fxt`'s (`KEY text`).

And a trap on the way: the settings file is found by the `.settings.txt` suffix, but the fallback is "the
first `.txt` that is not features/tuning" — a car with no settings file and either of the two files above
would have it parsed AS settings and warned "nothing recognised — STOCK". Today's seven settings-less cars
(the trains, maverick, vortex) ship only dff+txd, so it has not fired.

## Steps

1. **`model-variations.ts`** — parse the file as ini sections; merge each `[section]` into the built
   `modloader/Model_Variations/ModelVariations_Vehicles.ini` by SECTION NAME (replace the block if present,
   append if not; `[Settings]` untouched), idempotent. `{{name}}` inside a value resolves to the id of that
   model in the built tree's IDEs (for replacement cars every name is a stock slot, so this is a lookup; the
   allocation case is add-vehicles 004). Missing ini / mod 11 absent → warning naming the mod, nothing
   written. Called from `applyVehicle` after the settings merge.
2. **`fxt.ts`** — `text.txt` lines → `cleo/<slot>.fxt` (lowercase, CRLF as CLEO expects, one key per line);
   a key already present in another fxt the build carries → warning. Called from `applyVehicle`.
3. **The fallback** — the "first other `.txt`" settings fallback excludes every KNOWN kind (`features.txt`,
   `tuning_new_parts.txt`, `model-variations-extra.txt`, `text.txt`, and 013's `audio.txt`/`parked.txt`)
   instead of two; a car with none of the known kinds and no `.settings.txt` keeps the legacy fallback.
4. **Contract** — `docs/contracts/vehicles.md` §1: the two names, what each writes, and what a misspelling
   does (`model-variation-extra.txt` → silently not read, like every name on that page; the fallback then
   does NOT pick it up because of step 3 — say so).
5. **Fixtures + tests** — one manifest line each from the real mod files (the tug's and the slamvan's, by
   NAME across layers); tests: section replace vs append, `{{name}}` resolve + unresolved warning, fxt
   write + duplicate-key warning, the fallback exclusion. Negative cases first (project rule).
6. **Field** — `vehicle-installer --rebake original --kind sa --only tug slamvan` (seconds, the one-model
   instrument), deliver `data/` + `modloader/Model_Variations/` + `cleo/` to the bottle: the tug pulls a
   baggage trailer; the slamvan's bonnets have names in the shop.

## Measured

*—*

## What it does not do

- It does not generate trailer sections for cars that ship none, and it does not touch `[Settings]`.
- It does not validate ModelVariations' semantics (a trailer name that is not a vehicle is the mod's
  problem at runtime — we log the unresolved `{{name}}` and ship the line as authored).
