# Ideas

**High-level directions we might implement in the future.** An idea here is deliberately *unscheduled* and
*unproven*: it still needs research and understanding before we could commit to it. An idea doc captures the
motivation, the approach that would fit our current architecture, the dead-ends already ruled out, and the
open questions — so when we pick it up we don't re-derive the discussion.

An idea is the FIRST stage of the documentation lifecycle (see [docs/README.md](../README.md)):

```
ideas  →  concepts  →  plans        (survived the go/no-go — we build it)
                    ↘  postmortem   (died — we record why)
```

Before an idea can be built it graduates to a [concept](../concepts/README.md) (the research + honest
go/no-go). Something already understood and scheduled does NOT live here — it belongs in
[docs/plans/](../plans/) (do it now) or [docs/roadmap/](../roadmap/) (do it in a later version).

## Ideas

- [vehdeform/](./vehdeform/readme.md) — **VehDeform**: GTA4-style dynamic impact deformation for vehicles
  (dents proportional to impact force/direction, accumulating), coexisting with SA's ok/dam part swaps.
  Feasibility looks high on our own vertex pipeline; needs a spike to confirm the look + tuning before it can
  become a plan.

## Editors

- [editors/](./editors/readme.md) — interactive asset editors over the machinery we already own (DFF ⇄ IR
  round-trip, map-optimizer transforms, viewer). First doc: a **model editor** — open a model, select
  polygons, recompute normals / reconfigure prelight, and export the updated model to a chosen folder.
