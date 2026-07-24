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

- [ ] `raycast`/`sphereCast` on `PhysicsWorld` + tests; radius derivation comment.
- [ ] Probe wiring in the host (player capsule / seated car exclusion).
- [ ] `camera-collision.ts`: primary + whiskers + asymmetric response + floor guard + cap
      semantics; unit tests with scripted probes.
- [ ] Config + Camera tab: `collisionRadius`, `collisionReleaseTime`, whisker angle.
- [ ] Measure: casts/frame and `director.update` p95 with collision on (ledger).
- [ ] **Field round**: interiors/underpasses (LS parking garages), back-to-wall orbiting, doorway
      exit glide, alley sprint with 03's recenter active (the combination is where jitter hides —
      recenter steering the yaw while collision caps the distance must not oscillate).

## Acceptance

- Camera never shows through-wall geometry in the field round; doorway release glides.
- No visible feedback oscillation between collision and recenter (test + field).
- Cast budget ≤ 5/frame measured; update cost still < 0.1 ms p95.

## Ledger

_(append here)_
