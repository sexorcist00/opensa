# 084 — vehicle appearance and dynamic-model lighting

**Status: OPENED 2026-07-20**, mid-field-round, by the user's verdict "our vehicle appearance is in very bad
shape". Two rows were diagnosed and shipped inside that same round and are recorded here as measured
history; the rest are open and one of them needs a decision before any code.

Scope: how a VEHICLE looks — geometry conventions, paint, reflections, and the lighting a dynamic model
receives. Vehicle _physics_ is [081](081-vehicle-physics/), the camera is [080](080-cinematic-camera/).

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

### 1. Night level of dynamic models vs the map

After row B the gap is roughly 2.5× instead of 5×. There is no truth in the data here — "a car must not look
like a light source" is the whole specification, so this is one constant and a field round, not an analysis.
Cheapest open row; do it first.

### 2. Reflections — DECISION NEEDED before any code

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

### 3. Ambient occlusion for dynamic models

Row B restored shape from orientation; it cannot darken a panel gap, a wheel arch, or the contact with the
ground, because nothing in the dynamic path knows about occlusion. Prod covered this with SSAO, which is
gone. Baked AO exists (opensa-pack, on by default) but bakes into the MAP — a dynamic model gets none.

Options, not yet chosen: screen-space pass (closest to what was lost, covers peds too, costs GPU — see
row 4 before adding load); baked per-vertex AO in the model (free at runtime, but a modloader car must be
computed at spawn and comet is 83 k verts); contact shadows only (cheap, fixes the ground contact, does
nothing for panel gaps).

Judgement: hold until rows 1 and 2 are field-judged. There is a real chance AO turns out to be polish rather
than necessity once the level and the reflections are right.

### 4. Performance — DIAGNOSED, and it is not a vehicle row

Opened as "37 fps at night". **The whole investigation is WITHDRAWN (2026-07-20).**

Every measurement it rested on was taken through the folder picker, and the folder picker does not select
the world: `engine-canvas-host.tsx:264` always fetches the pak from `public/pak-map`. No run measured the
pak it was labelled with, so the bisect, the "it is the improved map" conclusion, the street-level numbers
and the `?scale=0.75` decomposition all measured an unknown world. The datasets are deleted from
`docs/benchmarks/`.

What survives: the `ganton-noon` / `ganton-night` scenes in `bench-scenes.ts` (street level was the right
instinct), and the standing observation that free play at Ganton is heavier than any pre-existing bench
path reported. Nothing else.

The perf row leaves 084 either way — it is not vehicle appearance. Fix the pak source first, then measure
a clean map. See the memory note `pak-source-public-shadow-bug`.

### 5. Peds inherit row B's root

`vsPed` is documented "No prelit — peds are dynamically lit", i.e. the same flat indirect term with the same
consequences. Deliberately not fixed inside a vehicle round so the two verdicts stay separable; it belongs
to the ped-bug pass that follows this one.

## Ground rules

1. **Field verdict decides.** Nothing here has a correct value derivable from data except row A's wheel
   diameter, which is already done. Rows 1–3 end with the user looking at the game.
2. **One change per round.** Row B deliberately fixed shape and not level for this reason.
3. **Measurements into this doc** as each row lands (the standing rule), with the user's verdict quoted.
