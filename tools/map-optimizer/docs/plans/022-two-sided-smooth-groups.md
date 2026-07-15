# 022 — Smooth groups across two-sided geometry

**Status: planned — gated on phase-0 fixtures (020) proving the artifact is visible in the field.**
Part of the 020–023 normals batch (`docs/ideas/0.4.0/plans/06-normals-smoothing`).

## Problem

`tool-kit/mesh/smooth-normals.ts#smoothGroups` treats any edge with ≠ 2 incident faces as a hard group
boundary. SA's static world is heavily two-sided (mirrored coplanar face pairs — the engine even honours
`DISABLE_BACKFACE_CULLING`; vanilla renders the world without cull). In a doubled region every edge has 4+
incident faces → **every face becomes its own smooth group** → per-face flat shading on surfaces that should
read smooth (awnings, canopy sheets, thin walls seen from both sides). Fences/flat sheets don't care; curved
doubled surfaces do.

## Design sketch (validate against fixtures first)

Pair mirrored twins before grouping:

1. Detect twin faces: same 3 canon vertices, opposite winding (the `dedupe-faces` canonical-key machinery
   already distinguishes these — reuse its key, reversed).
2. Partition faces into **front** and **back** sheets by twin orientation (flood-fill consistency, seeded per
   connected component; a component without twins is untouched).
3. Run the existing edge/dihedral grouping **per sheet** — within a sheet, shared edges are 2-incident again
   and the crease logic applies as designed. Twins get opposite group normals by construction.
4. Unpaired non-manifold edges (T-junctions, real borders) stay hard boundaries as today.

Open question for phase 0: how much of the doubled world is _curved_ (where this shows) vs flat (where
per-face == smooth anyway). If the fixture sweep finds only flat cases, close this plan as not-needed —
that outcome goes in this doc.

## Tasks

- [ ] Phase 0 evidence: from the 020 fixture sweep, find ≥ 2 curved two-sided surfaces with visible faceting
      in-engine (noon N·L). No evidence → close as not-needed.
- [ ] Twin detection + sheet partition in the tool-kit core (shared with the LOD chain; re-run its harness).
- [ ] Unit tests: doubled cylinder smooths per side; doubled flat sheet unchanged; T-junction stays hard.
- [ ] Field A/B + numbers/screens recorded here.
