# Build-time vs runtime restrictions

**A decision taken while the game is BUILT cannot be re-taken while it runs.** The mod folder is gone by
boot, the RW parsers are gone from the vehicle path, and the material names are gone from a converted model.
Any plan that wants the runtime to "just read it" has to check this list first.

## A vehicle exists only as its converted `.osm`

`loadVehicleData` resolves `<model>.osm` and nothing else; a car with no converted model raises
`No converted model for '<name>'` at spawn. There is no DFF fallback — it was removed 2026-07-28 with the
runtime modloader ([postmortem](../postmortem/runtime-modloader-overlay.md)).

The reason is this whole page in miniature: everything a car carries beyond raw geometry is baked in —

- its `features.txt` declaration (`UP/DOWN_LIGHTS`: a pop-up pod whose lamps carry no SA marker),
- its **plate slots** — after conversion the material NAME is gone and texture layers are model-local, so the
  tag in the `.osm` DESC is the only thing that can still say "this quad is a plate",
- its per-vertex sky occlusion, its wheel fitting, its door/submesh rig.

A car served from a runtime `.dff` would not spawn slower; it would spawn **wrong**.

**Caught:** yes — the spawn throws, and a test pins it.

## Editing a mod's data means rebuilding that car

`data/vehicle-features.txt` is written by `vehicle-installer` and read by `opensa-pack` while baking. Nothing
reads it at runtime. The same goes for a `*.settings.txt` handling/carcols row once it is merged into the
built `data/*`.

Turnaround is `vehicle-installer --rebake <game> [--only <model>]` — one car ≈ 3.6 s, all of gostown ≈ 26 s —
not a full pmb run.

**Caught:** no. A stale `.osm` looks exactly like a correct one.

## Mods are installed, never overlaid

`mod-installer` / `vehicle-installer` / `ped-installer` merge a mod into the game dir before it is packed.
There is no boot-time overlay; the VFS reaches the game unwrapped. A plan proposing "let the user drop a
folder in and see it" is proposing to ship the converter to the browser — see the postmortem above for the
shape a revival would need.

**Caught:** yes, trivially — there is no code to overlay with.

## Nothing about a vehicle lives in the pak

The roster is TEXT (`data/vehicles.ide`, parsed at boot), a spawn resolves `<model>.osm` **by name**, and the
pak manifest holds cells / textures / water only — no vehicle table, and `modelById` has no id range check.

This is what makes `--rebake` able to ADD a car on the id its mod declares. It also means a plan may not
assume the pak knows the car roster.

**Caught:** n/a — this one enables rather than forbids.

## The look is baked, so tuning a look parameter costs a re-pack

If a value is going to be iterated on, it belongs in the **shader**; only the anchor belongs in the bake.
Plan 090 learned this twice: baking a cabin SHAPE cost a re-pack per iteration, and the second attempt (bake
the distance, let the shader own the falloff) got it right and was still rejected on looks.

**Caught:** no — it costs time, not correctness.

Detail: [`postmortem/090-vehicle-cabin-at-night.md`](../postmortem/090-vehicle-cabin-at-night.md),
[`contracts/vehicles.md`](../contracts/vehicles.md).
