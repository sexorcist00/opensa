# A 100-unit floor under the two tiniest fx systems

## What it is

`DRAW_DISTANCE_DEPARTURES` in `apps/web/src/ui/engine-particles.ts`, the `atLeast` rule:

```ts
{ rule: 'atLeast', systems: ['insects', 'cigarette_smoke'], value: 100 },
```

Both author `cullDist` **15**. They are drawn to 100 instead. The user's call, taken with
[the smoke raise](smoke-drawn-to-world-edge.md) — the two are opposite departures from the same table and are
recorded together on purpose, so a later reader does not see one and infer a rule.

## What it stands in for

A distance falloff we do not have. Read literally, 15 u puts a cloud of insects at arm's length: it appears
about two car lengths away and is gone again immediately, which reads as a bug rather than as an effect. SA
gets away with it because its own fog and draw distance hide the transition; ours does not.

100 is a compromise, not a derivation. It is also still **3× tighter than the flat 300** these systems had
before this step, so the departure improves on what shipped even while deviating from the table.

## What it was judged on

Nothing yet — **this is the weakest entry of the two**. The number is the user's, chosen against the authored
15 as "obviously too near" and the previous 300 as "obviously too far". It has not been field-judged; when
[100/03](../plans/100-2dfx-at-lod-range/03-lod-bundle-reads-2dfx.md)'s field check runs, `insects` is the
system to look at first, because it is **402 of the map's 878 placed anchors (46 %)** and therefore both the
most visible and the most expensive of the whole set.

## What would retire it

- A field verdict picking a number, which would turn this into a judged constant (still a departure, but an
  evidenced one).
- A size/alpha falloff with distance, which would make the pop the authored value causes invisible and let the
  15 stand.
- Discovering that SA scales `cullDist` at runtime by something we do not read yet — the reversed source has
  not been searched for this, and if it does, the honest answer replaces the floor entirely.

## Blast radius

- `insects` alone is 402 anchors, so this number is the single biggest lever on far-view emitter cost in the
  stock map. Raising it hurts frame time in vegetated areas; lowering it toward 15 costs nothing and looks
  worse.
- `cigarette_smoke` has **no placed anchor in the stock map at all** — it is in the table for the mod that
  places one, and for symmetry with `insects`, whose authored value it shares.
- Both are `atLeast`, so a mod authoring either above 100 keeps its own value.
