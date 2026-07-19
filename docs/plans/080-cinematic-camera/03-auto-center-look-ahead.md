# 080/03 — Auto-centering + look-ahead (behaviours 1, 4, 6)

Builds directly on the 02 rig: both features are just new WRITERS to channels 02 created
(`smoothDampAngle` yaw target, look-point offset). No new smoothing machinery.

## 1. Auto-centering (#6, and the visible half of #1)

The 036 prod camera solved this once; we port its semantics onto the spring channels, with one
GTA V refinement (idle recenter, which 036 did not have):

- **Turn-follow** (036 semantics, kept): heading = `atan2` of the per-frame world-position delta
  (orientation-agnostic — works on foot and later in cars, including reverse). A heading change
  faster than `TURN_THRESHOLD` (0.9 rad/s starting value) engages `following`, which steers the
  yaw target to _behind the movement_ until settled (`SETTLE_EPSILON` 0.03 rad). Walking straight
  **never** engages — a player-framed angle survives a whole straight run.
- **Idle recenter** (new, the GTA V behaviour): when `idleFor > recenterDelaySec` (look input only —
  movement does not reset it) AND the player is moving above `MOVE_THRESHOLD`, the yaw target eases
  behind the current heading at `recenterRate`, **scaled by speed** (walk barely recenters, sprint
  recenters confidently; standing still never recenters — GTA V leaves a parked camera alone).
- **Manual always wins**: any look input clears `following` and the idle timer
  (`MANUAL_GRACE_MS` 250 from 036). Pitch is never auto-touched.
- Both writers steer through the 02 `smoothDampAngle` channel — that spring is where the
  "camera softly catches up to the character's turn" weight (#1) is actually felt.

## 2. Look-ahead (#4)

- A lateral offset added to the look point: `lookAheadOffset` damps toward
  `normalize(planarVelocity) × lookAheadDistance × speedFactor` with `lookAheadTime` (a slow-ish
  `smoothDamp` — the frame shift should be felt as composition, not as tracking).
  `speedFactor = clamp(speed / runSpeed, 0, 1)` — walking gives a hint, sprinting the full shift.
- The offset applies to the LOOK POINT only (target), not the eye orbit centre — this yaws the
  composition toward travel (player slides toward the trailing screen edge) without changing the
  orbit geometry the collision layer (04) has to defend.
- Zeroes (through its damp — no snap) when velocity drops below the dead-zone threshold or in
  photo/bench. Cap the offset so the player never exits the safe frame (≤ ~0.8 m at sprint;
  tune in the field round).

## Subtasks

- [ ] Heading tracker with `MOVE_THRESHOLD` freeze (036: a stationary player cannot drift heading).
- [ ] Turn-follow engage/settle state + tests (engage only above threshold; straight run never
      engages; manual look cancels; reverse walks the camera to face the motion).
- [ ] Idle recenter: timer from 02, speed-scaled rate, stand-still exclusion; tests for each gate.
- [ ] Look-ahead offset channel + cap + tests (offset tracks velocity direction change through the
      damp; zero at rest; capped at sprint).
- [ ] Config + Camera-tab rows: `recenterDelaySec`, `recenterRate`, `lookAheadDistance`,
      `lookAheadTime`, thresholds.
- [ ] **Field round**: run a lap with no mouse input (does it settle behind you naturally?), zigzag
      between buildings (turn-follow), strafe-circle an enemy stand-in (look-ahead must not fight
      orbiting). Freeze defaults.

## Acceptance

- Tests green; no-input lap ends with camera behind the player without ever feeling yanked.
- Field verdict accepted for #1/#4/#6; values in the ledger.

## Ledger

_(append here)_
