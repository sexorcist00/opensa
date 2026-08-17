# Project Guidelines

## Important

- Write production-ready code
- Prefer small focused files
- Add comments only when necessary
- Prefer explicitness over magic
- Preserve existing architecture and conventions
- Follow existing project patterns before introducing new ones
- Prefer extending existing code over introducing new abstractions
- Reuse existing utilities before creating new ones
- Do not refactor unrelated code unless explicitly requested
- Split overly complex files into smaller modules
- Prefer minimal diffs
- Avoid reformatting unrelated code
- Prefer readable and maintainable code
- Prefer simplicity over clever abstractions
- Avoid unnecessary abstractions

---

## TypeScript Rules

- Use TypeScript strict mode
- Avoid `any`
- Prefer explicit types for public APIs
- Prefer `type` over `interface`
- Use discriminated unions when appropriate
- Prefer readonly where possible
- Avoid unnecessary generics

---

## React Rules

- Use functional components and hooks only
- Keep components small and composable
- Extract reusable logic into custom hooks
- Do not create components inside components
- Memoize expensive computations when needed
- Keep JSX clean and readable

---

## Styling

- Avoid inline styles
- Reuse utility classes when possible
- Keep styling readable
- Prefer composition over duplicated class lists

---

## API Rules

- Use async/await
- Handle loading states
- Handle error states
- Keep API logic outside React components
- Do not call APIs directly inside JSX

---

## Testing Rules

- Tests must be deterministic
- Keep tests readable and explicit
- Avoid duplicated setup logic
- Use descriptive test names

### Test Structure

- Negative test cases must go first
- Positive test cases must go after negative cases
- Negative and positive cases must be placed in separate `describe` blocks
- Separate describe blocks with an empty line
- Keep test structure consistent across the project

Example:

```ts
describe('formatValue', () => {
  describe('negative cases', () => {
    it('throws when value is invalid', () => {});
  });

  describe('positive cases', () => {
    it('returns formatted value', () => {});
  });
});
```

---

## Ignore Rules

Do not analyze or modify generated/dependency files.

Ignore:

- node_modules
- dist
- build
- coverage
- \*.generated.ts
- package-lock.json
- yarn.lock
- pnpm-lock.yaml

Never edit generated code manually.

---

## Cost Saving Rules

- Run only affected tests when possible
- Do not run the entire test suite for small isolated changes
- If only one test file was modified, run only that test file
- If only one component changed, avoid unrelated validations
- Read only files relevant to the current task
- Avoid scanning the entire repository unless necessary

---

## Standing Workflow Rules

- **CHECK `docs/project-goals.md` BEFORE writing an idea, a concept or a plan** — it is what the project is
  FOR, and it is directive, not aspirational. OpenSA is compatible with RenderWare; it is NOT a
  reimplementation of San Andreas. Two halves, and dropping either breaks it: **honour the authored DATA**
  (timecyc moods, handling rows, IDE flags, popcycle/cargrp — read them as the author meant, or the world
  stops behaving as designed and every mod written in those tables goes wrong in FEEL rather than in
  loading), and **do not port the LOGIC** — its execution, its data structures and its ceilings are one 2004
  machine's answer. We have our own engine and our own formats now, so a legacy limit is not our limit, and
  where we can beat the original we are REQUIRED to: matching a 2004 compromise is the choice that needs an
  argument, not improving on it. "That is what the original does" is the beginning of an argument, never the
  end of one. The goals also carry what keeps this honest — better must be DEMONSTRATED (measured or
  field-accepted, never assumed), performance is part of every feature's specification, and a mod author's
  data must keep working.
  **Read the goals first, then the restrictions**: one says what to aim at, the other what may not be done
- **CHECK `docs/restrictions/` BEFORE writing an idea, a concept or a plan** — it holds the rules a design
  has to satisfy (layer boundaries, format ceilings, engine splits, what is decided at build time and cannot
  be re-taken at runtime). A plan that violates one is not ambitious, it is a plan that gets rewritten after
  the first build. When a new restriction is discovered, it goes there in the SAME change, and every entry
  must say whether a violation is caught by a test/guard/lint or is SILENT — the silent ones are why the
  folder exists
- **The `sa` target ALWAYS runs OLA + FLA + our own `perfect-map.asi`. That is the only configuration we
  build for, and a stock 1.0 is not one.** So a stock ceiling is a fact about a 2004 machine, never a budget
  our content is cut to: `EntitiesPerIpl`, `EntityIpl`, `Buildings`, `Dummys` are raised or `unlimited` on the
  target, and int16 `IplDef` — the one thing no adjuster reaches — is lifted by our asi. **Do not add a guard,
  a cap or a migration that shapes output to a limit the target does not have**, and when you meet one that
  already exists, price whether it still binds before defending it. The measured configuration is
  `docs/gta-sa-original/reference-install-config.md` (verbatim capture) and what it MEANS for a plan is
  `reference-install.md` — read the table there rather than assuming a stock number.
  **The converse is the same rule, and it is the one that bites**: a limit the target really HAS stays a hard
  guard — FLA's pools are configured numbers, not `unlimited` (TXD 6000 / COL 275 / IPL 280), and exhausting
  one corrupts the heap at boot. Delete the museum pieces, keep the gates.
