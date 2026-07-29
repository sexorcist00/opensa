# 093 — The world ambient term: the piece of SA's own formula the engine skipped

**Status: IN PROGRESS 2026-07-29.**
Spun out of map-optimizer plan 024 Phase 3b
([`tools/map-optimizer/docs/plans/024-broken-authored-vertex-data.md`](../../../tools/map-optimizer/docs/plans/024-broken-authored-vertex-data.md))
— read its diagnosis first; this plan only carries the ENGINE half.

## Why (the 024 evidence, compressed)

Field bugs: `gaz27_law` (a whole wall pure black at day), `sphinx01_lvs` (hard black facets),
`exclbr_hotl02_lvs` (black at day, fine at night), `flamingo01_lvs`. All are **authored day-prelit
black holes** — and the map-wide scan says the class is enormous and NOT a mod disease: 2 243 placed
models carry all-black day triangles on a healthy median; of the 186 with ≥100 such triangles,
**125 are vanilla**. Baking shadow to pure black was standard SA authoring practice, because the
original renderer lifts every vertex by an ambient term the shader below is missing.

The recovered formula (SkyGfx `shaders/vs/ps2BuildingVS.hlsl`, aap's PS2-accurate building pipe;
day/night blend confirmed in gta-reversed `CustomBuildingDNPipeline.cpp`):

```hlsl
OUT.Color  = IN.DayColor*dayparam + IN.NightColor*nightparam;  // dn blend
OUT.Color *= matCol / colorScale;                              // material colour
OUT.Color.rgb += ambient * surfAmb;                            // timecycle ambient × surfProps.ambient
```

`ambient = CTimeCycle ambient RGB × LightsMult` — **additive and normal-independent**. Our
`worldShade` runs `lit = prelit×sunIndirect×ao + sun×N·L + moon + local` with **no ambient floor**:
black prelit + a face angled from the sun = pure black, hard-edged against healthy neighbours.

Field proof of the mechanism (024 Phase 2): lifting `gaz27_law`'s day prelit to a luma floor of 40
on the DATA side ("стена теперь выглядит нормально") — i.e. the missing term, emulated per-model,
is exactly the difference. The fix belongs in the ENGINE, not in map-optimizer: repairing 2 243
models rewrites the original map's data; adding the term restores the formula the data was authored
against. (User decision 2026-07-29: engine level, explicitly.)

## The change

1. **Driver** (`packages/game/src/adapters/engine-environment-driver.ts`): read the timecyc `amb`
   column (already parsed — `TimecycHour.amb`, unused until now), linearize like every other timecyc
   colour, scale by a new `worldLight.ambient` knob (default 1), write `environment.ambientColor`.
   Parametric fallback (paks without timecyc): a fixed day↔night mix in the same range.
2. **Engine** (`packages/engine/src/engine.ts`): `Environment.ambientColor` + default; frame uniform
   grows 100 → 104 floats (`size: 400 → 416`) — a boot-time change, so the recorded-bundle staleness
   the uniform comment warns about does not apply; `probeFrameData` grows with it (it copies the
   frame array wholesale).
3. **Shaders** (`packages/engine/src/render/shaders.ts`): `Frame.ambient: vec4f`; `worldShade` gains
   `+ frame.ambient.rgb * ao` inside `lit` (AO multiplies the ambient term — our SSAO stand-in
   occludes ambient exactly like it occludes the prelit indirect); the `clutter` shader gains the
   same term (no AO channel there). The `rigid` path is NOT touched — its `DYNAMIC_INDIRECT`
   stand-in is a separate debt with its own interaction (024 records it).
4. **Config**: `WorldLightConfig.ambient` (scale, default 1, live-tunable in debug → Atmosphere like
   its siblings).

Magnitude expectation: midday LA `Amb ≈ (78, 83, 89)/255` → linear ≈ 0.07–0.09 — a floor, not a
flood; the existing calibration (`dayBrightness 0.85`) may need a small compensating trim, decided
in the field sweep, not pre-emptively.

## Field round 1 falsified that expectation — vanilla day `Amb` is ~ZERO

