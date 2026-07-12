# 06 — Normals & smoothing groups in map-optimizer (kill the faceted look)

**Problem (user report, 2026-07-12):** map-optimizer's auto-computed normals and smoothing behave badly —
under real lighting the world shows visible polygon facets, per-face darkening and hard creases where the
surface should read smooth. **This got MORE visible, not less, with the 074 own engine**: its hybrid sun
adds a true per-vertex N·L direct term everywhere, so every wrong normal now costs brightness twice
(prelit bake AND runtime sun). Fixing normals pays on both render paths.

## Where the damage comes from (verify each during phase 0)

1. **Recompute-from-scratch discards authored intent.** Where source DFF normals are dropped/regenerated
   (`computeVertexNormals` on welded output, PF re-export repair paths), everything smooths by POSITION
   only — coplanar-face seams smooth fine but crease edges (building corners, road curbs) smear, and
   curved surfaces welded from split verts stay faceted because splits break accumulation.
2. **No crease model.** SA authors expressed smoothing via duplicated verts (split = hard edge, shared =
   smooth). Welding/optimizing merges or re-splits without honouring that signal.
3. **Un-weighted accumulation.** Naive per-face normal sums let big triangles dominate — long thin road
   strips skew junction normals (related: the road-stripe artifacts family).
4. **Degenerate/flipped normals** from bad exports get "repaired" globally instead of locally.

## Improvement options (ordered; 1+2 are the plan, 3 is the fallback, 4 the deluxe)

1. **Preserve first, recompute last**: keep SOURCE normals wherever they pass sanity (unit-ish, not
   degenerate, agree with face winding within 90°); recompute ONLY the failing subset. Most of the map is
   authored correctly — stop destroying it.
2. **Crease-angle smoothing for the recomputed subset**: area-weighted + angle-weighted accumulation
   (weight = incident corner angle × face area), split accumulation across edges whose dihedral angle
   exceeds a threshold (default ~45°, per-material override: rounded kerbs/pipes higher, buildings lower).
   This reconstructs smoothing groups geometrically.
3. **Inherit smoothing from vertex splits**: treat the SOURCE mesh's shared-vs-split vertex topology as the
   smoothing-group signal (share → smooth, split → hard) and carry it through welding — exact fidelity to
   authored intent where the source is intact.
4. **Normal transfer HD→LOD**: LOD/decimated meshes sample nearest-surface normals from the HD source
   (the QEM chain already has correspondence) instead of recomputing on the coarse mesh.

## Tasks

- [ ] Phase 0 — forensic fixture set: 6–8 known-bad locations (screens from the field), dump their
      source vs optimized normals; confirm which failure mode (1–4 above) each exhibits.
- [ ] Sanity-gated source-normal preservation in the optimizer weld path (+ counters in the report:
      preserved / repaired / recomputed).
- [ ] Crease-angle recompute (angle+area weighted, dihedral split) replacing plain
      `computeVertexNormals` in optimizer paths; threshold per-material table with a sane default.
- [ ] Split-topology smoothing inheritance through welding (option 3) where source is intact.
- [ ] HD→LOD normal transfer in the LOD generators (option 4).
- [ ] Verification: A/B the fixture set on BOTH renderers (WebGL prod + 074 lab noon/night — the own
      engine's N·L is the harsher judge); no regression on the road-stripe guard fixtures.
- [ ] 074 hook: reconvert the bench rect after each phase — the pak carries snorm8 normals, so optimizer
      fixes flow through `opensa-pack` automatically; record before/after screens in this doc.
