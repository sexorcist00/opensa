# 074·16 — Deep vehicle reflections & car paint

[← chain](readme.md) · owner of the rework the B5r v1 could not deliver

**Status: PARKED with a v1 in the tree (2026-07-14). The v1 look was REJECTED outright in the field and the
user asked for the full rework to be PLANNED rather than tuned round by round.** The code
stays in (it is data-correct and behind a config switch — `graphics.vehicleReflection.preset: 'off'` sets
`env.reflectionStrength = 0` and the whole term dies), so the game is never blocked on this.

The user's brief, verbatim in intent: **the car is the most important part of the game; the paint must read
like real automotive paint, AAA-grade, day and night — not a coloured fill with a highlight.**

---

## What v1 already does (and it is not the problem)

- Reads the **DFF's own material-effect plugins**: which env texture (`xvehicleenv128` for paint,
  `vehicleenvmap128` for glass), the RpMatFX coefficient, the SA reflection-plugin intensity, the specular
  level. Coefficient 0 = not reflective, which is how SA marks tyres and rubber. Per-vertex slots
  (`VehicleModelData.reflect`), unit-tested.
- Takes the reflection's **colour from the live sky** (the shared Preetham LUT + sun/moon discs + the cloud
  dome), not from SA's textures — those are baked DAYTIME images (a painted horizon; for glass, literally a
  sunset photograph), so sampling them raw means a car reflects a sunset at midnight.
- Clearcoat Fresnel, a metallic-flake micro-normal anchored in model space, a blurred/sharp reflection pair,
  specular from the sun, the moon and the light pool (street lamps sliding along a bonnet at night).

None of that is wrong. It is simply **not enough**, for three reasons that no constant can fix.

## Why v1 cannot look AAA — the three root causes

1. **We reflect the SKY, not the WORLD.** Buildings, palms, kerbs, the road, the car next to you — none of
   them appear in the paint. A car that reflects only a smooth sky has nothing recognisable in it, and the
   eye reads that as "tinted plastic". Every AAA car reflects a real environment.
2. **SA panels are FLAT and their normals are flat.** On a flat quad the mirror direction is CONSTANT, so
   even a perfect mirror paints a constant colour. Flakes disguise this; they do not fix it. AAA cars are
   dense, curved, and carry normal maps. **This is a DATA problem**, not a shader problem.
3. **We have no tonemapping.** The scene renders to rgba16float and the post pass composites to the sRGB
   swapchain with no filmic curve, so an HDR highlight simply clips to flat white. The "depth" in AAA
   reflections is largely the tonemapper's roll-off plus bloom — without them, bright reflections look like
   paper cut-outs, which is exactly the field verdict.

There is a fourth, quieter one: **the car does not sit in the world** — no contact shadow, no ambient
occlusion under the body — so however good the paint gets, it will still look pasted on.

---

## The rework, ordered by dependency

Each step is a real piece of engine or pipeline work, not a tweak. The order matters: 1 and 2 are load-bearing
for everything after them.

### 1. Tonemapping + bloom on the scene target — the prerequisite

Without a filmic curve, every later item's highlights clip to white and the whole exercise is wasted.

- ACES (or Uchimura/AgX) applied in the post pass, which already owns the 16f → sRGB composite (074/09).
- Bloom on the bright-pass the godrays already compute — reflections and lamps bleed properly.
- **Gate:** a blown sky reflection on a wing keeps its colour and rolls off instead of clipping to paper white.
- **Risk:** this changes the WHOLE image, not just cars. It needs its own field pass against the prod look and
  its own bench row. It may well belong to plan 09 rather than here — decide at the start.

### 2. A real environment probe (the reflection SOURCE)

A cubemap (or octahedral 2D) probe of the ACTUAL scene, centred on the player's car:

- rendered from the existing world/sky passes into a small target (64²–128² per face), refreshed on a budget
  (one face per frame, or a full refresh every N frames — the world is static, so this is cheap);
- a **roughness MIP chain** (prefiltered IBL, split-sum approximation) so paint, glass and chrome each sample
  the blur they deserve — this is what our `mix(sharp, blurred, roughness)` hack is standing in for;
- falls back to the current analytic sky when no probe exists (parked cars far away, the lab).
- **Gate:** you can recognise a building in the paint.
- **Cost target:** ≤ 0.5 ms GPU amortised; must not regress the bench.

### 3. Screen-space reflections for the near field