First field check (gaz27_law, noon): no change, and the new `WORLD AMBIENT` knob was dead — it was
multiplying an honest zero. **Vanilla `timecyc.dat` authors EXTRASUNNY_LA noon `Amb = 11 0 0`**,
byte-identical in the 2004 PS2 `timecycp.dat` and a third-party original copy (the earlier
"78 83 89" expectation was simply wrong). The mod's whole day span (06:00–20:00) sits at 6–11/0–4.
Consequences, recorded:

- Real SA renders black-day-prelit walls **black at noon too** — buildings have no directional term
  (wall sun is entirely baked prelight), and the day ambient is negligible. The 024 Family B mod
  models are broken in the original game as well; the engine was accidentally SA-faithful.
- The timecyc term stays (it is the formula, and it matters at night — `35 35 35` ≈ lin 0.0126 —
  and in authored weathers), but it cannot fix Family B by day.
- The fix the field approved is therefore a DELIBERATE deviation: **`ambientColor =
  max(lin(Amb) × worldLight.ambient, ambientFloor × (1 − dn))`** — `max()` keeps every timecyc's
  authority whenever it authors more than the floor (custom/mod timecycs included; the user's
  design question), the `(1 − dn)` shape retires the floor at night so authored darkness survives,
  and `ambientFloor` default **0.13** is fitted to the field-approved `--prelit-floor 40` experiment
  (40/255 × 0.85 ≈ 0.133). `ambientFloor: 0` = strict SA parity, live on the
  `WORLD AMB FLOOR (093)` slider. Debt file: `docs/hacks/world-ambient-floor.md`.

## Built 2026-07-29 (same day)

All four change-list items landed: `Environment.ambientColor` (+ noon default), frame uniform
100 → 104 floats / 416 bytes (probe copy grows with it), `Frame.ambient: vec4f`, `worldShade`
`lit = (prelit×sunIndirect + ambient) × ao + …`, clutter `+ ambient` (no AO channel), driver reads
`sample.amb` → `lin3` → `× worldLight.ambient` (parametric fallback mixes day/night constants),
`WorldLightConfig.ambient` (default 1) + debug slider `WORLD AMBIENT (093)` (0–2). Suites: engine
286 ✓ (shader golden snapshot re-baselined — the mechanism working as designed), game 734 ✓ (new
driver case: amb column × knob), web 304 ✓ (capability rows extended). `tsc` + `eslint` clean.
Owed: bench sweep + field round below.

## Field + bench (2026-07-29)

- `gaz27_law` noon, main build, floor active: **"стена теперь выглядит нормально"** (user) — the
  Family B mechanism closed engine-side, no data touched.
- Bench ritual: all six scenes at the 120 Hz cap, `gpuMs.pass` 1.33–2.83 ms, p95 9.3–9.4,
  `lateCreates` 0 — a clean A/B against the 092 sweep (same pak, engine-only change), no cost.
  Row: `docs/benchmarks/opensa-engine/2026-07-29-headless-093-world-ambient-sweep.json`.
- Still owed: eyeball round on `exclbr_hotl02_lvs` / `sphinx01_lvs` / `flamingo01_lvs` + healthy
  controls (Ganton, SF) at noon AND at night (the floor retires at night by design — check nothing
  else moved).

## Verification

- Unit: engine suites stay green (fake-GPUDevice floors); driver test asserts `ambientColor` follows
  timecyc `amb` and the knob.
- Bench ritual (`?engine=opensa&bench=all`) — shader change = frame-cost mechanism (074 series row).
- Field: the 024 spots — `gaz27_law` (919.8, -1812.5), `exclbr_hotl02_lvs`, `sphinx01_lvs`,
  `flamingo01_lvs` — plus healthy control districts (Ganton, SF downtown) at noon and at night;
  night checks that the timecyc night `amb` does not wash the authored night design (the amb column
  is itself hour-authored, so the floor breathes with the clock).
- Numbers land here per phase; anything perf-visible additionally in `docs/benchmarks/`.

## Docs to touch in the same change

- `docs/architecture/` rendering/lighting doc — the world lighting formula gains a term.
- `docs/restrictions/engine-lighting.md` — record that the world indirect now has TWO parts
  (prelit × sunIndirect + timecyc ambient), and that removing the ambient term re-exposes the
  vanilla black-prelit class (silent — nothing catches it).
- 024 Phase 3b closes its decision with a link here.
