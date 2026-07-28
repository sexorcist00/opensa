# Documentation

How we work with docs. The guiding principle: **a direction earns more structure as it earns more certainty.**
A vague thought is an *idea*; a vetted-but-unbuilt one is a *concept*; a decided one is a *plan*. Nothing is
deleted when it dies — it becomes a *postmortem* so the dead-end is never re-run.

## The lifecycle

```
                        ┌─────────────────────────── know exactly what to do ──────────────────────────┐
                        │                                                                               ▼
   idea  ─────────►  concept  ─────────►  plan  ────────►  (implemented)                          docs/plans/
 docs/ideas/       docs/concepts/     docs/plans/                                                       ▲
   (unproven,        (research +          │  └──────────► want it, but a LATER version ──► docs/roadmap/┘
    unscheduled)      go/no-go)           │
                        │                 └──────────► architecture changed ──► notes in docs/architecture/
                        ▼
                  docs/postmortem/   (died — record WHY)
```

Read it as a set of rules:

- **We have a rough idea** → write it in [`docs/ideas/`](./ideas/README.md). High-level, unproven, unscheduled;
  it names the motivation, the fit with our architecture, the ruled-out dead-ends, and the open questions.
- **Before we build an idea** → promote it to a [`docs/concepts/`](./concepts/README.md) doc: the research and an
  honest go/no-go. A concept has two exits and no third:
  - it survives → it becomes a **plan** (its research record moves into the plan folder);
  - it dies → it becomes a [`docs/postmortem/`](./postmortem/README.md) (what we tried, what we measured, why
    it failed, and when it might be worth revisiting).
- **We already know exactly what to do** → skip straight to a [`docs/plans/`](./plans/README.md) chain (small,
  individually-implementable steps, each ending with verification + measured numbers).
- **We know what to do but want it in a later version** → [`docs/roadmap/`](./roadmap/) (e.g. `0.5.0/`, `0.6.0/`
  — scheduled cycles, same plan-chain shape as `docs/plans/`, just not this version).
- **A change alters the architecture** → add/adjust notes (and the diagram) in
  [`docs/architecture/`](./architecture/README.md) in the SAME change.
- **A NAME starts carrying behaviour** (a file the pipeline looks for, a frame/material the converter reads,
  a data row a tool writes) → record it in [`docs/contracts/`](./contracts/), one file per subject. A name
  contract is invisible from the code that consumes it: nobody greps for a filename they do not know exists,
  and a mod that spells one wrong contributes nothing, silently.
- **After a big rework** → run an audit and a benchmark, and record both: the audit under
  [`docs/audit/`](./audit/), the numbers under [`docs/benchmarks/`](./benchmarks/) (per its schema). A large
  change without its audit + before/after numbers is unfinished.

## Folder map

| Folder | What lives here |
| --- | --- |
| [`ideas/`](./ideas/README.md) | Unproven, unscheduled high-level directions (stage 1). |
| [`concepts/`](./concepts/README.md) | Live explorations under go/no-go review (stage 2). |
| [`postmortem/`](./postmortem/README.md) | Dead directions + the reason they died. |
| [`roadmap/`](./roadmap/) | Decided work deferred to a later version (`0.5.0/`, `0.6.0/`). |
| [`plans/`](./plans/README.md) | Committed work: numbered plan chains with measured verification. |
| [`architecture/`](./architecture/README.md) | Module/flow/format docs + rendered mermaid diagrams. |
| [`features/`](./features/README.md) | Per-feature state (one file per feature). |
| [`contracts/`](./contracts/) | Names that carry behaviour (files, frames, materials, data rows). |
| [`edge-cases/`](./edge-cases/README.md) | CURRENT limitations/constraints only, no legacy. |
| [`performance/`](./performance/) | Deferred-optimization levers (a price tag, not a plan). |
| [`benchmarks/`](./benchmarks/) | Every reported perf figure, recorded before it is analysed. |
| [`audit/`](./audit/) | Post-rework audits (what changed, what it cost, what it bought). |
| [`debug/`](./debug/README.md) | Kept debug scripts: what each answers + how to run. |
| [`open-issues/`](./open-issues/) | Tracked open problems and their fixed writeups. |
| [`improvements/`](./improvements/) | Smaller improvement notes not yet a plan. |
| [`development/`](./development/) | Contributor/setup notes. |
| [`commands.md`](./commands.md) | CLI/command cheat sheet. |
| [`links.md`](./links.md) | Useful external resources. |

The per-folder rules live in [CLAUDE.md → Documentation Maintenance](../CLAUDE.md); this page is the map.
