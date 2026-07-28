# Ideas

**High-level directions we might implement in the future.** An idea here is deliberately *unscheduled* and
*unproven*: it still needs research and understanding before we could commit to it. An idea doc captures the
motivation, the approach that would fit our current architecture, the dead-ends already ruled out, and the
open questions — so when we pick it up we don't re-derive the discussion.

> **Before writing one, check [`docs/restrictions/`](../restrictions/README.md).** It holds the rules a
> design has to satisfy — layer boundaries, format ceilings, engine splits, what is decided at build time and
> cannot be re-taken at runtime — and says for each whether a violation is caught or is SILENT. A doc that
> violates one is not ambitious; it is a doc that gets rewritten after the first build.

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

## Camera

- [first-person-camera/](./first-person-camera/readme.md) — **first person**: the head IS findable (HAnim
  bone id 5 / `Head`, dumped from a stock ped) and its live world matrix is already computed every rendered
  frame by `IfpSampler`; hiding it is a zero-scale palette slot, which takes hats and hair with it. Written
  at the 080 close-out with what that chain learned — the open question is not "can we", it is whether SA's
  head animation and the ped's own torso across the near plane survive a field look.

## Editors

- [editors/](./editors/readme.md) — interactive asset editors over the machinery we already own (DFF ⇄ IR
  round-trip, map-optimizer transforms, viewer). First doc: a **model editor** — open a model, select
  polygons, recompute normals / reconfigure prelight, and export the updated model to a chosen folder.
