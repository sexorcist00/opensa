# 080/04 — Collision camera (behaviour 9)

The one plan with engine-adjacent surface: `PhysicsWorld` grows a camera-grade cast API. Everything
else is a pure layer inside the director.

## 1. `PhysicsWorld` cast API (`packages/game/src/physics/physics-world.ts`)

Today only downward casts exist (`groundBelow` `:361-367`, `isGrounded` `:391-399`); both already
use the Rapier primitive `world.castRay`. Add:

- `raycast(origin: Vec3, dir: Vec3, maxDist: number, exclude?: BodyHandle) → { dist } | null` —
  thin wrapper, GTA Z-up, solid-hit semantics, excluding the player capsule / seated car body
  (the camera must not collide with its own subject).
- `sphereCast(origin, dir, radius, maxDist, exclude?)` — Rapier `castShape` with a ball; the
  camera uses this one (a zero-width ray lets the eye rest ON a wall and the near plane clips
  through it; the radius must cover the near plane: `radius ≥ near·tan(fov/2)·√(1+aspect²)` ≈ 0.35
  for near 0.5 / fov 60° — derive, don't guess, and note the value in the ledger).
- Both cast against the one Rapier world, so streamed static colliders AND dynamic bodies
  (vehicles, props) occlude correctly for free. Colliders exist only near the player
  (collision streaming, 256-unit grid) — the camera orbit is well inside that ring by construction.

Unit tests on the physics test world (the collider fixtures the collision-streaming tests use):
hit distance accuracy, exclusion works, sphere cast stops `radius` short of the surface.

## 2. The collision layer (`camera-collision.ts`)

Runs on the FINAL rig pose (after 02/03/05 layers, before additive motion):

- **Primary cast**: sphere cast from the look point (head height — a point that is by definition
  outside geometry) toward the desired eye. Hit ⇒ `allowedDistance = hitDist`.
- **Asymmetric response** (the GTA/industry standard): pulling IN is **immediate** (snap to
  `allowedDistance` this frame — a wall between camera and player is never visible, not even for
  one frame); releasing OUT damps at `collisionReleaseTime` (~0.4 s first guess) so leaving a
  doorway glides instead of popping.
- **Whisker casts** (anticipation): 2 extra sphere casts at ±~15° yaw around the desired eye
  direction, taking the min distance with a soft weight — the camera starts easing in BEFORE the
  wall edge crosses the screen centre, which reads as "the camera avoids the wall" instead of
  "the camera hit the wall". Budget: 3 casts/frame steady state (≤ 5 with headroom for 05's
  vehicle variant) — measure actual cost in the ledger (expected ≪ 0.05 ms; Rapier ray cost at
  this collider density is trivial, but measure anyway, standing rule).
- **Floor guard**: after distance resolve, if the eye lands below `groundBelow(eye) + 0.3`, lift
  it (steep down-pitch on a slope otherwise puts the camera in the road).
- Distance writes go through 02's distance channel as a CAP (min of zoom target and
  `allowedDistance`) — zoom state is preserved through an occlusion, exactly like GTA restores
  your chosen distance after a tunnel.
- The director's probe stays injectable (01 contract): unit tests script hit distances and assert
  snap-in/damp-out asymmetry, whisker min-weighting, cap-not-overwrite semantics.

## 3. Space discipline

The rig is engine Y-up; casts run GTA Z-up. Convert at the probe boundary only:
`gtaFromEngine(eye) = (x, −z, y)` (the inverse the host already uses at
`engine-canvas-host.tsx:504-508`), never inside rig math. One conversion helper, tested both ways.

## Subtasks

- [x] `raycast`/`sphereCast` on `PhysicsWorld` + tests; radius derivation comment.
- [x] Probe wiring in the host (player capsule / seated car exclusion).
- [x] `camera-collision.ts`: primary + whiskers + asymmetric response + floor guard + cap
      semantics; unit tests with scripted probes.
- [x] Config + Camera tab: `collisionRadius`, `collisionReleaseTime`, whisker angle.
- [x] Measure: casts/frame and `director.update` p95 with collision on (ledger).
- [ ] **Field round**: interiors/underpasses (LS parking garages), back-to-wall orbiting, doorway
      exit glide, alley sprint with 03's recenter active (the combination is where jitter hides —
      recenter steering the yaw while collision caps the distance must not oscillate).

## Acceptance

- Camera never shows through-wall geometry in the field round; doorway release glides.
- No visible feedback oscillation between collision and recenter (test + field).
- Cast budget ≤ 5/frame measured; update cost still < 0.1 ms p95.

## Ledger

### 2026-07-25 — SHIPPED

**Physics API** (`physics-world.ts`): `raycast(origin, dir, maxDist, exclude?) → {dist}|null` and
`sphereCast(origin, dir, radius, maxDist, exclude?)`, both GTA Z-up, EXCLUDE_SENSORS, excluding the caster's
subject (the player capsule / seated car body). `sphereCast` uses Rapier `castShape` with a `Ball` and
returns `time_of_impact`. Real-collider tests on the physics world: hit distance, exclusion, and the ball
stopping `radius` short of the wall (a zero-width ray reports 9.5, the 0.3 ball 9.2).

**The layer** (`camera-collision.ts`, pure, injected `CameraProbe`): primary sphere cast from the look point
along `−forward`, two whiskers at ±`collisionWhiskerAngle`, min across all three. Response is asymmetric —
snap IN, `damp` OUT over `collisionReleaseTime`. It CAPS the distance (min of zoom target and the allowed
distance), so the chosen zoom is restored after the occlusion. Space discipline: `gtaFromEngine` at the
probe boundary only.

**Two field-round fixes folded in the same day (user report):**
- **`collisionMinDistance`** (1.6): a wall can shove the eye in but never INTO the player — below the min it
  stops and accepts a little wall clip over a face full of ped. Fixes the "camera goes into the ped for a
  second on car entry".
- **Floor guard** (`guardFloor` + a `GroundProbe` = `physics.groundBelow`): a steep down-pitch on a raised
  porch/slope buried the eye and showed only skybox (the blue frame the first field look caught). The eye is
  lifted to `groundBelow(eye) + 0.3` when it sinks below.

**First-guess defaults**: `collisionRadius` 0.35 (near-plane cover for near 0.5 / fov 60° is ~0.59 at 16:9;
0.35 trades a little coverage for keeping the camera closer to walls — field-tune), `collisionMinDistance`
1.6, `collisionReleaseTime` 0.4, `collisionWhiskerAngle` 0.26 rad (~15°). All live on the Camera tab.

**Measured**: casts/frame = 3 (primary + 2 whiskers) + 1 ground guard = **4**, under the ≤5 budget. Headless
`ls-noon` with collision on: **120 fps / 8.334 ms / p95 10 / draws 1184** — vsync-capped, GPU pass 2.877 ms,
i.e. the per-frame casts are free (Rapier ray at this collider density is trivial). Suite 2650 green.

**Field-checked headless**: walking into the house wall pulls the camera tight to the ped (no through-wall),
the porch no longer shows skybox (floor guard). Owed to the user's own field round: interiors/underpasses,
back-to-wall orbit, the recenter-vs-collision interaction, and the car-entry min-distance read.
