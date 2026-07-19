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

- [ ] `camera-motion.ts`: bob oscillator (distance-phased, damped amplitude), landing one-shot,
      shake generator (seeded PRNG), FOV kick; the additive combiner with the 0.15 m cap.
- [ ] Unit tests: phase freezes at rest; amplitude continuity across walk↔run; landing edge
      detection from scripted snapshots; shake decays deterministically for a fixed seed; caps
      hold under sum; `reducedMotion` zeroes everything.
- [ ] Vehicle impact signal plumbed from the damage system's collision observation into the
      snapshot (one number: impulse magnitude this frame).
- [ ] Config + Camera tab: `bobAmplitude`, `bobFrequency`(k), `landingDipScale`, `shakeScale`,
      `sprintFovKick`, `reducedMotion`.
- [ ] **Field round**: long walk (does bob read as life or as wobble?), stair runs, rooftop jumps,
      curb-hopping in a car, a deliberate wall crash. Explicitly ask for a comfort verdict, not
      only a looks verdict; tune down by default.

## Acceptance

- Effects visible in A/B (`?cam=legacy`) but individually deniable in the tab; comfort verdict OK.
- All caps proven by test; collision layer untouched (motion applied after, bounded below margin).

## Ledger

_(append here)_
