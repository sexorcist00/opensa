# 010 — Pipeline: keep 2dfx on LODs + far-view budget

Part of the [perfect-map ASI chain](readme.md), Phase 2. Depends on [009](009-2dfx-emitter-patch.md) (the engine leak fixed) and Phase 1's [006](006-pipeline-integration.md) (the stock-vs-opensa-asi target mode). Delivers the open issue's **remaining goal**: distant factory smoke/fire visible at LOD range instead of stripped — without the emitter leak (009) OR the far-view overdraw.

## Context

Today ([lod-2dfx-particles.md](../../../../docs/open-issues/lod-2dfx-particles.md)) both LOD targets drop particle 2dfx:

- **sa** — `stripParticleEffects(bytes)` wrapped around every clone in `finalize.ts` + `fill-holes.ts` (keeps type-0 coronas/lights, removes type-1 particles).
- **opensa** — structurally immune (cell bake rebuilds from geometry; `build2dfxSection` re-adds only type-0 lights via `LIGHT_2DFX = new Set([0])`).

The issue flags TWO problems, of which 009 only solves the first:

1. **Emitter leak → crash** — fixed in-engine by 009.
2. **Far-view overdraw / lag** — every refinery/plant LOD has a large draw distance, so ALL of them emit simultaneously across the whole map: big translucent smoke sprites everywhere, tanking the frame. This is a DATA/rate problem the engine fix doesn't touch — verbatim HD emitter parameters are wrong at LOD range.

So keeping particles on LODs needs both: the asi (009) AND a LOD-tuned emitter budget so the far view isn't a smoke storm.

## Decisions

1. **Gate on target, like the limit budgets.** For the **opensa-asi target** (009 present), the LOD generators STOP stripping particle 2dfx and instead emit LOD-tuned emitters. For the **stock target**, keep stripping exactly as today (no engine fix → the strip is still mandatory). The strip is "a single call site per target" (issue note) — flip it by target flag.
2. **LOD emitters are RATE-REDUCED, not verbatim.** Distant smoke needs presence, not fidelity: cut emission rate / particle count / sprite budget hard for LOD-range emitters (candidate: a fraction of HD rate + a cap), so the whole-map sum stays cheap. Exact factors tuned in-game against the overdraw. Coronas/lights (type-0) policy unchanged — already kept.
3. **Distance-appropriate transform.** LOD emitters may need repositioned/simplified emission (the cell bake repositions coordinates already for type-0; extend that for type-1). One smoke plume per stack at range, not the HD multi-emitter rig.
4. **Reuse existing machinery.** `build2dfxSection` "already re-attaches arbitrary entries" (issue note) — widen the kept-type set to include rate-scaled type-1 for the opensa-asi target; `stripParticleEffects` gains a "scale instead of strip" sibling or a parameter. Minimal new surface.
5. **Budget honesty.** Even with reduced rates, cap the number of concurrently-emitting LOD stacks if the frame budget (02-rendering's harness) demands — and `log()` what was capped (no silent truncation, per repo convention). Tie into the 02-rendering perf HUD to measure the far-view cost directly.
6. **Fallback safety.** If someone runs the opensa-asi-target build (particles kept) WITHOUT the asi, it crashes exactly as the original bug — so the installer's asi-presence check from 006 covers this content too; loud warning.

## Tasks

- [ ] sa-lod-generator: target-gated particle handling — strip (stock) vs rate-scaled keep (opensa-asi); add the "scale instead of strip" path beside `stripParticleEffects` in `@opensa/rw-codec/dff`; unit tests (type-1 kept + scaled for opensa-asi, stripped for stock, coronas untouched in both).
- [ ] opensa-lod-generator: extend the cell 2dfx re-add (`LIGHT_2DFX`/`collectCellLightEffects`) to optionally include rate-scaled type-1 for the opensa-asi target (byte-verbatim transplant + coordinate reposition + rate scale).
- [ ] Emitter rate/sprite-budget model: LOD-range scaling factors (rate, count, cap) as tunable config; sensible defaults, tuned in-game.
- [ ] pmb wiring: the target flag (stock vs opensa-asi) already selects limit budgets in 006 — extend it to select particle policy; one flag, both behaviours.
- [ ] In-game validation (Wine, opensa-asi target): distant refinery/plant smoke visible at LOD range, no new-game crash (009), and the far view holds frame budget (measure via 02-rendering HUD — before/after the rate scaling). Record factors + fps.
- [ ] Stock-target regression: particles still fully stripped, output still safe on stock 1.0 (today's verified behaviour unchanged).
- [ ] Docs/memory: update lod-2dfx-particles.md status (🟡 → ✅ for the opensa-asi target: leak fixed in-engine + overdraw budgeted; stock target still strips), the sa-lod strip plan 005 cross-ref, and the sa-lod memory ("standing goal — make particles WORK at LOD range" resolves for the asi target).

## Verification

- opensa-asi target: refinery/Vegas-plant/fountain/fire LODs emit at range, new-game boots clean, far-view frame cost within budget (measured, not eyeballed).
- stock target: byte-identical strip behaviour to today (regression).
- Without the asi on an opensa-asi build: the installer warns; the crash returns (fallback honesty).

## Measurements / notes

_(record after implementation)_

- LOD emitter scaling factors (rate/count/cap) shipped: …
- far-view frame cost before/after scaling (map-wide smokestacks in view): …
- models re-emitting at LOD range (of the 11 previously stripped): …
