# 0.4.0 — Overview & roadmap

A cross-chain map of the 0.4.0 cycle: what it's about, how the five chains depend on each other, the critical path, and a suggested execution order. The per-feature detail lives in each chain's readme (linked from the [index](readme.md)); this doc is the altitude view that ties them together.

## What 0.4.0 is about

0.4.0 moves OpenSA from _faithful SA reproduction_ toward _modern, richer-than-vanilla, and moddable_ — along four pillars:

- **Look** — visual fidelity and polish: license plates, a full rendering overhaul.
- **Limits** — stop obeying SA's hard ceilings by shipping our own engine patches (an ASI).
- **Content** — with the ceilings lifted, put more and richer stuff in the world (2dfx on LODs, denser biome-aware procobj).
- **Behaviour** — run actual GTA:SA CLEO scripts inside the engine.

The through-line: two chains are pure capability (rendering, plates), one chain is a **keystone enabler** (the ASI), and one chain (extended generators) only pays off _after_ the enabler lands. Scripting stands alone.

## The five chains at a glance

| Chain                                                                       | Plans         | Pillar    | Gated on | Independent?                                               |
| --------------------------------------------------------------------------- | ------------- | --------- | -------- | ---------------------------------------------------------- |
| [01 — Vehicle license plates](plans/01-plates/)                             | 4             | Look      | —        | ✅ fully standalone                                        |
| [02 — Rendering overhaul](plans/02-rendering/readme.md)                     | 10            | Look      | —        | ✅ standalone (but its perf harness is shared — see below) |
| [03 — opensa-asi (own limit/engine patches)](plans/03-asi/readme.md)        | 11 (2 phases) | Limits    | —        | ✅ standalone; **enables 05**                              |
| [04 — Basic CLEO support](plans/04-cleo-basic/readme.md)                    | 5             | Behaviour | —        | ✅ fully standalone                                        |
| [05 — LOD generators, extended](plans/05-lod-generators-extended/readme.md) | 6 (A+B)       | Content   | **03**   | ❌ needs the ASI                                           |

