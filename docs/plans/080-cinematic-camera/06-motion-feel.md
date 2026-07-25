# 080/06 — Motion feel: bob, landing dip, impact shake, FOV kick (behaviours 7, 8)

The additive layer (`camera-motion.ts`) — the LAST transform before `CameraState`, applied on top
of the collision-resolved pose. Small numbers, big perceived quality; also the layer most likely
to cause discomfort, so it ships with a master off-switch and conservative defaults.

## Ground rules for this layer

- **Additive and bounded**: the layer outputs an offset (eye + look point moved TOGETHER for bob —
  translating both avoids the nauseating aim-wander of rotating bob) plus an optional small roll…
  no, **no roll** — roll is the fastest route to motion sickness and GTA V uses none on foot.
  Offsets are hard-capped at 0.15 m, below 04's collision margin (sphere radius ~0.35), so bob can
  never push the eye through a surface — the layer needs no casts of its own.
- **`reducedMotion: true` zeroes the whole layer** (and 05's FOV kick) — one config flag, one
  Camera-tab toggle. Default OFF (effects on), but every effect also has its own scale.
- All oscillators are phase-continuous (phase accumulates by dt; amplitude damps in/out) — no
  restarts, no pops when speed crosses a threshold.

## 1. Bob (#7)

- Phase driven by DISTANCE TRAVELLED (`phase += speed × dt × k`), not wall time — bob frequency
  tracks stride naturally and freezes when the player stops (amplitude damps to zero).
- Vertical bob at stride frequency + lateral bob at half frequency (the figure-eight); amplitudes
  `bobAmplitude × speedFactor`, first guess 0.03 m walk / 0.05 m run — SUBTLE; the field round
  tunes downward if in doubt. Airborne ⇒ amplitude target zero (jump arcs are already motion).
- No bob in vehicles (suspension provides the life; 02's vertical channel already transmits a
  damped version of it).

## 2. Landing dip (#8a)

- Landing edge = `grounded` rising while previous vertical velocity < −2 u/s (the controller has
  no landing event; the director derives the edge from the snapshot — readme constraint 8).
- Response: a critically damped one-shot — eye dips by
  `landingDipScale × clamp(|impactVz| / jumpSpeed, 0, 2)` (first guess 0.06 m for a normal jump,
  capped ~0.12 m) and recovers in ~0.25 s via `smoothDamp` back to zero. Look point dips at half
  amplitude so the frame pitches down a whisker — reads as knees bending.

## 3. Impact shake (#8b)

- Trigger: vehicle collision impulse (Rapier contact force on the seated car — the damage system
  already observes collisions; reuse its signal rather than adding a second listener) and, later,
  heavy landings above 2× jump speed.
- Shape: damped noise, NOT sine — two-octave value noise sampled at ~15 Hz, amplitude
  `shakeScale × impulseFactor` decaying with `exp(−t/0.3)`, offsets only (no roll), capped 0.1 m.
  Deterministic PRNG seeded per shake from the frame's tick counter (no `Math.random` — testability
  - the workflow/date rule of the repo).
- Queueing: a new shake REPLACES a weaker active one, sums with amplitude cap otherwise.

## 4. Sprint FOV kick (readme addition)

- On foot, `run` active and speed near `runSpeed`: fov target +2…3°, damped slowly both ways.
  Same channel 05 uses; trivially small — its only job is making sprint feel faster.

## Subtasks

- [x] `camera-motion.ts`: bob oscillator (distance-phased, damped amplitude), landing one-shot,
      shake generator (seeded PRNG), FOV kick; the additive combiner with the 0.15 m cap.
- [x] Unit tests: phase freezes at rest; amplitude continuity across walk↔run; landing edge
      detection from scripted snapshots; shake decays deterministically for a fixed seed; caps
      hold under sum; `reducedMotion` zeroes everything.
- [x] Vehicle impact signal plumbed from the damage system's collision observation into the
      snapshot (one number: peak contact force this frame).
- [x] Config + Camera tab: `bobAmplitude`, `bobCyclesPerMetre`, `landingDipScale`, `shakeScale`,
      `sprintFovKick`, `reducedMotion` (+ the two "full at" references).
- [ ] **Field round**: long walk (does bob read as life or as wobble?), stair runs, rooftop jumps,
      curb-hopping in a car, a deliberate wall crash. Explicitly ask for a comfort verdict, not
      only a looks verdict; tune down by default.

## Acceptance

- Effects visible in A/B (zero the channel on the debug Camera tab) but individually deniable in the tab;
  comfort verdict OK.
- All caps proven by test; collision layer untouched (motion applied after, bounded below margin).

