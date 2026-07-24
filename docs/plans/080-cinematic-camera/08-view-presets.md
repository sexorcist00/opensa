# 080/08 — Switchable view presets (the C key), first-person included

**Added 2026-07-25 at the user's request.** SA cycles camera views with a key; we want the same, plus a
first-person view — and, more importantly, we want the ARCHITECTURE for it in place while the chain is
still being built, so no later plan hard-codes assumptions that make a second view impossible.

## The shape

A **preset** is a named set of rig values, not a new code path. Every tuned number in this chain already
lives in `CameraConfig` and reaches the director as its `config` argument (plan 01's rule: no magic numbers
in the rig) — so a preset is simply a different object handed to the same `stepCamera`:

```ts
type CameraView = 'first' | 'third'; // what the rig frames — the ONLY structural flag

type CameraPreset = {
  key: string; // 'normal' | 'far' | 'close' | 'first-person' | 'bumper' | …
  label: string; // debug/HUD text
  view: CameraView;
  /** Overrides applied over the base `Config.camera` (distance, height, pitch clamps, lag times, FOV …). */
  rig: Partial<CameraConfig>;
};
```

- `Config.camera.presets: { foot: CameraPreset[]; vehicle: CameraPreset[] }` — **one ring per mode**, as SA
  has (on foot and in a car cycle independently, and each remembers its own choice). `fly` has no ring: the
  viewer/photo camera is a tool, not a view.
- The active index lives in `CameraRigState` (`presetIndex: { foot, vehicle }`), so it survives mode
  switches and is trivially serialisable later.
- Resolution is one pure function above the rig: `resolveTuning(config, mode, presetIndex) → CameraConfig`.
  The director does not learn about presets at all — it keeps taking one tuning object.
- **Input**: a `cycleView` intent in `CameraSnapshot` (the host reports the key edge, default binding
  `Config.controls.cameraView = 'KeyC'`, like the other bindings). The director advances the ring for the
  CURRENT mode. One place, no scattered key handling.
- **Switching is a transition**, not a jump: a preset change writes new targets into the same channels the
  follow rig already damps (distance, height, FOV), so the blend plan 07 builds covers it for free. The one
  case that cannot glide is third ⇄ first (the eye teleports into the head) — that gets a short fade or an
  instant cut, decided in the field round.

## What first-person actually costs (the real work of this plan)

Everything above is plumbing. The first-person VIEW is the part with real dependencies:

- **Eye anchor**: the eye must ride the ped's head, not `focus + followHeight` — the head bone's world
  matrix from the animated skeleton (`engine-player`/IFP sampler already poses it), plus a small forward
  offset so the near plane never clips the face. Falls back to `focus + eyeHeight` if the bone is absent
  (a modded ped may not carry it).
- **Hiding the player**: the ped must not be drawn (or at least not its head) — the engine has no
  per-instance "hide" for the player mesh today; that is the one engine-side addition this plan needs.
- **Collision layer opts out** (plan 04): there is nothing between the eye and the head to pull in.
- **Additive motion re-tunes, not re-uses** (plan 06): head bob that reads well in third person is nausea in
  first; the preset carries its own amplitudes, and `reducedMotion` must zero them here too.
- **Pitch clamps widen** — first person looks nearly straight up and down; the follow rig's clamps would
  feel broken.
- **The controller needs nothing**: `CharacterControllerSystem` already takes its forward from the camera
  shim, so movement stays camera-relative in either view.
- **Vehicle first person** is the same mechanism with a car anchor (bumper / dash dummy from the model's
  frames) instead of a head bone — worth shipping in the same plan since the ring is per mode.

## Where it sits in the chain

**After 05 (vehicle camera) and before/with 07 (transitions).** It needs the vehicle rig to exist (the
vehicle ring is half the feature) and the collision layer to be opt-out-able (04); its blends belong to the
same audit 07 does. Nothing in 02–06 must hard-code a value the preset system would need to override —
that is the standing constraint this plan places on the rest of the chain, and the reason it is written now
rather than at the end.

## Subtasks

- [ ] `CameraPreset`/`CameraView` types + `resolveTuning`; unit tests (ring wrap, per-mode independence,
      overrides applied over the base config, unknown/empty ring falls back to the base).
- [ ] `cycleView` intent through the snapshot + `Config.controls.cameraView` binding; host key edge.
- [ ] Default rings: foot `normal / far / close / first-person`, vehicle `normal / far / bumper /
      first-person`; values tuned in the field round.
- [ ] First-person anchor: head-bone matrix from the posed skeleton + forward offset + absent-bone
      fallback; unit test on the anchor math with a stubbed pose.
- [ ] Engine: hide the player's own mesh while `view === 'first'` (per-instance flag on the ped draw).
- [ ] Vehicle anchor: bumper/dash dummy lookup with a fallback to a body-space offset.
- [ ] Per-preset motion amplitudes + pitch clamps; `reducedMotion` still wins.
- [ ] Debug: the active preset on the HUD/Camera tab, and a row to cycle it without the key.
- [ ] **Field round**: cycle on foot and while driving, at speed, mid-jump, entering/leaving a car.

## Acceptance

- C cycles views on foot and in a car independently; the choice survives entering/leaving a vehicle.
- First person: no player mesh in frame, no clipping through the head, look range usable, movement still
  camera-relative, and the HUD/crosshair still make sense.
- A preset switch never snaps a channel the rig damps (distance/height/FOV glide); third ⇄ first is the one
  deliberate cut.
- Suite green; the director's cost stays inside the chain budget (0.1 ms p95).

## Ledger

_(append measurements + tuned values + field verdicts here)_
