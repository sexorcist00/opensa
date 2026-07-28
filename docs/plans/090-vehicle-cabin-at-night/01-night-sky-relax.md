# 090/01 — The night stops dividing by a sky term at full strength

**Status: OPENED 2026-07-28.**

## The change

One factor in the vehicle's indirect term. Today:

```wgsl
let ambient = frame.params.y * DYNAMIC_INDIRECT * skyVisibility(normal) * in.local.w;
```

`in.local.w` answers "how much of the SKY can this vertex see past the car's own body". That is the right
question while the sky is the source. At night it is not: what reaches a cabin comes from street lamps, shop
fronts and headlights — sources at ground level, arriving SIDEWAYS through the glass, which the height-field
horizon (8 azimuths of "highest surface over this cell", horizontal-and-up only) never modelled.

So the occlusion is relaxed toward 1 as the day/night factor (`frame.params.x`, 0 day → 1 night) goes up,
and only partway: 084 added this term because a car at night collapsed into one flat colour, and taking it
out entirely would bring that back.

The relax fraction is a **fitted constant** and is documented as one — the game supplies no formula here
(SA has no modelled interiors at all, so there is nothing to reproduce). State what was tried, over what
range, and what it was judged on.

## Scope

- The vehicle path only (`fsRigid` / `fsRigidBlend` share `rigidShade`). The ped path carries no per-instance
  occlusion, so there is nothing to relax there.
- The map is untouched: its AO rides baked prelit, a different term with its own night set.

## Verification

- unit: the shader store's golden snapshot carries the change (shader diffs stay reviewable);
- offline: `dump-vehicle-materials.ts` numbers do not move (this step writes no data — the same pak, a
  different runtime weight), which is itself the check that step 01 is a pure runtime lever;
- in-engine: headless night capture, interior camera, before/after;
- field: the user's verdict from the interior camera.

## Measured

**Shipped 2026-07-28** as `skyShareNow()` in `packages/engine/src/render/shaders.ts`, used by all three
places that read the baked value (the indirect term, and the reflection/specular gate from `3e37d10`):

```wgsl
const NIGHT_SKY_RELAX = 0.6;
fn skyShareNow(baked: f32) -> f32 { return mix(baked, mix(baked, 1.0, NIGHT_SKY_RELAX), frame.params.x); }
```

`frame.params.x` is the day→night factor, so nothing moves by day — this is a pure night lever.

**The fitted constant, stated plainly.** 0.6 is a taste value, not a measurement: SA models no interiors, so
there is no original formula to reproduce (the reversed source has nothing to read here). It was chosen to
roughly halve the cabin's penalty while leaving the body's shape intact, which the table below is the check
on. Tuning it costs a reload, not a pack rebuild.

**Per-part weight at midnight, over the REAL pak** (`build/gostown/opensa`, previon, mean over each part's
body vertices — before is the baked value, after is what the shader now uses):

| part | baked sky | at midnight | factor |
| --- | --- | --- | --- |
| `starion88_gauges` | 0.561 | 0.825 | **×1.47** |
| `starion88_seats` | 0.563 | 0.825 | **×1.47** |
| `starion88_interior` | 0.610 | 0.844 | **×1.38** |
| `extra1` / `extra2` / `extra3` (cabin trim) | 0.525–0.661 | 0.810–0.864 | ×1.31–1.54 |
| `door_lf` / `door_rf` | 0.732–0.749 | 0.893–0.899 | ×1.20–1.22 |
| `chassis` | 0.833 | 0.933 | ×1.12 |
| `bonnet_ok` / `boot_ok` / `misc_a` | 0.912–0.942 | 0.965–0.977 | ×1.04–1.06 |
| `starion88_glass` / `windscreen_ok` | 0.954–0.992 | 0.982–0.997 | ×1.00–1.03 |

The gradient is the point: the cabin gains ~40–50 %, the bodywork 4–12 %, the glass nothing. The car keeps
the readable edges 084 gave it and stops swallowing its own interior.

**Still owed** — an in-engine night capture (interior camera, same spot, before/after) and the user's field
verdict. Both come with their rebuild; if the cabin still reads too dark, the constant is the one dial.
