# A surface ships on a phone AND on a desk, in the same change

**The rule.** Every operator-facing capability this project adds must be usable on a phone and on a desk
**when it lands**, not in a later pass. Concretely, a change that adds a control or a capability answers all
five of these or it is not finished:

| Question | The answer that counts |
| --- | --- |
| Can a FINGER hit it? | ≥ **44 CSS px** of target where the pointer is coarse (`TOUCH_TARGET`, `apps/dispatch/src/ui/styles.ts`) |
| Does it fit at **360 CSS px**? | the narrowest real device in this repo's record; nothing clipped, nothing crowded off the map |
| Is it reachable WITHOUT a keyboard? | every command has an on-screen path, or the capability exists only on a desk |
| Is it reachable without HOVER? | a `title=` is a bonus, never the only label — a finger has no hover state |
| Is it ONE component with two sizes? | not two layouts to keep in step, and not a second code path |

**44 is not ours.** WCAG 2.2's enhanced target-size criterion (2.5.5) says 44×44 CSS px, Apple's HIG says
44 pt, Material says 48 dp. 44 is the number all three agree is enough, so it is the one the token carries.

**Width and pointer are two questions, and answering one with the other is the usual mistake.** How WIDE the
viewport is decides what fits — panels beside the map, or a tabbed sheet under it. How it is POINTED AT
decides how big a target must be. They vary independently: a phone in landscape is wide and coarse, a laptop
with a touchscreen is wide and both, a small window on a desk is narrow and fine. `useCompactLayout()` and
`useCoarsePointer()` (`apps/dispatch/src/ui/use-compact.ts`) answer them separately, and neither is a
user-agent string.

**This is the SURFACE half of the platform rule already in
[architecture.md](architecture.md).** That one governs the frame: *the PC/mobile difference is a BUDGET the
frame reads, never a branch it executes, and never a second renderer.* This one governs everything above the
frame, and it is the same principle: one component that takes a size, not two components that drift.

## Why it is a restriction rather than a note

**It is SILENT in every way a repository can be silent.** The code typechecks. It lints. Every test passes,
because a test asserts behaviour and this is geometry. And — the part that makes it expensive — **it looks
perfect on the machine of whoever wrote it**, which on a desk is a 24-pixel button that a mouse hits every
time. Nothing in this repository measures a touch target, and no benchmark row has ever contained one.

The failure reaches the operator as *"this app is fiddly on my phone"*, which is unactionable feedback
arriving weeks later, about a control nobody remembers writing.

**Discovered 2026-08-22**, by being violated three times in one session while the console's operator
surface was built ([201/7-03](../plans/201-dispatch-console/7-the-operator-map/readme.md) and
[7/06](../plans/201-dispatch-console/7-the-operator-map/readme.md)):

- the map's turn, tilt and zoom controls were **24×24 px** — under half the minimum, and invisible as a
  defect on the desk they were written on;
- the search hits and saved views were ~19 px rows, same class;
- and the sharpest one: the three **zoom levels existed only on keys `1`/`2`/`3`**, so on a phone — the
  device this whole console is aimed at — that capability did not exist at all. A capability that lives only
  on a keyboard is a capability that ships to one platform.

All three are fixed in the change that wrote this file. What that fix looks like is the pattern to copy: one
component, a `touch` flag from `useCoarsePointer()`, and a second size token beside the first.

## Caught, or silent?

**SILENT.** Nothing here is caught by a test, a lint rule or a build guard today. The honest checks are:

- a **real phone**, which the development machine already is
  ([development/termux.md](../development/termux.md)) — this is why
  [201/3](../plans/201-dispatch-console/3-the-operator-surface-on-a-phone/readme.md) exists and why its
  360-px layout spec is owed before, not after;
- and a reviewer reading a diff for the five questions above, which is what this file is for.

A lint rule over inline style objects would catch the target size (the sizes are literals in
`styles.ts`), and nothing prevents writing one when this bites a second time.
