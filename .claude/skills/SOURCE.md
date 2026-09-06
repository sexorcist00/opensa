# Vendored skills — where they came from, and where this project overrules them

Six skills copied 2026-09-06 from [`mattpocock/skills`](https://github.com/mattpocock/skills) at `3cca18b`
(MIT, copyright (c) 2026 Matt Pocock — the licence travels with the files and this note is the attribution):
`codebase-design`, `diagnosing-bugs`, `handoff`, `research`, `tdd`, `writing-for-agents`.

`grill-me` / `grilling` come from the same repo and the same commit, and carry their own note —
[`grilling/SOURCE.md`](grilling/SOURCE.md) — because their deviation is a rule in `CLAUDE.md`.

**Verbatim, and it must stay that way.** A vendored file that drifts is one nobody can update: to refresh,
re-copy the folder from upstream and re-read this note. Nothing here has to be re-applied to the files.
Only `agents/openai.yaml` is dropped from each — it is a Codex host manifest that Claude Code never reads.

## Where this project overrules them

Each line below is a place where the skill's instruction and this repository's rules disagree. **The
repository wins**, and the skill is otherwise followed as written.

- **`handoff` — the handoff does NOT go to the OS temp directory.** The skill says to save it outside the
  workspace; here that is the one thing it may not do. The repo is the only memory agents share
  (`CLAUDE.md`, first workflow rule), a web container's temp folder does not survive the session, and a
  handoff nobody can find is a session paid for twice. It goes to the active plan's folder —
  `docs/plans/201-dispatch-console/handoff.md` today — beside the `## Status` table it refers to.
- **`research` — the findings file goes where the docs lifecycle puts it**, not "somewhere sensible":
  `docs/README.md` decides (a fact about the ORIGINAL game is `docs/gta-sa-original/` by rule, an unproven
  direction is `docs/ideas/`, a go/no-go review is `docs/concepts/`), and any external resource that proved
  useful also earns a row in `docs/links.md`. The skill's "primary sources, never a write-up of them" is the
  same instruction as this project's "dig out the original game's real formula".
- **`tdd` — the layout rule is this repo's.** Negative cases in their own `describe` first, positive cases in
  a second one, a blank line between (`CLAUDE.md` → Test Structure); the skill's flat `test(...)` examples
  show what to assert, not how to arrange it. What gets RUN is the Cost Saving Rules' answer: the affected
  tests, not the suite. Its pointer to a `code-review` skill has no target here — that skill is not
  installed; superpowers' `requesting-code-review` is the near equivalent.
- **`tdd` and `diagnosing-bugs` — there is no `CONTEXT.md` and there are no ADRs.** Both read them for the
  project's vocabulary. The equivalent here is the reading chain at the top of `CLAUDE.md`
  (`docs/project-goals.md` -> `docs/restrictions/` -> plan 202 -> plan 201's `## Status` table), plus
  `docs/architecture/`, `docs/contracts/` and `docs/edge-cases/` for the area being touched.
- **`diagnosing-bugs` — the human in the loop is holding a phone.** Its `scripts/hitl-loop.template.sh`
  assumes a desktop shell; the development machine is Android/Termux (`docs/development/termux.md`), and the
  instruments that already answer a one-model question in seconds are in `docs/debug/README.md`. Reach for
  those before scripting a human.
- **`codebase-design` — `DESIGN-IT-TWICE.md` dispatches sub-agents**, which this project spends only when the
  user asks for it. The vocabulary half (module, interface, depth, seam, adapter, leverage, locality) is a
  reference to consult and costs nothing.
- **`writing-for-agents` — read it before editing `CLAUDE.md` or any skill here.** It is the only one of the
  six with no project deviation, and its subject is this repository's largest always-loaded document.

## Deliberately NOT installed

Upstream carries 27 more. These were declined for a reason worth keeping, so nobody re-opens the question:

- **`git-guardrails-claude-code`** — it installs a PreToolUse hook that blocks `git push`. This repo already
  denies force-pushes, hard resets and the rest in `.claude/settings.json`, and the user has explicitly
  granted plain pushes to `main`. Installing it would revoke a permission the user gave.
- **`setup-pre-commit`** — husky and lint-staged are already configured.
- **`migrate-to-shoehorn`**, **`scaffold-exercises`** — for codebases this is not.
- **`to-spec`, `to-tickets`, `triage`, `wayfinder`, `implement`, `setup-matt-pocock-skills`** — all six write
  to an issue tracker. Plans live in `docs/plans/` here, not in GitHub Issues.
- **`ask-matt`** — a router over skills, most of which are not installed.

The rest (`code-review`, `domain-modeling`, `resolving-merge-conflicts`, `prototype`, `grill-with-docs`,
`wizard`, `improve-codebase-architecture`, `teach`, `to-questionnaire`, `wait-what`) were simply not chosen
this round; they are re-installable from the same commit with a folder copy.
