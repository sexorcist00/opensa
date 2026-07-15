# 020 — Preserve authored normals (sanity-gated, auto-detected)

**Status: planned.** Implements option 1 of `docs/ideas/0.4.0/plans/06-normals-smoothing` (queued right after
the current lighting bug; plans 020–023 are the normals batch).

## Problem

`smooth-normals` rebuilds normals **unconditionally** on every mesh that has them
(`plugins/smooth-normals.ts` — only the `!mesh.normals && !addWhereAbsent` case skips). On the vanilla map
~960 of 12 964 world models ship authored normals — the only place an author expressed curvature intent.
The 45° crease rebuild destroys that intent: surfaces authored smooth across dihedrals > 45° (rounded kerbs,
pipes, arches, canopies) come back faceted. The 2026-07-15 full-map run confirms the blast radius: all
11 462 processed models were rewritten by `smooth-normals`.

## Detection is automatic — no curated lists

A model either carries a normals block or it doesn't (`mesh.normals !== null`); the gate below is pure
geometry. (Curated lists stay a prelight-only concept, where statistics genuinely can't tell "lights off by
design" from a broken export. Normals have a geometric ground truth.)

## Design

Per-vertex sanity checks on meshes that ship normals:

1. **Unit-ish**: length in [0.9, 1.1]; rejects zeroed blocks (dirty re-exports — the gta3-pf `casroyale`
   family, plan 037 runtime lesson) and NaN/Inf.
2. **Winding agreement**: normal vs the area-weighted average of incident face normals; dot < 0 (points
   "into" the surface, > 90° off) = broken. Vertices whose incident faces fully cancel (two-sided coplanar
   pairs) have no face evidence — treat as _unverifiable_, keep the authored value.

Per-mesh verdict from the failing fraction:

- **all pass** → keep the authored block verbatim (mesh stays byte-identical on this pass);
- **isolated failures** (≤ `repairFraction`, default 5 %) → point-repair only the failing vertices with
  their smooth-group normal (rebuild internally, apply selectively; no vertex splits for kept vertices);
- **mass failure** (> `repairFraction`) → full smooth-group rebuild as today.

Meshes without normals are untouched by this plan (`addWhereAbsent` path unchanged).

## Report

`applied` log + run report gain counters: `normals preserved / repaired / recomputed` (models and vertices).
The full-map numbers go into this doc after each phase (standing rule).

## Tasks

- [ ] Phase 0 — forensic fixtures (shared with 021–023): 6–8 known locations from the field screenshot set,
      dump source vs rebuilt normals per failure mode; at least one authored-smooth > 45° surface and one
      dirty-export (zeroed block) model. Wire as `test:fixtures` manifest entries (real assets, not
      hand-built).
- [ ] Sanity gate + per-mesh verdict in the `smooth-normals` plugin (tool-kit core gains a
      `validateNormals(positions, indices, normals)` helper; the plugin owns the policy).
- [ ] Point-repair path (selective apply of group normals, no splits for passing vertices).
- [ ] Counters in `context.log` + `RunReport`.
- [ ] Verification: A/B the fixture set on the 074 engine (noon — per-vertex N·L is the harsh judge) AND the
      three path; re-run the opensa-lod-generator harness fixtures (tool-kit core is shared — map-optimizer
      and the LOD chain always ship in tandem).

## Non-goals

HD→LOD normal transfer (06 option 4) stays in the LOD generators' court. Per-material crease overrides are
plan 023.
