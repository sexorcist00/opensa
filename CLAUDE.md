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

---

## Documentation Maintenance

Keep these in sync with the code — update them in the same change, not later:

- `docs/architecture/` — when a change alters architecture (modules, boot/loading flow, formats, streaming,
  pmb stages, tools), update the matching doc AND its diagram. Diagrams are mermaid blocks named `%%| <name>`
  rendered to `docs/architecture/assets/` by `npm run arch:render` — edit the block, re-render, commit both
- `docs/features/` — when developing a feature, update its file's state; a new feature gets its own new file
  (+ a row in `docs/features/README.md`)
- `docs/edge-cases/` — when a new limitation/constraint is discovered, add it to the matching file; when one
  is lifted, remove it. Only CURRENT limitations live there, no legacy
- `docs/performance/` — when a change picks the RUNTIME path over a precomputed/baked one, or takes any
  deliberate cost for correctness, simplicity or moddability, record the alternative here in the same change:
  what it would save, what it would cost, what would have to be true to pull it. This is the plan-B list read
  when the frame budget is blown — a lever with a price attached, not a plan (+ a row in its README)
- `docs/links.md` — when an external resource (repo, article, tool) proves useful, add it here
- `docs/commands.md` — when a command/CLI/param is added or changed, update this cheat sheet
