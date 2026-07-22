# 084 — vehicle appearance and dynamic-model lighting

**Status: OPENED 2026-07-20**, mid-field-round, by the user's verdict "our vehicle appearance is in very bad
shape". Two rows were diagnosed and shipped inside that same round and are recorded here as measured
history; the rest are open and one of them needs a decision before any code.

Scope: how a VEHICLE looks — geometry conventions, paint, reflections, and the lighting a dynamic model
receives. Vehicle _physics_ is [081](../081-vehicle-physics/), the camera is [080](../080-cinematic-camera/).

## The triage method that produced all of this

**Diff against prod.** `main:packages/renderware/src/three/build-vehicle.ts` and
`main:packages/game/src/plugins/vehicle-reflection/presets.ts` are the pre-migration implementations of the
same behaviours, and they WORK — the user confirmed both models render correctly on prod. Every defect below
was found by comparing our code to that file, not by reading our code alone. The WebGPU migration carried
some knowledge across with an error and dropped some entirely, and prod is the only written record of what
was dropped.

**Measure the actual asset, not a stock stand-in.** The first wheel diagnosis was wrong because it was
measured against `tests/original/dff/vehicle/admiral.dff` while the user was running the MOD admiral from
`mods-src/`. The two disagree on the one property that mattered (mesh centring). Probe the file the field
report came from.

**The suite cannot see this class of defect.** The fake GPUDevice records calls; it does not validate
shader-stage/layout visibility or the 16-varying fragment-input limit. Two shader defects shipped green
through 2325 passing tests in this session and were caught only by the user launching the game. If shader
work continues, a static WGSL check (count fragment inputs per entry point; cross-check bindings used by the
vertex stage against layout visibility) would close it without a GPU. Not scheduled.

---

## Shipped in this round

### Row A — wheels: three defects, all field-confirmed

The symptom was "one pair inward on comet, both pairs on admiral". That was two different code paths, not
one bug, and the split by model is what identified them.

1. **`instanceWheels` flipped the wrong side.** Prod mirrors the copies on the side the mesh was NOT
   authored on (`main:build-vehicle.ts:369, 423, 564` — all three sites agree); ours applied the 180° to the
   right. Both sides ended up facing inward. → admiral.
2. **The per-corner branch lost the flip entirely.** Prod mirrors there too; we placed each corner atomic on
   its own frame with no local rotation. The authored side happened to be right, so only the left was
   wrong. → comet (4 wheels), petro (6 wheels, left triple).
3. **`wheelScale` is a DIAMETER IN METRES, not a multiplier**, and `WHEEL_SCALE_BOOST = 1.25` was a patch
   over that misreading. Measured against the stock meshes the field names:

   | car      | `vehicles.ide` | mesh Ø | ratio |
   | -------- | -------------- | ------ | ----- |
   | infernus | 0.70           | 0.700  | 1.000 |
   | cheetah  | 0.68           | 0.688  | 0.988 |
   | admiral  | 0.68           | 0.700  | 0.971 |
   | petro    | 1.106          | 1.182  | 0.936 |

   Every stock mesh is already modelled at its target size. Multiplying by the field shrank every wheel by a
   third; prod's 1.25 recovered part of it (0.70 × 1.25 = 0.875, still 12 % short — hence its comment
   "wheels read a touch small"). Fitting to the diameter needs no fudge, and it is a no-op for a mesh
   authored at size, so ONE rule now covers all four wheel conventions instead of exempting two.

Also in row A: the authored side is now **read from the model** (`authoredWheelRight` walks up from the
mesh's frame to the first corner name — its own `wheel_rf`, or the `wheel_rf_dummy` its shared `wheel` hangs
under), and `instanceWheels` stopped discarding the dummy's own rotation. Every wheel dummy measured is
identity-rotated, so that rotation carries no side information today — but honouring it costs nothing and a
model that does use it now works.

Fixture coverage, one per convention: `admiral` (shared `wheel`), `comet` (lone `wheel_rf` + dummies),
`petro-4wheels`, `petro-6wheels` (+ middle axle). All four already existed in-tree and were orphaned.

### Row B — the dynamic indirect term was a flat constant

