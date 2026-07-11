# 073/08 — Pipeline sharing (lighter cell appearances)

**Priority: P2 (perf polish; steady state is already ~13 ms).** Cell appearance cost = per-object PIPELINE
COMPILES: the render-object cache key includes `object.uuid` for instanced meshes (three's PR 29066 workaround),
so every InstancedMesh compiles its own pipeline even with a shared material (~5 ms each). The appear budget only
trades fill speed vs frame weight (`?appear=N`).

## Context

- Root: `InstanceNode` captures the specific `instanceMatrix` buffer in the nodeBuilderState — sharing programs
  across InstancedMeshes would bind the FIRST mesh's instance buffer for all (why the uuid was added). The real
  fix upstream = `referenceBuffer()` refactor. If plan 01's upstream work lands it — this plan dissolves.

## Tasks

- [ ] Read `InstanceNode`/`InstancedMeshNode` (r185): confirm how the instanceMatrix buffer is captured (uniform/
      storage buffer vs vertex attribute) — decides feasibility.
- [ ] Prototype (patch): make the instance buffer a per-draw binding (bind group or vertex-buffer slot) so
      same-material InstancedMeshes share ONE pipeline; drop uuid from the cache key for `bundle.static` objects.
- [ ] Measure: appearance frames at `?appear=16` before/after (target: post-add frames < 30 ms at 16/frame).
- [ ] Fold into the upstream issue (plan 01) — this IS the referenceBuffer prototype.

## Done

Cell appearance no longer compile-bound (new-texture compiles only); `?appear` default raised without frame spikes.
