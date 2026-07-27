# 089 — Vehicle particles: tyre smoke, skid marks, impact smoke

**Status: OPENED 2026-07-27** by the user's brief, after the 081 physics chain reached the point where the
car does things the eye has no evidence of: it locks its wheels, it slides, it hits things — and nothing
appears on screen. Vehicle _physics_ is [081](../081-vehicle-physics/); this plan is what the physics LOOKS
like.

**The brief, verbatim in intent**: hard braking and drifting must leave marks under the car and smoke from
under the wheels; a hard impact into an object should also puff some smoke. Marks get **darker the harder
the slide** and lighter for a gentle one, each mark **fades in from fully transparent at its edge** rather
than starting as a hard stripe, and marks **disappear after 5 REAL seconds** — wall-clock, not game time.

## What the game ships for it (verified in the built game, 2026-07-27)

- **`particle.txd` → `particleskid`** — the skid-mark texture. That whole dictionary is 35 textures
  (shadows, coronas, `txgrassbig*`, `particleskid`).
- **`effectsPC.txd` → `collisionsmoke`** — the smoke the brief names for the wheels. The same dictionary
  carries `smokeII_3` (which `prt_wheeldirt` uses), `bullethitsmoke` (`prt_sand`), `smoke`, `smoke4/5`.
- **`effects.fxp`** already parses into `FxSystem`/`FxEmitter` with keyframed tracks, and the library
  (`effects.fxp` + `effectsPC.txd`) is loaded at boot by `apps/web/src/ui/engine-particles.ts`.

## What the engine has, and the one thing it does not

Shipped (plan 044 + the 074 engine port): the fxp parser, `bakeFxSystem`/`bakeFxInstances`, a sprite atlas
and **two instanced draw passes** (additive for DSTBLENDID=1, premultiplied alpha otherwise), and live config
under `graphics.effects`.

**But that path is baked and static.** Map 2dfx anchors are welded per cell, the particle lifecycle loops
entirely in the vertex shader off one time uniform, and the emission rate is approximated by a fixed
particle budget — "no spawn-rate simulation" is written into `docs/features/world-effects.md` as a known
gap. A wheel emits from a MOVING point, at a rate that depends on what the tyre is doing, and stops when the
slide stops. **That is the capability this plan adds**, and it is worth more than the three effects on top:
tyre smoke, impact smoke, bullet impacts, foot dust and the 081/10 surface effects all want the same lane.

Skid marks are not particles at all — they are a **decal ribbon**, and the engine has no decal system.

## Where the trigger data already lives

Nothing here needs new physics. The telemetry built in 081/01 samples, per wheel per fixed step:
`slipRatio` (longitudinal), `sideImpulse`/`forwardImpulse` (the friction circle — how a locked or sliding
wheel is already detected for `fTractionLoss`), `contact`, and the load. The handbrake channel is explicit.
So "this wheel is sliding, this hard" is a read, not a new mechanism — and reading it keeps the whole
feature controller-agnostic, exactly like the 081 systems.

Impact smoke has its source too: the contact-force events the damage system already drains
(`vehicle-damage.system.ts`, currently gated at a flat 300 kN).

## Steps

1. **The dynamic emitter lane.** A pooled, CPU-driven emitter feeding the EXISTING sprite passes: spawn at a
   world point with a velocity/size/colour envelope, age on the fixed step, recycle. Budget-capped and
   config-gated (`graphics.effects`). Verification: unit tests on the pool (spawn/age/recycle/cap, no
   allocation per particle) + a headless screenshot of one emitter.
2. **Tyre smoke.** `collisionsmoke`, spawned at the contact point of a wheel whose slip passes a threshold —
   rate and opacity from HOW MUCH it slips, so a locked-wheel stop smokes and a gentle corner does not. Ties
   into the same signal the handbrake slide uses. Field-tunable dials in the F2 physics tab, as with 081/09.
3. **Skid marks.** A decal ribbon per sliding wheel: quads extruded along the contact path, `particleskid`,
   **alpha from the slide's severity** (the brief's darker/lighter), **transparent at the ribbon's edges and
   at its start** so a mark grows in instead of appearing as a stripe, and a **5-second wall-clock fade** —
   the lifetime runs off the real clock, NOT the day cycle (a game hour is 60 real seconds here, so a
   game-time fade would be ~7× too fast). Ribbons are capped per car and per world, oldest recycled first.
4. **Impact smoke.** A puff at the contact point when a hit passes the strong-hit threshold, sized by the
   force, reusing step 1's lane and the damage system's existing event drain.
5. **Surface-driven wheel effects** — dust, grass, sand, gravel, mud, spray. **Depends on
   [081/10](../081-vehicle-physics/10-surface-types.md)**, which is what teaches a wheel its surface.
   The original's dispatch is known (`CVehicle::AddWheelDirtAndWater`: the surface's `W_*` flags choose
   `AddWheelGrass`/`Gravel`/`Mud`/`Dust`/`Sand`/`Spray`, and each gets the ground's brightness as a colour
   term — which is why SA's dust matches the ground it comes off). **The parameters are NOT recoverable**:
   those `CFx::AddWheel*` bodies are still stubs in gta-reversed, calling original addresses. They will be
   tuned by eye against footage, and that is a documented fit, not a port. The data is ready: of 179
   surfaces, **W_GRASS 23 · W_SAND 17 · W_MUD 13 · W_SPRAY 4 · W_GRAVEL 2 · W_DUST 2**, and the skid-mark
   type column is DEFAULT/SANDY/MUDDY (18 sandy, 34 muddy) — step 3's ribbon should read it once it can.

## Budget

Priced against the measurement in [081/07 §3](../081-vehicle-physics/07-presets-regression.md): the whole
vehicle slice is ~8 µs per car per fixed step and 0.605 ms at 80 live cars. Particles and ribbons for **80**
cars are not the target — the player's car and its near neighbours are. The cap belongs in this plan's
ledger as a number, with what it costs, measured on the bench sweep's `vehicles` field and the frame time.

## Acceptance

- Lock the brakes: smoke under the wheels and marks on the road, both proportional to the slide.
- Handbrake-flick a corner: the marks curve with the car and are darker than a gentle corner's.
- The marks are gone ~5 real seconds later, and a stationary game clock does not change that.
- A hard crash puffs smoke; a kerb tap does not.
- Frame cost inside the recorded budget, measured, in the ledger.
- Field: the user recognises the game's own look — this is a visual plan, so the verdict is by eye.

## Risks

- **Ribbon growth.** A car that slides for a minute must not accumulate geometry without a cap; the cap is
  designed in, not added after the first stall.
- **Real seconds vs game seconds** — the one explicit correctness trap in the brief.
- **Alpha sorting.** Marks are on the ground under everything; smoke is a translucent sprite. They must land
  in the passes that already exist, not open a third one.

## Ledger

_(pool sizes, thresholds, the measured frame cost, field verdicts)_
