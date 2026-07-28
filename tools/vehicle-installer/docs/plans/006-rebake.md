# 006 — Rebake: the vehicle half against an already-built game

**Status: ✅ Implemented 2026-07-28.** `--rebake <game>` re-installs and re-converts the mod cars of a game
that is ALREADY BUILT, in place, instead of running the whole pipeline to see one changed row.

## Why

A vehicle round changes a handling value, a model, or one detail of one car — and then costs a full build to
look at. Measured on the real gostown tree: **one car in 3.6 s**, **all 12 in 26 s**, against minutes for the
pipeline. The turnaround is the feature.

## What it does, per mod folder under `mods-src/<game>/vehicles`

1. **Settings → the BUILT `data/*`.** The same `applyVehicle` the install uses, with its archive step off
   (`{ img: false }`): the merges are replace-by-model, so running it twice changes nothing the first run did
   not already do. Verified by an idempotence test.
2. **`features.txt` → `data/vehicle-features.txt`, merged per model.** Rewriting the table from the rebaked
   subset would drop what every other car declared — rebaking ONE car must not silently disarm the rest.
3. **`.dff` + `.txd` → `<model>.osm`.** `openGameDir(target, [modFolder])` gives the converter a composite
   filesystem: the mod folder SHADOWS the built tree, so the car's own geometry and dictionary come from the
   mod while the shared `vehicle.txd` and the plate rasters come from the game it is being baked into. Then
   `buildVehicleOsm` (opensa-pack's own, not a copy) and `encodeOsm(sections)` — byte-identical to what a
   full pack writes.
4. **Replace the archive entry.** `rewriteModelArchives` with `near: <model>.osm`: `near` resolves while the
   original is still present, so the entry is replaced in whichever `models/*.img` holds it. No delete, no
   rebuild of archives that changed nothing.

Order matters: every car's DATA lands before any car is CONVERTED, because the conversion reads the merged
`vehicles.ide` (txd name, wheel scale) and `vehicle-features.txt` back out of the target.

## What it deliberately does not do

- **The raw `dff`/`txd` are NOT written into the archive.** In a converted tree a car is one `.osm` and the
  pack has already deleted the pair; putting it back adds entries the game does not read.
- **It cannot add a car the built game never had.** A new model needs its `vehicles.ide` id in the pak's own
  tables — that is a full build. Such a car is REPORTED (`unplaced`), never half-installed.
- **It is not a transaction.** If a conversion throws, that car's data rows are already merged. They are the
  rows the next full build would write anyway, and the report says which model failed.

## API and CLI

```ts
rebakeVehicles({ inPath, targetPath, only? }): RebakeReport   // @opensa/vehicle-installer/rebake
```

```sh
tsx tools/vehicle-installer/src/cli.ts --rebake gostown                 # every mod car
tsx tools/vehicle-installer/src/cli.ts --rebake gostown --only previon  # one car — the fast path
```

Defaults follow the canonical layout (plan 079): `--target build/<game>/opensa`, `--in
mods-src/<game>/vehicles`. Both are overridable for a tree that lives somewhere else.

## Verification

`src/rebake.test.ts`, against the real `tests/original` zr350 (a fixture is one manifest line, and a real car
falsifies what a synthetic one confirms): a target that is not a built game throws; a model no archive holds
is reported instead of half-installed; `--only` leaves every other entry byte-identical; a rebaked entry
parses back through `readVehicleOsm` with its pop-up pod detected from the mod's `features.txt`; and a second
run writes the same bytes.

Field-checked the same day on `build/gostown/opensa`: `--only previon` in **3.6 s**, all 12 mod cars
(295.1 MB of `.osm`) in **26 s**, `data/handling.cfg` byte-identical (same md5) after both, and the rebaked
`previon.osm` reads back with its 145 submeshes and `misc_a` pod.
