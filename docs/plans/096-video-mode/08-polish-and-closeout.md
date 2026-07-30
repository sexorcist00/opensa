# 096/08 — Polish, docs, benchmark, audit (close-out)

**Priority P2. The phase that makes the chain DONE by the workflow rules: a big feature without its
audit + benchmark is unfinished (CLAUDE.md standing rule).**

## Tasks

### A. Polish (each item is a field-report consumer, not speculative work)

1. **Shot-length adaptivity pass** (D4 final form): re-derive dwell from ACTUAL closing speeds measured
   in 03–05 runs; freeze the config table. Any value still being argued stays a config knob — nothing
   video-mode ships as a magic number outside `video-presets.ts`.
2. **Scene variety audit over one full seeded cycle**: no two consecutive scenes share car AND hour AND
   weather; if the seeded picks collide too often, add the cheap de-dup (reroll once) — measured first.
3. **Stability sweep**: 30-minute unattended run (soak-style), watch for the leak/perf drift the soak
   judge already measures; the module must not accumulate DOM nodes, listeners, spawned cars (teardown
   audit), or route-graph garbage per scene.
4. **Error paths on camera**: every `[video]` failure (no route, spawn retry exhausted, stuck) ends
   behind the overlay with a console line and ADVANCES the program — an endless mode must be unkillable
   by one bad scene. Verify by fault injection in tests (deny spawn, empty region).
5. **`vehicle-enter-null-body` disposition** (D16): if it never fired through 02–07's runs, close the
   issue at its 2026-08-30 recheck citing this chain as the stress evidence; if it fired, the guard
   already shipped (02's rule) — either way the issue file gets its closing block.

### B. Documentation (the same-change debts, collected)

6. `docs/features/video-mode.md` (+ README row): what it does, the decisions table, the accepted v1
   limitations (keyboard sums with autopilot; sidewalk offset jank; clock drift; no interior shots —
   pointer to 080/08 and the cabin open issue; recording is OS-side).
7. `docs/development/query-parameters.md`: final rows for `video`/`from`/`to`/`seed` — and a note in
   the "why no flags.ts" section that the count crossed its own threshold with this family (the doc
   asked to be told; whether the typed reader happens is its own tiny decision, not smuggled in here).
8. `docs/debug/README.md` row for `video-routes.ts`; `docs/commands.md` if any script/param surface
   changed; `docs/architecture/` touch-up if the module diagram warrants a box (it is an app-layer
   module — likely one line in the web-app doc, not a new diagram).
9. Restrictions/edge-cases sweep: anything 02–07 discovered the hard way gets its entry in the same
   closing change (candidates from the phases: the fly streaming cap, the cut-declaration contract).

### C. Benchmark + audit (the big-rework rule)

10. **Benchmark** (`docs/benchmarks/` per its schema, BEFORE analysis): frame cost of video mode ON vs
    OFF on the same scene/seed — director + autopilot + probes are all frame-loop work; expected ≪ 1 ms
    but MEASURED, plus the staging timeline (teleport → overlay-up) distribution across a full cycle.
    Record which pak build ran.
11. **Audit** (`docs/audit/video-mode-096.md`): what changed (module files, the one resolveCamera slot,
    the parser adjacency, the installer ledger, the runPath threading), what it cost (LOC, new tests,
    frame ms), what it bought (the feature), and what it deliberately did not do (the D14 list + the
    typed-params question).

## Acceptance

- The 30-minute unattended run completes with zero throws and flat memory/frame trends (numbers in the
  ledger + `docs/benchmarks/`).
- Every doc row above exists in the closing commit(s); the plans README row flips to SHIPPED with the
  one-paragraph story.
- The user has recorded at least one real clip they kept — the only acceptance that actually matters.
