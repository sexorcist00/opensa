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
- An OBJECT SHAPE is an `interface`, not a `type` — `@typescript-eslint/consistent-type-definitions` is on
  and rejects `type Foo = { … }` with _"Use an `interface` instead of a `type`"_. `type` stays for what an
  interface cannot say: unions, intersections, mapped/conditional types, aliases of primitives and tuples
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

- **SEVERAL AI AGENTS WORK ON THIS PROJECT, AND THEY SWAP. The repo is the only shared memory they have —
  so START EVERY SESSION BY READING THE CHAIN BELOW, IN THIS ORDER, BEFORE PLANNING OR WRITING ANYTHING.**
  An agent that skips it does not merely lack context: it re-decides a settled question, re-lands work that
  is already in, or contradicts a decision taken with the user, and none of that is visible to the user until
  it has cost a session.
  1. `docs/project-goals.md` — what the project is FOR (directive, not aspirational)
  2. `docs/restrictions/README.md` — what a design MAY NOT do
  3. `docs/plans/202-pcad-dispatch/readme.md` — **THE FINAL PLAN**: the product is a web dispatch application
     for a SA-MP server, and this repository owns exactly one component of it — **the 3D map**
  4. `docs/plans/201-dispatch-console/readme.md` — **THE 3D MAP ENGINE PLAN**, subordinate to 202: 8 chains,
     32 steps, with the decisions table, the evidence table, its "steps at a glance" index, and — at the
     bottom — the **`## Status` table, which is the handoff point between agents**
  5. `docs/plans/README.md` — every other plan, newest first, each marked IN PROGRESS or not
  6. `roadmap.md` — the long checklist of what is done and what is left

  **The `## Status` table of the active plan is the state of the project, and keeping it true is part of
  doing the work, not paperwork after it.** Move a step to IN PROGRESS when it starts and to DONE with its
  measured numbers when it ends, in the SAME change — a step whose table still says "not started" while its
  code is merged is how the next agent concludes the work was never done and does it twice. If the reading
  above and the code disagree, the CODE is the truth and the doc is the bug: fix the doc in that session.

- **`main` IS THE ONLY BRANCH THAT SURVIVES. Work lands there, and the branch that carried it is DELETED —
  local and remote — in the same session.** A finished branch left on the remote is not a backup, it is a
  decoy: five of them accumulated once, and answering "is anything lost?" cost a full session of archaeology.
  Merge, verify, delete the local branch (`git branch -d <branch>`) — and then **HAND THE REMOTE DELETION TO
  THE USER, because the agent cannot do it.** `git push origin --delete` returns `HTTP 403` from the session's
  token: pushing commits is allowed, deleting a ref is not, and no GitHub MCP tool deletes a branch either.
  So the last step of any session that merged a branch is to END THE REPLY with the exact command, listing
  every branch verified as contained — never a vague "you can clean these up":

  ```bash
  for b in <branch> <branch>; do git push origin --delete "$b"; done && git fetch --prune
  ```

  Nobody else will notice these; if the reminder is not written, the branches stay forever.
  **When checking whether a branch is already in `main`, compare CONTENT, never commits.** `git cherry`,
  `git log main..branch` and the merge-base all compare patch-ids, and a rebase changes every one of them —
  they will report a dozen "missing" commits that are already in `main`, and hide the one that genuinely is
  not. This is SILENT: it fails by making you re-land work that is present, or by declaring a branch clean
  while a file on it exists nowhere else. Diff the file blobs (`git cat-file -e main:<path>` for existence,
  blob hashes for content), and check the DIRECTION before merging anything — `main` is usually the newer
  side, and the branch is a stale ancestor whose "missing" work would be a regression if replayed.

- **THIS REPOSITORY IS A FORK, AND UPSTREAM MOVES WITHOUT US. PULL IT AT THE START OF EVERY SESSION**, in
  the same breath as the reading order above:

  ```bash
  git remote add upstream https://github.com/AlexSergey/opensa.git   # once per clone
  git fetch upstream main && git log --oneline main..upstream/main | head -30
  ```

  `origin` is `sexorcist00/opensa`; the parent is **`AlexSergey/opensa`**, where the engine's own line of
  work continues. Nothing tells you it moved — `git status` is clean, `origin/main` is up to date, and the
  divergence only shows up when someone asks for it. The first time it was asked, 2026-08-08, upstream was
  **93 commits ahead** of the fork point while this side carried 57 of its own, and the cost of waiting was
  visible in the merge: a conflict in `docs/links.md` where upstream had already repointed a link this side
  still cited, a function that crossed the complexity gate because both sides had grown branches in it, and
  — the expensive one — **upstream code that silently undid a fix of ours**, because it was written against
  a flag that does not exist over there (`bucketDictionary` encoding model textures without the build's
  texture format, which ships BC into a pak built for a GPU that has none). **That class of bug is what a
  late merge costs**: not a conflict marker, but a clean auto-merge that is wrong, and it gets worse with
  every week of divergence. Merge (never rebase — `main` is pushed), and read the upstream commits for what
  they mean rather than only for what conflicts.
  **THE FORK'S PLANS LIVE IN A `2xx` BLOCK, and that is why.** Both sides numbered forward from 096 without
  knowing about each other, so for two days `097`, `098` and `099` each named two unrelated chains — which
  made every bare citation ambiguous, this file's reading order included. Renumbered 2026-08-08:
  **`200-platform-reach`, `201-dispatch-console`, `202-pcad-dispatch`**, and anything the fork adds continues
  from `203`. Upstream keeps `0xx`/`1xx` and will not reach 200 for years. A citation older than that date
  reads `098/1-01` where the repo now says `201/1-01`.

- **THE DEVELOPMENT MACHINE IS AN ANDROID PHONE RUNNING TERMUX.** Every command handed over is run there, so
  write commands for that environment or they waste the user's time: no `sudo`, `pkg` rather than `apt`,
  paths under `$PREFIX`, and a long job needs `termux-wake-lock` or Android suspends it. The user **has the
  game files and can build paks**, so anything gated on game data is runnable — but assume **phone-scale RAM
  and no desktop**: the `build:game:*` scripts ask for a 12 GB heap (`--max-old-space-size=12288`), which is
  a desktop number, and **Playwright/Chromium headless is effectively unavailable**, so anything that drives
  a browser has to run in the phone's own browser against `npm run dev` instead of a headless capture.
  A "desktop baseline" is not automatically available — see `docs/development/termux.md`.
  **THERE IS NO PC. The game files live on the phone, and WHERE they live is written down** — the game copy,
  the pristine `GTA CORP.rar` every restore comes out of, where build output may and may not go, and the two
  search traps that make a wrong `find` answer "there is no game here" (`~/storage/shared` does not exist,
  and `find` needs `-L` for a symlink argument). The table is in `docs/development/termux.md` → _Where things
  are on the phone_; **read it before writing any command that carries a path**, and never invent a source
  location or hand over a `<placeholder>` — bash will run it literally.
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
- `tools/<tool>/docs/plans/` — **where a plan step LANDS once it is built.** Every tool keeps its own numbered
  chain beside its code; when a step from `docs/plans/` or `docs/roadmap/` ships inside one tool, its file
  MOVES there (next free number, measured numbers filled in) and the central row is repointed. The central
  folders carry what is still unbuilt or spans several tools
- `docs/audit/` — a post-big-rework audit (see the Standing Workflow rule above): what changed, its cost, its
  gain

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