`rigidShade` lit every pixel of a car with `vec3f(frame.params.y)` — no normal, no position, no occlusion.
The map never had the problem: its indirect term is `prelit × params.y × ao`, i.e. baked lighting AND baked
AO, neither of which a vehicle has (not one of the game's 198 cars ships a prelit set).

Measured at full night (`params.y = 0.7`, `NIGHT_AMBIENT = [0.3, 0.32, 0.4]`):

| surface | formula                  | value     |
| ------- | ------------------------ | --------- |
| car     | `vec3f(0.7)`             | **0.70**  |
| map     | `nightPrelit × 0.7 × ao` | **≈0.13** |

**≈5× brighter than its surroundings, up to ≈9× against occluded map creases.** By day the same comparison
is 0.85 vs ≈0.51 — a 1.7× gap. So the defect is round-the-clock and only becomes visible when the sun stops
masking it, which is why it was reported as a night problem.

Shipped: `skyVisibility(normal)` — how much sky a surface sees, 1.0 horizontal down to 0.10 facing straight
down. Normalised against the SKY rather than the hemisphere mean, deliberately: mean-normalisation conserves
energy but brightens roofs and bonnets ~1.8×, and on a car already reported as too bright that would have
made the loudest surfaces worse. Scalar and per-pixel — a sky-COLOURED version needs the sky LUT, which blew
the 16-varying limit when passed per vertex and forced VERTEX visibility onto a fragment-only binding.
`params.y` was neutral before this, so no colour is lost.

User verdict: "got significantly better, edges read clearly, the model isn't as washed-out". Side effect: the car's
average indirect drops roughly half, which narrows row 1 below without closing it.

---

## Open rows

### 1. Night level of dynamic models vs the map — SHIPPED 2026-07-22

The map's indirect is `prelit x params.y x ao`; a car's was `params.y` alone. The two missing factors are
now supplied: `DYNAMIC_INDIRECT = 0.35` stands in for the mean prelit (SA map models average 88/255 luma),
and row 3's occlusion supplies the AO. Both land in one line of `rigidShade`:

```wgsl
let ambient = frame.params.y * DYNAMIC_INDIRECT * skyVisibility(normal) * in.local.w;
```

Found by a field probe, not by reading: the shader was temporarily patched to output its own terms as
colour channels and shot headless under the parked admiral. Measured at noon, BEFORE: `ambient` saturated
at ~1.0 on the underbody — a car's exhaust was lit as if it faced open sky.

### 2. Reflections — VARIANT 1 SHIPPED 2026-07-22 (the env-map gate is gone)

User's call after the exhaust round: drop the gate rather than build presets. `reflectionOf()` now reads the
material's data as a whole instead of demanding an env map:

- an env map with a coefficient of 0 stays MATTE and wins over everything — it is SA's own marker on tyres
  and rubber, and that was never in question;
- with no env map at all, an **untextured** material carrying the `reflection` plugin becomes reflective and
  the plugin's intensity IS the coefficient. That is the exhaust / trim / bumper-iron shape, and it is why
  the mod admiral's exhaust rendered as flat 0.2 diffuse where prod showed dull chrome.

The narrowing to untextured is measured, not taste: the mods' exporter stamps `reflection` on every material
they ship, so honouring the plugin alone turned **100 %** of both field cars reflective (carpet, leather and
tyres included). Reflective share, before -> after: mod admiral 21 -> **26 %**, mod comet 35 -> **41 %**,
stock cheetah 42 -> 42 %, stock admiral 60 -> 60 % — it adds exactly the bare-metal parts and moves no stock
car at all.

**The dead env layer is gone too (same day).** `envLayer` (`reflect.x`) was handed to the fragment stage and
never read: `rigidEnv` reflects the live probe, so SA's baked env photo is not the colour source and the
texture name only ever acted as a flag. Removed the varying (location 8 is free again), and with it the
`resolveNamed` call that claimed an ARRAY LAYER for that texture on every car — including cars whose TXD
does not even carry it, which got a white stand-in layer for their trouble.

Texture array per model, before → after: stock cheetah 15 → **13** layers (3.8 → 3.3 MB RGBA), infernus
17 → 15, mod admiral 39 → **38** (39.0 → 38.0 MB), mod comet 24 → **21** @1024² (96.0 → **84.0 MB**). Two
layers per car is the usual saving (`xvehicleenv128` + `vehicleenvmap128`). `reflect.x` stays in the vertex
stream as a documented SPARE — the coefficient in `.y` is the reflective flag.

The preset option below stays as written: if reflection strength ever needs to be authored per CLASS rather
than per material, that is the shape to port.

#### The original decision note, kept

The user's report: no paint/reflection effect on hi-poly custom models, though it is there on low-poly stock.
The data is NOT missing — measured on the two mods in the field:

| model         | verts  | paint slots (primary/secondary) | reflective verts | envMap coefficient | reflection intensity |
| ------------- | ------ | ------------------------------- | ---------------- | ------------------ | -------------------- |
| MOD comet     | 83 008 | 16 261 / 1 862                  | 29 274 (35 %)    | **128**            | 8 / 38               |
| MOD admiral   | 90 609 | 14 200 / —                      | 18 624 (21 %)    | **128**            | 18 / 128             |
| STOCK cheetah | 3 836  | 1 542 / —                       | 1 605 (42 %)     | **255**            | 26 / 33 / 38         |

Mods ship half the coefficient and comet a third of the intensity — roughly 6× weaker overall — and
`neoReflAmount` multiplies straight by it. Prod never had the problem because its default `enhanced` preset
supplied `clearcoat: 1` and `reflectivity: 0.4` as **preset constants**, with the DFF coefficient as one
input among several rather than the only truth.

Corroboration already in our own shader: `CHROME_COEFFICIENT_FLOOR = 0.85`, commented "the surveyed mods
ship ~0.5 everywhere". A previous field round found exactly this and floored it for chrome only; paint was
left bare.

**The choice:**

- **Floor** — one constant beside the chrome one. Cheap, but a hidden clamp: the model's data says one thing
  and the render does another, with nothing in between to read.
- **Presets, porting prod's shape** — `clearcoat`/`reflectivity`/`roughness`/source named and explicit, the
  authored coefficient demoted to an input. More code; the interpretation becomes legible and extensible,
  and `main:presets.ts` is a working reference to port rather than invent.

**Recommendation: presets.** Reflection strength is an artistic parameter with no measurable truth (unlike
the wheel diameter in row A, where the data WAS the truth and the fudge was correctly deleted), and half the
mods ship 0.5 because it is the exporter's default, not a decision. This is also the shape the user asked
for at the top of the session: a thin format, one extensible interpretation layer.

### 3. Ambient occlusion for dynamic models — SHIPPED 2026-07-22

**Where it is computed is a user decision (2026-07-22): the shared BUILDER, never the converter.** Baking it
in opensa-pack would make a modloader car differ from a converted one; `buildVehicleModel` runs on both
paths, so the numbers agree by construction and the pack merely persists what the builder already produced.
The refused alternative is kept as a lever with its price in
[docs/performance/vehicle-ao-baking.md](../../performance/vehicle-ao-baking.md).

`vehicle/sky-occlusion.ts` — horizon mapping over a height field, not ray casting:

- the shown shell (`kind === 'body'` submeshes only) splats into a 32x32 "highest surface over this cell"
  grid; 8 azimuths x 8 cells of marching per vertex give the horizon angle, `1 - sin(horizon)` the sky left;
- **the normal weights each azimuth**, or the roof would darken the door skin under it. Measured on the mod
  admiral: body paint submesh went 146 -> 209 mean (of 255) once weighting was in;
- the LOD and the `_dam` twins are excluded from CASTING (they still receive). This is the convertible case:
  a `_vlo` blob would roof an open car;
- the result rides in the NIGHT set's **alpha**, which the builder had been filling with a constant 255 — no
  new vertex buffer, no `.osm` version bump, no second upload. The shader carries it to the pixel in
  `local.w` (the struct was at 15 of the 16 inter-stage locations, so a 16th was not available).

Measured, mod admiral (90 887 verts): exhaust group mean **122**/255, engine-bay bits 71, seats 45-55, body
paint 209, roof 255. Cost `skyOcclusion` 78 ms on that car, 8-20 ms on stock cars (3.8-4.8 k verts) — the
converted path pays it offline, a modloader car once at spawn.

Convertibles, up-facing seat surfaces (255 = open sky): feltzer **99**, comet 88, windsor 110 (its soft top
is modelled UP), against closed cars admiral 81, infernus 83, sultan 65, stallion 55. Field-checked in the
lab: the feltzer's open cabin reads lit, its footwell dark.

Still open in this row: contact shadow with the ground (nothing here darkens the ground under a car), and
peds (row 5).

### 4. Performance — CLOSED 2026-07-21, and it was never a vehicle row

Opened as "37 fps at night". The answer: **mod vegetation swapped in by the pmb `trees` stage**, 73 % of it
placed by a single mod ("39. Green Piece 1.47", since deleted). Removing it took ganton-noon from 13.72 to
7.63 ms of GPU pass, 53 → 82 fps. Nothing here belongs to vehicle appearance. Full analysis, asset audit
and the parked remedies: [`docs/benchmarks/opensa-engine/2026-07-21-layer-decomposition.md`](../../benchmarks/opensa-engine/2026-07-21-layer-decomposition.md)
(benchmark rows #21/#22). The history below is kept only to explain why the first attempt produced nothing.

**The first investigation was WITHDRAWN (2026-07-20).**

Every measurement it rested on was taken through the folder picker, and the folder picker does not select
the world: `engine-canvas-host.tsx:264` always fetches the pak from `public/pak-map`. No run measured the
pak it was labelled with, so the bisect, the "it is the improved map" conclusion, the street-level numbers
and the `?scale=0.75` decomposition all measured an unknown world. The datasets are deleted from
`docs/benchmarks/`.

What survived: the `ganton-noon` / `ganton-night` scenes in `bench-scenes.ts` — street level was the right
instinct, and they are the scenes that later carried the answer. The pak source was fixed in plan 079, and
the clean re-measurement is the layer decomposition linked above.

### 5. Peds inherit row B's root

`vsPed` is documented "No prelit — peds are dynamically lit", i.e. the same flat indirect term with the same
consequences. Deliberately not fixed inside a vehicle round so the two verdicts stay separable; it belongs
to the ped-bug pass that follows this one.

## Ground rules

1. **Field verdict decides.** Nothing here has a correct value derivable from data except row A's wheel
   diameter, which is already done. Rows 1–3 end with the user looking at the game.
2. **One change per round.** Row B deliberately fixed shape and not level for this reason.
3. **Measurements into this doc** as each row lands (the standing rule), with the user's verdict quoted.
