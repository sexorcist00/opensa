# 008 — The far-view emitter budget (particles on real-SA LODs)

> **UNBUILT.** Moved here 2026-08-09 from the roadmap chain `07-lod-generators-extended/sa-lod-generator/02`, which was dissolved into the tools it touches — see
> [roadmap 0.5.0](../../../../docs/roadmap/0.5.0/readme.md) for what the chain was and what shipped out of it.


Depends on
[lod-common/03](../../../lod-common/docs/plans/008-emitter-thinning.md) (thinning). Its sibling `01` (the policy adoption) was
deleted 2026-08-09: it shipped as
[sa-lod-generator/007](007-clone-2dfx-policy.md) via plan
100/05, which is now the record.

**The ASI gate this plan was parked behind is already open, and its scope is smaller than A3 assumed.**
[03-asi Phase 2](../../../../asi/perfect-map/docs/plans/readme.md) is done: 009 shipped the
emitter-lifecycle patch (the `FxSystem_c` use-after-free, confirmed in-game), and
[010](../../../../asi/perfect-map/docs/plans/010-pipeline-keep-2dfx.md) already flipped the pipeline —
`sa-lod-generator` **keeps particles on the verbatim path by default** today, with `--strip-particles` as the
opt-out for a stock target with no asi (`cli.ts:42`, `finalize.ts:219`). What 010 left open is the far-view
overdraw budget, deferred on the user's call.

**And the decimate half shipped too, in [plan 100/05](007-clone-2dfx-policy.md).**
All three clone paths — decimated re-encode, verbatim byte copy, hole-fill — now resolve one keep-set
through `cloneKeepTypes` (`adapters/gta-sa/finalize.ts:85`, `:95`), so a decimated LOD carries its emitters
today. **What remains here is the BUDGET and the stock-target regression, nothing else** — the plan's own
scope line below is what it was before 100 landed, kept for the record.

## Context & boundary

03-asi/010 owns the **pipeline decision** (shipped), the **far-view rate budget** (deferred) and the
installer's asi-presence safety, and it covered the sa-lod strip flip — a single call site. This plan is the
**generator plumbing** for the representation 010 did not touch: the **decimate** path, where the 2dfx
section is rebuilt rather than copied and so needs the keep-set and the thinning wired explicitly.

Today: verbatim keeps particles by default; decimate re-attaches via `collectClumpEffects`, whose keep drops
them. So a decimated LOD still carries no emitter, and nothing has ever measured what the un-stripped
verbatim path costs at range.

Baked cells are **not** in scope — that generator's output never loads in real SA
([`restrictions/sa-target.md`](../../../../docs/restrictions/sa-target.md) has the citation). If our own engine
ever wants emitters on cells, that is its
own plan with its own budget, and it is not blocked on anything here.

## Decisions

1. **Particles become `carry-rate-scaled`** in the policy for the asi target, on the verbatim and decimate
   paths; thinning factors come from lod-common/03, which shares its config with 010. The verbatim path's
   carry already ships — this makes it a policy entry rather than a `keepParticles` boolean, and extends it
   to decimate.
2. **The stock target still strips**, and `--strip-particles` stays the way to ask for it. Without the asi
   this is not a preference, it is the difference between a game that boots and one that does not.
3. **Per-species tuning is expected, not a fallback.** The 38 particle-bearing models differ: one plume per
   smokestack reads right at range; fountains may be worth dropping entirely there. The shipped table is a
   deliverable of lod-common/03, tuned by the field runs here.
4. **Correctness is three things, and two of them are easy to forget**: emitters present, positioned — AND
   budgeted. A distant refinery must show smoke, and the map-wide sum must stay inside the frame budget with
   every smokestack in view. Measure the second case deliberately; it will not occur by accident during a
   normal drive.
5. **Fallback honesty.** A build with emitters carried REQUIRES the asi; without it the leak returns. The
   installer's asi-presence check covers this content, loudly.

## Tasks

- [x] ~~Policy: type-1 → carry-rate-scaled on verbatim and decimate~~ and ~~decimate carries the emitters~~ —
      **BOTH SHIPPED as [plan 100/05](007-clone-2dfx-policy.md).**
      All three clone paths resolve one keep-set through `cloneKeepTypes`; `keepParticles` survives only as
      the `--strip-particles` override, on one line.
- [ ] **Measure what the ALREADY-SHIPPED verbatim carry costs at range.** This is the whole of what is left,
      and it comes before any mechanism: 010 deferred the far-view budget and nobody has taken the number.
      [Plan 100/04](../../../../docs/plans/100-2dfx-at-lod-range/04-authored-cull-distance.md) found the emitter
      system **below the noise floor** with a positive control, so the honest outcome may be a null result —
      in which case [lod-common/03](../../../lod-common/docs/plans/008-emitter-thinning.md) ships a table of 1.0s and this plan
      closes.
- [ ] The deliberate worst case: a viewpoint with the maximum number of emitting LODs in frame. Find it, log
      it, and re-run it after every factor change — an A/B of a tuning factor against two different
      viewpoints proves nothing.
- [ ] In-game (Wine, asi target), only if the measurement says thinning is needed: refinery and plant smoke
      visible at LOD range through both paths; a new game boots (009's guard); far-view frame cost inside
      budget. Record per-species factors and fps.
- [ ] Stock-target regression: particles fully stripped, byte-identical to today.

## Verification

- asi target: emitters ride verbatim AND decimate LODs; distant smoke visible; the game boots; the frame
  budget holds at the worst-case viewpoint.
- stock target: byte-identical strip to today.
- Emitter count stays bounded map-wide — no smoke-storm.

## Measurements / notes

_(record after implementation)_

- particle-bearing models re-emitting at LOD range (of 38 / previously 11 cloned): …
- worst-case viewpoint, and the far-view frame cost there before/after: …
- shipped per-species factors: …
