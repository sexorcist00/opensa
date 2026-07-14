# 18 — UV-scroll animation (B7·c)

**Status: OPEN, not started.** Scoped out of B7·b deliberately (it shares nothing with the frame-hierarchy
path) and written up here so it is not quietly forgotten — it is a **prod-parity gap**: the three path renders
these, the own engine does not.

## What it is

A completely separate animation mechanism from the animated map objects of B7·b:

|           | Animated objects (B7·b, DONE)                          | UV-scroll (this plan)                                                                                                                   |
| --------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Marked in | the **IDE** (`anim` section → an IFP file)             | the **DFF** — a `UVAnimDict` chunk (0x2B) at the clump head, materials referencing dict entries **by name** via the UV Anim PLG (0x135) |
| Moves     | the clump's **frames** (a garage door, a windmill hub) | the **texture coordinates** of a material (the LV skull sign's crawling neon, conveyor belts)                                           |
| Driven by | an IFP clip per model                                  | a keyframed `offset`/`scale` pair, played **globally in sync** — SA's dict-entry names are global identifiers                           |

## What already exists

- **Parsed, both halves.** `parseDff` already yields `RWClump.uvAnimations` and
  `material.effects.uvAnim.names` (`packages/renderware/src/parsers/binary/dff.ts`) — the data reaches us and
  is thrown away.
- **Prod renders it:** `packages/renderware/src/three/uv-anim.ts` — a module-level registry keyed by dict
  name (deliberately global, matching SA), a generic keyframe-pair lerp (equal-time pairs snap, which is how
  DolSign's stepped flipbook works), applied as a shader variant:
  `vMapUv = vMapUv * uUvAnim.zw + uUvAnim.xy`. The `rotation`/`skew` params are parsed but unused — SA's
  assets do not need them.
- Plan [041](../041-animated-map-objects.md) documented both mechanisms; the three path shipped both.

## What is missing

- The **converter** drops it entirely (`grep uvanim tools/opensa-pack` → nothing). The `.oscell` vertex has no
  room to say "this triangle's UVs scroll", and the texture atlas path has no per-material uniform slot.
- The **engine** has no consumer.

## The hard part (decide this first)

The world shader samples a **baked texture ARRAY** — a material is a layer index, not an object with its own
uniform. A scrolling material therefore needs one of:

1. **A per-vertex anim slot** — a small index into a global UV-anim table (a storage buffer of
   `vec4(offsetX, offsetY, scaleX, scaleY)` advanced once per frame on the CPU, since SA plays these globally
   in sync anyway). The world vertex shader adds one lookup: `uv = uv * anim.zw + anim.xy` when the slot is
   non-zero. Cheap, and it needs a spare per-vertex field — the vertex is already 36 bytes, so this is a
   format decision, not a free one.
2. A separate draw pass for scrolling materials (they leave the merged bundle). Costs draws for something that
   is, at heart, two floats.

Option 1 is almost certainly right; the cost is a `.oscell` minor bump and a re-convert.

## Done means

The LV skull sign at (2029.5, 1726.0) crawls in `?engine=opensa` exactly as it does on the three path, with no
measurable frame-time cost (it is one storage-buffer read on a handful of vertices).
