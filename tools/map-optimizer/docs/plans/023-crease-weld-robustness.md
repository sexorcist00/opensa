# 023 — Crease & weld robustness knobs

**Status: planned — smallest of the 020–023 normals batch; both halves are fixture-gated.**
Covers the remaining half of option 2 of `docs/ideas/0.4.0/plans/06-normals-smoothing`.

## A. Per-material crease-angle override

The 45° crease is global. Authoring reality differs by surface kind: rounded kerbs / pipes / arches want a
higher threshold (stay smooth through sharper dihedrals), hard-edged buildings arguably lower. The plugin
already receives `SmoothNormalsOptions` — extend to `creaseAngleFor(materialTexture) → degrees` resolved per
smooth-group seed face, with the flat default unchanged.

Selection mechanism when needed: a small name-list table (texture-name → angle), the same curation loop the
stochastic list uses (run → eyeball → promote). **Do not build the table speculatively** — only add entries
the phase-0 fixtures (020) or field reports demand. No entries demanded → close A as not-needed.

Note: a _group_ spans faces of several materials; the override applies at edge-crossing time (the edge's two
faces' thresholds — use the max), not per group.

## B. Weld across quantization-grid boundaries

`weld()` canonicalizes by `round(pos / epsilon)` — two vertices `epsilon`-close but straddling a grid cell
boundary get different canon ids, so their adjacency is lost and a phantom hard edge appears mid-surface.
Standard fix: probe the 27-neighborhood (or re-canonicalize with a half-cell offset second pass) when the
exact-cell lookup misses.

Reality check first: SA seam vertices are usually byte-identical (epsilon = 1 mm is generous), so measure
before fixing — add a counter for "near-miss pairs" (distance < epsilon, different cells) to the phase-0
fixture dump. Zero hits map-wide → close B as not-needed (record the number here).

## Tasks

- [ ] Phase-0 counters: near-miss weld pairs map-wide; fixture list of surfaces wanting a non-45° crease.
- [ ] (if demanded) `creaseAngleFor` override + name-list table + tests.
- [ ] (if demanded) neighborhood-aware weld + tests.
- [ ] Re-run the opensa-lod-generator harness (shared tool-kit core — the two ship in tandem); numbers here.
