# Two `PhysicsWorld` collider defects (found by coverage, not by the field)

**Status: FOUND but NOT FIXED (2026-07-18).** Both surfaced while writing unit tests for previously
untested code during [plan 077](../plans/077-unit-coverage.md). They are recorded rather than patched on
purpose: a coverage pass that also changes behaviour cannot tell you which change broke something. Neither
has a field report against it — which is exactly why they are worth writing down, since nobody is looking.

## 1. `createFalling`'s box fallback is unreachable — an unhullable prop CRASHES

`packages/game/src/physics/physics-world.ts:254-257`.

The code reads as "convex-hull the mesh, or fall back to a box":

```ts
const desc = ColliderDesc.convexHull(vertices) ?? ColliderDesc.cuboid(...);
```

**But `ColliderDesc.convexHull()` does not return null for degenerate input — it returns a non-null,
INVALID descriptor.** `??` therefore never fires, and `world.createCollider(desc)` throws instead.

The proof that this is a known Rapier behaviour and not a theory: the neighbouring `addConvexChassis` in
the same file already guards the same call with try/catch, precisely because of this.

**Symptom to expect in the field:** a breakable prop whose mesh cannot be hulled (degenerate/duplicate
geometry, a flat 2-triangle sign) throws when it topples instead of falling back to its bounding box —
so B7·a destruction takes the whole frame down rather than looking slightly wrong.

**Fix:** mirror `addConvexChassis` — try/catch around the hull, use the cuboid on failure. Add a test
with a degenerate mesh; the pinned "documented-actual" test in `physics-world.test.ts` should be flipped
to the desired behaviour at the same time.

## 2. `setColliderEnabled` silently does nothing, and is dead code

`PhysicsWorld.setColliderEnabled` calls Rapier's `setEnabled(false)`, and `isEnabled()` afterwards
reports `false` — yet **the collider keeps blocking solidly**. Verified two ways: re-fetching the
collider wrapper, and waking/teleporting the parent body in case it was a sleeping-island artefact.

It has **no callers**. The path that actually works, and that `enter-vehicle.system.ts` uses, is
`setColliderSensor`.

**Fix:** delete the method, or work out why the flag does not take (collider vs parent-body state,
or a narrow-phase cache that needs invalidating) before anyone reaches for it and believes it.

## Two smaller ones, same batch

- **`roadsignGlyphIndex` does an unguarded prototype lookup** — `COMMAND_GLYPHS` is an object literal, so
  `roadsignGlyphIndex('toString')` returns a `Function`, violating its `null | number` signature.
  Unreachable from `roadsignGlyphQuads` (it only ever passes single characters). `Object.hasOwn` or a
  `Map` closes it.
- **`mat4Multiply` cannot alias `out` with `a`** (`packages/engine/src/core/math.ts`) — it writes `out`
  column-by-column while still reading `a`, so `mat4Multiply(m, m, b)` silently corrupts. No current
  caller does this; it deserves a doc comment before one does.