## Ledger

### 2026-07-25 — code complete, AWAITING THE COMFORT FIELD ROUND

**What landed** — `apps/web/src/ui/camera/camera-motion.ts`, pure, stepped by the director and applied as
the LAST transform (after collision AND the floor guard, which is why the cap matters):

- **Bob** phased by DISTANCE travelled, so the frequency tracks stride for free and freezes at a standstill
  without any threshold logic. Vertical at stride frequency, lateral at half (the figure-eight), amplitude
  damped in/out by gait — crossing walk↔run eases, never steps, and the phase never restarts.
- **Landing dip**: an instant drop on the touchdown frame, recovered by `smoothDamp` over 0.25 s. The look
  point dips HALF as far, which is what pitches the frame a whisker and reads as knees bending.
- **Impact shake**: two-octave value noise at 15 Hz, decaying exponentially, from a deterministic per-shake
  seed (an LCG stepped per hit — no `Math.random`, so a crash replays identically in a test). A stronger hit
  takes over a weaker one with a fresh seed; a weaker one only adds amplitude.
- **Sprint FOV kick**: a couple of degrees as a run tips into a sprint. It contributes to the FOV TARGET, so
  it eases through 05's existing damp instead of getting its own channel.
- **Caps**: each effect is bounded and the SUM is capped at `MOTION_CAP` 0.15 m — inside the floor guard's
  0.3 m margin and well inside collision's sphere, so the layer needs no casts of its own. Proven by a test
  that fires a crash landing at a sprint with every scale cranked to 1.
- **No roll anywhere**, and eye + look point move TOGETHER for bob and shake: moving the eye alone swings
  the aim, which is the nauseating version of the same effect.

**Correction to this plan's §2.** It said "the controller has no landing event; the director derives the
edge from the snapshot". That was true when 080 was written — 088 has since given the controller real
`LOCOMOTION_LAND` / `HARD_LAND` / `COLLAPSE` states and `Locomotion.fallSpeed`. The host now reports the
EDGE into one of those states with its impact speed, so the dip is a genuine one-shot rather than something
inferred from a velocity sign (the same upgrade 03 made when it took `Locomotion.heading` over an atan2).

**The impact signal** comes from `VehicleDamageSystem.peakImpact(body)` — the damage system already observes
collisions, and `physics.takeImpacts()` DRAINS, so a second listener would race it and one of the two would
see nothing. It reports every contact, not only the `STRONG_HIT` ones that damage a panel: the camera should
react to a kerb the bodywork shrugs off.

**First-guess defaults (the comfort round tunes these DOWN by default)**

| field                 | value     | why this number                                                        |
| --------------------- | --------- | ----------------------------------------------------------------------- |
| `bobAmplitude`        | 0.05 m    | The plan's run figure. This is the knob that reads as life at 0.05 and as seasickness at 0.15. |
| `bobCyclesPerMetre`   | 0.7       | ~1.4 m per bob cycle — a stride. (The plan called this `bobFrequency`; phasing by distance made a cycles-per-metre name the honest one.) |
| `landingDipScale`     | 0.06 m    | The plan's guess for a normal jump; hard-capped at 0.12 internally.     |
| `landingDipFullSpeed` | 8 u/s     | The fall speed that earns the full dip; 2x it is the clamp.             |
| `shakeScale`          | 0.08 m    | Under the plan's 0.1 cap — a crash should jolt, not blind.              |
| `shakeImpactForce`    | 250 000 N | Between the damage system's own measurements (light ~207k, crash ~377k). |
| `sprintFovKick`       | 0.04 rad  | ~2.3°, the plan's "2-3°".                                               |
| `reducedMotion`       | false     | Effects on by default; the master switch is a Camera-tab toggle.        |

**Measured** (`docs/benchmarks/opensa-engine/2026-07-25-headless-080-camera-director.json`, microbench row
080/06): `stepCamera` **0.568 µs mean / 0.620 p95 on foot with the layer live**, against **0.399 µs with
`reducedMotion` on** — the layer costs **+0.17 µs (+42%)**, or +0.15 µs in a car. Absolute 0.0006 ms/frame.
Camera suite 153 green (+17), apps/web + packages/game 755 green; `tsc` + eslint clean.

**Owed**: the COMFORT field round — a long walk (does the bob read as life or as wobble?), stair runs,
rooftop jumps, curb-hopping in a car and a deliberate wall crash. The plan asks for a comfort verdict
explicitly, not only a looks verdict, and to tune DOWN when in doubt. Every scale is live on the Camera tab
with `reducedMotion` as the A/B.