- English only, repo-wide: no Cyrillic in any doc, comment, or committed file — paraphrase field verdicts
  in English (chat language stays whatever the user speaks)
- Record measured numbers into the plan doc after EVERY phase/step (before/after, representative log lines);
  a phase without its numbers is unfinished
- Every reported performance figure goes into `docs/benchmarks/` (per its readme's schema/index) BEFORE it
  is analysed — including numbers pasted in chat; always record which pak build a run read
- After a BIG rework (a migration, a subsystem rewrite, a major feature chain), run an audit AND a benchmark
  before calling it done: write the audit to `docs/audit/` (what changed, what it cost, what it bought) and
  the before/after numbers to `docs/benchmarks/`. A large change without both is unfinished
- **A field run reads `build/<game>/opensa` and NOTHING else — its `data/` included.** Not just the models:
  the built `data/*` is the MERGED result with mods installed, and it can differ from `game-src/<game>/data/*`
  completely. Diagnosing against the source tree cost a whole session in plan 081/02 — a field report about a
  shivering car was chased against a `handling.cfg` row the game was not running (the built one carried a
  mod's suspension damping 5× out of range). `scripts/debug/handling-diff.ts` defaults its baseline to the
  built table for the same reason
- **A small change to the map build does NOT get a pmb rebuild — swap the model in place.** A full `sa` stage is
  ~10 min; the one-model instruments are seconds and were built for exactly this (session 17, 2026-08-17):
  `scripts/debug/model-optimize.ts` (one model through the optimizer chain, a named variant, patched into the
  tree), `scripts/debug/model-lab.ts` (the same PLUS its clone LOD cut from the result — clones are cut FROM the
  HD, so an HD-only swap leaves the far view stale; `--dff/--txd` for a mod's loose files),
  `scripts/debug/img-patch.ts` (append-and-repoint any IMG entry with a ledger, `restore` per entry) and
  `scripts/debug/dump-binmesh.ts` (split order = draw order). **The OpenSA target has the same shape**
  (2026-08-17, `tools/opensa-lod-generator/docs/plans/007`): `scripts/debug/model-repack.ts <model>
[--dff f.dff [--txd f.txd]]` re-optimizes the model, re-bakes the cell LODs of its rect FROM the swapped HD
  and re-welds the rect into a servable LAB pak (`build/<game>/opensa-lab`, `?src=`) — seconds against a
  ~50 min pipeline; it never touches the shipping pak (a subset weld cannot reproduce its texture layer
  plan — `docs/in-reserve/ospak-in-place-cell-patch.md`). **The GOAL in every field/dev round is to reach
  the verdict through these instruments and spend a rebuild only when the whole tree must be confirmed.**
  Rebuild only to confirm a fix on the WHOLE tree, after the one-model field verdict, or when the change is
  a stage that has no one-model form (IPL folds, archive layout, `gta.dat`). Rows in `docs/debug/README.md`
- **Every test fixture has exactly ONE of three sources, and a manifest line that names it** (the user's
  call, 2026-08-17): a stock game file (`game-src/<game>`, an IMG entry included), a mod file
  (`mods-src/<game>`, found by NAME across layers), or — when it exists nowhere else (a version-pinned
  lock, a golden snapshot, a re-export a mod no longer ships) — a copy CACHED in `fixtures-src/`. Nothing
  under `fixtures/` is committed and neither is `fixtures-src/`; `npm run test:fixtures` (`scripts/
test-fixtures.ts`) rebuilds `fixtures/original` + `fixtures/viewer` from the first two and mirrors
  `fixtures-src/` → `fixtures/custom` (wipe + copy, FIRST). **A file dropped into `fixtures/` by hand is
  one `rm -rf` from gone and no test will say so** — its tests go `skipIf` and the suite stays green: the
  day the tree was first regenerated from scratch, four cutscene fixtures turned out to have no manifest
  line at all. So: a new fixture = a manifest line (`copy`/`extract`/`mod`/`cleo`) or a file in
  `fixtures-src/`, in the same change as the test; verify with a regeneration, never by the file being there
- **A pmb run that dies is RESUMED, never restarted from stage 1** (pmb plan 006, 2026-08-17): every run leaves
  `<out>/.work-<target>/resume.json` (what it was made of + which steps finished — every chain stage, `sa`,
  `opensa-lod`, `opensa`), and the pack journals every weld chunk under `pack-checkpoints/`. `pmb … --resume`
  (same flags) re-enters at the last finished step — a dead pack at its last finished chunk — and REFUSES,
  naming the difference, if the sources, the flags or the code changed since that run (a resumed build over
  changed inputs is a build nobody can reproduce). Read the refusal, do not work around it. Standalone:
  `opensa-pack --checkpoints <dir> [--resume]`
- **An A/B must be SELF-DESCRIBING: the capture records what the run was configured with.** Careful
  single-variable bisection lost to one capture that stated its own spring values. Before tuning a new
  surface, read it back into the capture (`[phys]`'s `springs` block is the pattern)
- **NEVER hardcode a value for a specific car/model/asset.** Every slot in this game is a mod target — today
  a model sits on `comet`, tomorrow on `admiral`. A rule must DERIVE from what the asset itself carries (its
  handling row, its geometry, its collision), so it applies to whatever is in the slot. When a car stood on
  its bump stops the fix was not "stiffen that car" but "static sag may not exceed a share of the travel the
  car actually has" — a rule that touched only the car violating it
- **Dig out the original game's real formula before fitting a constant of our own.** The reversed SA source
  (`docs/links.md` → gta-reversed) carries the actual data→physics mapping. A fitted constant is acceptable
  only as a MEASURED, documented bridge — state what was fitted, over what range, and its residual — and it
  is a debt, not an answer. The same goes for global tuning constants: each one is a place where the game's
  own numbers are not being read yet. **This does NOT contradict "do not port the original's logic"**
  (`docs/project-goals.md`): the original is the source of truth for what its DATA MEANS, and never the
  ceiling for how that data is executed. Recover the formula; write our own implementation of it
- **Every hack we knowingly take gets a file in `docs/hacks/`, in the same change** — a fitted constant, a
  heuristic standing in for a formula nobody has recovered, a faked effect, an exclusion the general rule
  cannot express. Say what it stands in for, what it was judged on ("it looked right" is a legitimate answer
  as long as it says so), what would retire it, and what else moves if it changes. **When a hack is replaced
  by the honest approach, MOVE its file to `docs/hacks/retired/`** with a closing block naming what replaced
  it and linking the commit/plan — never delete it; the row in the README stays and points at the new home.
  A hack nobody recorded is indistinguishable from a decision

---

## Documentation Maintenance

The documentation lifecycle (idea → concept → plan / postmortem; roadmap for later versions) is described in
`docs/README.md` — read it when deciding WHERE a doc belongs. The folders that carry that lifecycle:

- `docs/ideas/` — a rough, unproven, unscheduled direction. High-level only; needs research before it can be
  built. A new idea is its own folder + a row in `docs/ideas/README.md`
- `docs/concepts/` — an idea under an honest go/no-go review (research first, code never). A concept has two
  exits: it graduates to `docs/plans/` (validated — its research record MOVES into the plan), or it dies into
  `docs/postmortem/`. Only LIVE explorations stay in `docs/concepts/`
- `docs/postmortem/` — a died concept/plan: what was tried, what was measured, why it failed, when to revisit.
  Add the file + a row in `docs/postmortem/README.md` (never just delete a dead direction)
- `docs/plans/` — committed work you already know how to do: a numbered chain of small, individually-shippable
  steps, each ending with verification + measured numbers. Add a row in `docs/plans/README.md`
- `docs/roadmap/` — decided work deferred to a later version (`0.5.0/`, `0.6.0/`); same plan-chain shape as
  `docs/plans/`, just not this version
- `tools/<tool>/docs/plans/` — **a tool's own numbered chain, beside its code.** A step from `docs/plans/` or
  `docs/roadmap/` MOVES here when it ships (next free number, measured numbers filled in) and the central row
  is repointed. **A plan also moves here once its work no longer spans tools, built or not** (the user's call,
  2026-08-09, when `07-lod-generators-extended` was dissolved): a chain whose every remaining task belongs to
  one tool is a chain that will drift from that tool's code, so it lives beside it and the central folder
  keeps only a pointer. The central folders carry what genuinely spans several tools, or has no tool yet
- `docs/audit/` — a post-big-rework audit (see the Standing Workflow rule above): what changed, its cost, its
  gain
- `docs/in-reserve/` — **DEFERRED work whose investigation is already done** (the user's call, 2026-08-15):
  we know how, we researched it fully, and we deliberately have not built it because the condition that makes
  it necessary has not arrived. A card states, in order: which task it came out of, WHY it is deferred (the
  measurement or field verdict, dated), **the TRIGGER** — the concrete condition that turns it into work —
  and **where that trigger is checked in code**. Row in `docs/in-reserve/README.md`.
  **That last part is the rule, not decoration**: the guard, gate or error message that fires when the
  condition arrives must NAME the card. A card whose trigger lives only in the folder gets read after the
  confusion instead of before it, which is the exact failure the folder exists to prevent — a symptom
  surfacing months later and the same investigation being paid for twice.
  Two things do NOT go here however unused they are: a fact about the ORIGINAL game or its adjuster ecosystem
  (that is `docs/gta-sa-original/` by rule — a fact does not change folders because we are not using it this
  month; a card POINTS at it), and work we already intend to do (`docs/roadmap/`). Neighbours: postmortem is
  _"has this been tried?"_, roadmap _"when are we doing it?"_, ideas _"someone should look at this"_, and this
  folder _"already looked at — here is what it costs and what makes it urgent"_

Keep these in sync with the code — update them in the same change, not later:

- `docs/architecture/` — when a change alters architecture (modules, boot/loading flow, formats, streaming,
  pmb stages, tools), update the matching doc AND its diagram. Diagrams are mermaid blocks named `%%| <name>`
  rendered to `docs/architecture/assets/` by `npm run arch:render` — edit the block, re-render, commit both
- `docs/features/` — when developing a feature, update its file's state; a new feature gets its own new file
  (+ a row in `docs/features/README.md`)
- `docs/contracts/` — when a NAME starts carrying behaviour (a file the pipeline looks for, a frame/material
  the converter reads, a data row a tool writes), record it in the matching subject file (`vehicles.md`,
  `mods.md`; a new SUBJECT gets its own file). These are the rules a mod author cannot guess and a reader
  cannot grep for. **Every later convention of this kind EXTENDS these docs in the same change** — a name
  rule that lives only in code is one nobody can follow, and misspelling one is silent by nature, so say
  what happens when it is spelled wrong
- `docs/edge-cases/` — when a new limitation/constraint is discovered, add it to the matching file; when one
  is lifted, remove it. Only CURRENT limitations live there, no legacy
- `docs/restrictions/` — the rules a NEW design has to satisfy, **read before ideas/concepts/plans are
  written** (see the Standing Workflow rule above) + a row in `docs/restrictions/README.md`. A fact may also
  appear in `docs/edge-cases/`, but only ONCE as detail: edge-cases carries the measurement, restrictions
  carries the one-line rule, a link, and what edge-cases does not say — what breaks when it is violated and
  whether anything CATCHES you
- `docs/hacks/` — one file per expedient we knowingly took (see the Standing Workflow rule above), plus a row
  in `docs/hacks/README.md`; a replaced hack MOVES to `docs/hacks/retired/` with what replaced it. Distinct
  from its neighbours: an edge case is what we CANNOT do, a restriction is what we MAY NOT design against, a
  performance lever is what we chose NOT to do, a hack is what we DID instead of the honest thing
- `docs/performance/` — when a change picks the RUNTIME path over a precomputed/baked one, or takes any
  deliberate cost for correctness, simplicity or moddability, record the alternative here in the same change:
  what it would save, what it would cost, what would have to be true to pull it. This is the plan-B list read
  when the frame budget is blown — a lever with a price attached, not a plan (one file per lever in
  `docs/performance/deferred-optimizations/` + a row in the README)
- `docs/gta-sa-original/` — **the ORIGINAL game and the real install we ship into, kept apart from anything
  describing OpenSA. Whenever we touch, change, configure or discover something about GTA:SA original — the
  reference install's plugins or ini settings, an adjuster that owns a limit, an exe fingerprint, a mod that
  is installed there, a stock behaviour we relied on — it is recorded here in the SAME change.** The install
  copy under `NO_COMMIT/` is temporary and gets deleted; `reference-install-config.md` is the verbatim
  capture that has to survive it, and `reference-install.md` is what the configuration MEANS for our plans.
  **Budget a map-content plan against the install we ship to, not against stock 1.0 — and say which one you
  picked**: two of the four ceilings `docs/restrictions/sa-target.md` makes you budget for are set to
  `unlimited` there, and designing down to a ceiling the target does not have is SILENT (the build works, it
  just carries far less than it could). A rule a new design must satisfy still goes in
  `docs/restrictions/` and links here for the measurement
- `docs/links.md` — when an external resource (repo, article, tool) proves useful, add it here
- `docs/commands.md` — when a command/CLI/param is added or changed, update this cheat sheet
- `docs/debug/` — when a debug script proves useful, KEEP it in `scripts/debug/` and add a row in
  `docs/debug/README.md` (what it answers + how to run) in the same change; throwaway experiments are
  `scripts/debug/.tmp-*.ts` and are deleted before commit
