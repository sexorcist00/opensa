# Where this came from

Vendored 2026-09-06 from [`mattpocock/skills`](https://github.com/mattpocock/skills) at `3cca18b` —
`skills/productivity/grilling` and `skills/productivity/grill-me`. MIT, copyright (c) 2026 Matt Pocock;
the licence travels with the files and this note is the attribution.

**Both halves, because that is how upstream ships it.** `grill-me` is the user-facing trigger and carries
`disable-model-invocation: true`; it does nothing but point at `grilling`, which holds the instruction.
Installing only one gives you a shim with no body or a body nobody triggers.

**Verbatim, and it must stay that way** — a vendored file that drifts is one nobody can update. To refresh:
re-copy both from upstream. Nothing here has to be re-applied.

## Where this project deviates, deliberately

The skill prescribes a PROSE round — numbered questions with `❓` / `➡️` and a recommended answer each.
**This repository requires the Ask Menu (`AskUserQuestion`) instead, and only that** (the user's call,
2026-09-06; the rule is in [`CLAUDE.md`](../../../CLAUDE.md)). The reason is the same one the skill has for
its format: a question the user can read past is a decision they did not make. The Menu enforces that; a
formatted paragraph asks them to notice.

Everything else about the skill applies unchanged, and the parts worth reading twice:

- **Rounds and a frontier.** Ask every question whose prerequisites are settled, together; wait; recompute.
  A question depending on another still open belongs to a LATER round. The Menu takes four at a time, so a
  wide frontier is several calls in one round rather than several rounds.
- **Finding facts is the agent's job, never the user's.** Anything the filesystem, the tools or the plan
  chain can answer is looked up, not asked. That is the same instruction as this project's "research first".
- **Done when the frontier is empty**, and not before: nothing silently assumed, and no acting on it until
  the user confirms the shared understanding.