The probe cannot see what is right next to the car (the road under it, the car alongside). SSR over the
existing depth + scene colour, composited UNDER the probe where it has no hit.

- **Gate:** the road and the neighbouring car appear in the door panels; no smearing at screen edges.
- **Risk:** the classic SSR failure cases (off-screen, disocclusion) must fall back to the probe cleanly.

### 4. Vehicle geometry & normals — the DATA half

The flat-panel problem is upstream of the renderer:

- **normal smoothing / crease-angle recompute** for vehicle bodies (the deferred idea
  `docs/ideas/0.4.0/plans/06-normals-smoothing` covers the world; vehicles need the same treatment and are a
  better first target — the panels are large and the artefact is obvious);
- optional **body normal maps** (procedural panel-line/orange-peel detail, or authored) — orange peel is a
  real property of car paint and reads instantly;
- consider light **tessellation/smoothing** of body panels at build time in the vehicle builder.
- **Gate:** a bonnet shows a continuous reflection gradient, not one flat patch per triangle.

### 5. A proper car-paint BRDF

With 1–4 in place, the shading model can finally be honest:

- two lobes: a coloured **base coat** (diffuse + subtle metallic flake) under a **clearcoat** GGX lobe;
- split-sum IBL against the probe's mips (the correct version of v1's `mix(sharp, blurred)`);
- **flakes done right**: density/size in model space, faded with distance and screen derivatives, feeding a
  separate narrow lobe — flakes are what make paint sparkle, and also what make it ALIAS;
- **specular anti-aliasing** (Toksvig / normal-variance), without which flakes + sharp GGX crawl and shimmer
  at any distance — non-negotiable once flakes exist;
- dirt/wear from the DFF's own grunge texture, so the paint is not uniformly showroom-fresh.

### 6. Grounding the car

- contact shadow / SSAO under the body, plus a soft ground shadow, so the car belongs to the road;
- (later, with 0.5.0/05 weather) a **wet look**: rain raises clearcoat gloss and drops roughness, which is
  where car paint looks its absolute best — worth planning for from the start.

---

## Decision log

- **2026-07-14 — v1 REJECTED in the field, deep rework parked here.** Two shader rounds (an additive sky term,
  then a clearcoat with HDR sky + clouds + flakes) both read as "matte paint with a highlight". The failure is
  structural (sky-only source, flat panels, no tonemapper), not numeric. The user's call: leave v1 in the
  tree, plan the rework properly rather than iterate on constants.
- The v1 numbers, for whoever picks this up: `REFLECT_HDR`, `REFLECT_GROUND`, `CLEARCOAT_F0`,
  `PAINT_ROUGHNESS`, `PATTERN_MIX`, `FLAKE_SCALE`/`FLAKE_AMOUNT`, `SPEC_POWER`/`SPEC_GAIN` in
  `packages/engine/src/render/shaders.ts` (the `rigid` module). The escape hatch is the config preset.
- **Prod comparison — VERIFIED IN CODE, and it answers the natural objection ("but prod managed without all
  that, and it looked fine"):** it did NOT
  manage without it. The three path already HAS items 1 and 2 of this plan, which is exactly why it looks
  better than our v1:
  · **tonemapping** — `plugins/postfx.plugin.ts:183` (`ToneMappingEffect`), switchable via
  `graphics.toneMapping` / `toneMappingMode` (`game.ts:684`). Its highlights roll off; ours clip flat.
  · **a real prefiltered environment probe** — `plugins/vehicle-reflection/vehicle-reflection.plugin.ts:83`:
  a `CubeCamera` into a `WebGLCubeRenderTarget` with **`generateMipmaps: true` + `LinearMipmapLinearFilter`**,
  i.e. a roughness MIP chain. Our `mix(sharp, blurred)` is a hand-rolled stand-in for precisely this.
  · plus `MeshPhysicalMaterial` clearcoat (`presets.ts` → `enhanced`: clearcoat 1, roughness 0.15).
  The own engine has NEITHER a tonemapper NOR a probe. That is the whole gap — not shader constants.

## Done means

Side-by-side against the three path at noon, dusk and midnight: our paint reads at least as deep as prod's,
with recognisable world content in the reflection, a stable (non-crawling) flake sparkle, and street lamps
sweeping across the bodywork at night. Bench: ≤ +1.0 ms GPU p95 at 2× retina for the whole stack.
