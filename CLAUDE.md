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
  own numbers are not being read yet

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
- `docs/audit/` — a post-big-rework audit (see the Standing Workflow rule above): what changed, its cost, its
  gain

Keep these in sync with the code — update them in the same change, not later:

- `docs/architecture/` — when a change alters architecture (modules, boot/loading flow, formats, streaming,
  pmb stages, tools), update the matching doc AND its diagram. Diagrams are mermaid blocks named `%%| <name>`
  rendered to `docs/architecture/assets/` by `npm run arch:render` — edit the block, re-render, commit both
- `docs/features/` — when developing a feature, update its file's state; a new feature gets its own new file
  (+ a row in `docs/features/README.md`)
- `docs/contracts/` — when a NAME starts carrying behaviour (a file the pipeline looks for, a frame/material
  the converter reads, a data row a tool writes), record it in the matching subject file. These are the rules
  a mod author cannot guess and a reader cannot grep for
- `docs/edge-cases/` — when a new limitation/constraint is discovered, add it to the matching file; when one
  is lifted, remove it. Only CURRENT limitations live there, no legacy
- `docs/performance/` — when a change picks the RUNTIME path over a precomputed/baked one, or takes any
  deliberate cost for correctness, simplicity or moddability, record the alternative here in the same change:
  what it would save, what it would cost, what would have to be true to pull it. This is the plan-B list read
  when the frame budget is blown — a lever with a price attached, not a plan (one file per lever in
  `docs/performance/deferred-optimizations/` + a row in the README)
- `docs/links.md` — when an external resource (repo, article, tool) proves useful, add it here
- `docs/commands.md` — when a command/CLI/param is added or changed, update this cheat sheet
- `docs/debug/` — when a debug script proves useful, KEEP it in `scripts/debug/` and add a row in
  `docs/debug/README.md` (what it answers + how to run) in the same change; throwaway experiments are
  `scripts/debug/.tmp-*.ts` and are deleted before commit
