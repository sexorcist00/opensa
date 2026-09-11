# Plan 204 — the console's own voice, chains 1–4

**2026-09-11.** [Plan 204](../plans/204-panel-audio/readme.md) opened the day before on a live defect and
closed four of its five chains in one session. This is the post-arc audit the
[big-rework rule](../../CLAUDE.md) asks for: what changed, what it cost, what it bought — and, because half
of what it bought cannot be claimed yet, what is still owed.

## What changed

| | |
| --- | --- |
| Commits | 11 in `sexorcist00/opensa`, 1 in `sexorcist00/pcad` |
| Lines | ~2 780 added across 42 files here; 147 added / 30 removed across 2 files there |
| Tests | 176 in `@opensa/audio`, 876 across the app and the packages |
| New modules | `panel-events`, `panel-sounds`, `tones` (engine); `board-events`, `cad-link`, `cad-mock`, `use-cad`, `panel-notices` (console) |
| Docs | a new contract, a new restriction, and rows in the features file, the query-parameter table, the roadmap and the plan index |

The mixer underneath it — three buses, a limiter, ducking, four mixes and an alert floor — landed in chain 1
and is described in that plan's Status table rather than repeated here.

## What it bought

**The defect the plan opened on is gone, and it was real.** `VoicePool` ranked a positionless sound by its
bare gain against the city's own voices, so a panic button authored below the loudest engine could be
refused. Nothing errored; one refusal was counted among all the others. It had shipped in `main` for a day
and was invisible only because nothing yet played a panel alert. The budget that catches it —
`refusedByBus.cad`, whose value is zero — is now in every capture.

**A vocabulary two repositories are built against.** Eighteen names, three categories with one owner each,
and the test that separates them: *can the console see it in the board it already holds?* PCAD's side is
[PR #13](https://github.com/sexorcist00/pcad/pull/13).

**Four events that had no sound at all**, including the two that matter most: a dispatcher working a board
that LOOKS live while nothing is arriving, and a unit pressing panic.

**A floor that cannot fail.** Every name resolves to a synthesised tone when no file answers, and the report
says which layer did. A computed tone is the one sound in this chain with no failure mode to inherit.

## What it cost

**Six defects a review found after the work was called done**, and the shape of them is the finding. Two
were about what an operator sees — a `PANIC BUTTON` line painted underneath an agent notice because both
strips shared one absolute position, and a panic evicted from the stack after 3 s by three routine chimes,
defeating the whole reason it is held for 15. Two were about the events themselves — a unit re-directed
straight from one call to another was silent, and the diff read the board at the SHIFT CLOCK, so scrubbing
the timeline would have raised an alert for every unit that arrived an hour ago. One was a field that lied
on the silent baseline. One was in a test fixture.

**None of them would have been caught by a test that was written, and none of them errored.** That is the
same sentence [203's audit](./2026-09-09-audio-chain.md) ended on, and it is the honest cost line: this
chain's instruments are good at the parts that have numbers and blind to the parts that have geometry and
timing.

**One structural mistake, corrected inside the session.** 3/02 built the CAD link inside `DispatchAudio`,
which lost the SCREEN three ways at once — `?audio=0` never starts the audio tick, plan mode has no audio
object, and a throwing sink would have taken the fan-out with it. It is now a
[restriction](../restrictions/architecture.md): *an event's own feed may not live inside the channel that
plays it.* The rule is cheap to state and was not obvious while writing 3/02.

## What is owed, and why it is not a footnote

**Every number.** The budget table is named and unmeasured: event → audible against 50 ms, the output peak
against 1/02's predicted −4.8 dBFS, voices per bus at peak, ms/tick against 2 ms, MB against 64, and the
battery delta against `?audio=0`. 5/01 made the capture able to ANSWER all of them — `voices.peakSample` and
`voices.peakByBus` are new for exactly that — and this container has no phone. **No benchmark row accompanies
this audit**, which the big-rework rule asks for and which cannot be honestly produced from here.

**No ear has heard any of it.** The tone vocabulary is arithmetic. The PCAD sound mappings in PR #13 are
placeholders assigned so that no two events sound alike; the priority three are assumed to be stingers
rather than three parts of one phrase, on the evidence that their formats differ. All of it wants the
operator's verdict.

**The authored files are not in the bundle.** 2.9 MB against a 1 MB budget. That is the budget doing its job
rather than an obstacle, and until they are transcoded every panel name is on the synthesised floor — which
the report states, so a capture cannot quietly be about a build nobody meant to measure.