**~36 plans total.** Only one hard cross-chain dependency (05 → 03), plus one shared foundation (02's perf harness).

## Dependency graph

```
                          02-rendering/001  ── perf HUD + benchmark harness ──┐  (shared measurement foundation)
                                                                              │
01-plates ─────────────────────────────────────────────────  (independent)   │
                                                                              ▼
02-rendering  001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010        │ used by
                                                                              │  05-A3, 05-B3
04-cleo-basic  001 → 002 → 003 → 004 → 005  ─────────────────  (independent)   │  (far-view / streaming budgets)
                                                                              │
03-asi  Phase 1: 000 → 001 → 002 → 003 → 004 → 005 → 006   (limit lift = Task 3) ┼──┐
                 └ 000 = reproduce the bug FIRST (the pass/fail oracle)        │  │
        Phase 2: 007 → 008 → 009 → 010      (2dfx emitter fix = Task 4) ───────┼──┼──┐
                 └ 007 = reproduce the 2dfx crash FIRST (the pass/fail oracle) │  │  │
05-lod-ext  Part B (procobj density): B1 → B2 → B3 ◄── needs 03 Phase 1 ──────┘  │  │
            Part A (2dfx on LODs):    A1 → A2 → A3 ◄── needs 03 Phase 2 ─────────┘  │
                                          A3 also shares 03-asi/010's budget ◄──────┘
```

Two cross-cutting threads run through multiple chains and should be treated as shared contracts:

1. **The `opensa-asi` build target flag.** Introduced in 03-asi/006, it selects _stock_ vs _asi-lifted_ behaviour. 05-B3 (procobj caps), 05-A3 / 03-asi/010 (keep 2dfx on LODs) all gate on the SAME flag. One flag, consistent across the pipeline — design it once in 03-asi/006.
2. **The perf measurement harness.** 02-rendering/001 builds the FPS/draw-call HUD + benchmark scenes. 05-B3's "perf becomes the new limiter" and 05-A3 / 03-asi/010's far-view budgets all measure against it. If 05 or 03-Phase-2 runs before 02/001, they need a lightweight stand-in.

## Critical path & what unlocks what

- **03-asi is the keystone.** Its Phase 1 (limit lift) unlocks 05-Part B; its Phase 2 (2dfx emitter fix) unlocks 05-Part A. Nothing else in 0.4.0 blocks on it, but ~⅓ of the content value (denser world, effects at range) is downstream of it. If content richness is the 0.4.0 headline, 03-asi is the long pole — start it early.
- **02-rendering is the largest chain (10 plans)** and mostly self-contained, but its plan 001 is a dependency-magnet: build it first regardless, because 03-Phase-2 and 05 want its numbers.
- **01-plates and 04-cleo are leaf chains** — fully parallelizable, no dependents, good for filling gaps or parallel tracks.

## Suggested execution order

Three broad phases, each shippable:

**Phase A — foundations & standalone wins (parallelizable)**

- 02-rendering/001 (instrumentation) — do this first; everything measures against it.
- 01-plates (whole chain) — small, standalone, visible win.
- 03-asi Phase 1 (001–006) — the limit lift; long pole, start early.
- 04-cleo-basic can run as an independent parallel track any time.

**Phase B — build on the foundations**

- 02-rendering 002–010 (the overhaul proper) — the biggest single body of work; sequence internally as its readme specifies.
- 03-asi Phase 2 (007–009) — the 2dfx emitter fix, once the framework (Phase 1's 002/003/005) exists.
- 05-Part B (procobj density) — as soon as 03 Phase 1 + the target flag land.

**Phase C — content richness on the lifted engine**

- 05-Part A (2dfx on LODs) — needs 03 Phase 2 + shares 03-asi/010's budget model.
- Final calibration/default-flip passes (02-rendering/010) and the budget-lift integration (05-B3) that turn measured numbers into shipped defaults.

Nothing forces this exact order — the only hard rule is **05 after its 03 phase**, and **build 02/001 before anything that needs perf numbers**. Everything else is schedulable by appetite.

## Cross-cutting risks & standing rules

- **The ASI is the highest-variance work** (blind binary patching, macOS→Win32 cross-compile, Wine-only testing). It also gates the most downstream value. De-risk it first: **03-asi/000 (reproduce the bug) is the literal first task** — a reliable, isolated repro + detection oracle before any RE or patching, since you can't confirm a fix you can't trigger — then 001 RE + 002 toolchain, before committing 05's content plans to a schedule.
- **Calibration, not code, is the cost in 02-rendering** (every weather/hour tuned against reference screenshots) — budget iteration time, not just implementation.
- **Fallback honesty everywhere the asi target is used**: an asi-target build without the asi corrupts exactly as before — 03-asi/006's presence check must cover all downstream content (05-A/B).
- **Standing rule (all chains)**: every plan records its numbers into its own Measurements section after each phase; tiers/budgets/defaults are derived from those numbers, never guessed.
- **Two build targets, forever**: `stock` (byte-identical to today, int16-safe, no engine deps) and `opensa-asi` (lifted). Every content chain keeps the stock target working.

## Scope summary

| Chain         | Plans | Rough size        | Standalone value                                                                                         |
| ------------- | ----- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| 01-plates     | 4     | small             | ships alone                                                                                              |
| 02-rendering  | 10    | large             | ships incrementally per stage                                                                            |
| 03-asi        | 11    | large / high-risk | Phase 1 ships alone (limit lift, starts with 000 repro); Phase 2 alone (2dfx fix, starts with 007 repro) |
| 04-cleo-basic | 5     | medium            | ships alone (two mods run)                                                                               |
| 05-lod-ext    | 6     | medium            | only after 03                                                                                            |

See the [index](readme.md) for every plan link, and each chain's readme for design rationale, code grounding, and external references.
