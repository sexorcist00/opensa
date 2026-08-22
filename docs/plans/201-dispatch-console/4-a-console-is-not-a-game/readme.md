# 201/4 — A console is not a game: the session and the battery

A game's frame loop runs flat out because a game is always moving. A dispatch map is **idle for most of a
shift**, on a device that runs hot and goes flat. Nothing in the engine knows the difference yet: the console
redraws a static city at full rate to show a call queue that changed once a minute.

This is engine work both consumers get — the game's pause menu and its photo mode have exactly the same
shape.

## Steps

### 01 — Render on demand

Draw a frame when something changed: the camera moved, the board ticked, the hour crossed, a selection
changed, a cell finished streaming. Otherwise do not.

The trap to design against is the one the restrictions already name in another form — a decision taken on a
threshold gets retaken next frame
([architecture](../../../restrictions/architecture.md#a-framing-decision-taken-on-a-threshold-will-be-taken-again-next-frame)).
"Nothing changed" must be a state the frame can read, not an event it can miss, or the console stops
redrawing while something is still moving.

**Budget:** name the latency allowance for the first frame after an input **before** building it. A map that
saves battery and feels sticky under the thumb has failed.
**Owes:** idle draw calls → 0, the wake latency measured against that budget, and a battery/thermal delta
over a shift-length idle on the [2/03](../2-real-device-truth/readme.md) device.
**If a cheaper version is rejected** for a better-feeling one, it goes to
[`docs/performance/deferred-optimizations/`](../../../performance/README.md) with its price.

**BUILT 2026-08-22; the battery delta is owed by the [2/03](../2-real-device-truth/readme.md) device.**

**The budget, named before the build:** the first frame after an operator's input is the NEXT animation
frame — one frame at the display's rate, never one idle period. It is met by the pointer, wheel and key
handlers re-arming the fast schedule in their own handler, so the idle poll never sits between a thumb and
the picture. The poll's own period, **100 ms**, is the separate budget for a change nobody touched (a board
tick arriving from the feed): PCAD publishes every 4 s, so it is two orders of magnitude inside the rate the
data arrives at, and under the threshold at which a change stops reading as immediate.

**"Nothing changed" is a STATE, exactly as the step demanded.** `RenderGate` compares the whole picture's
inputs — pose in all six degrees of freedom, the board by identity, the selection, the hour, the drawing
buffer's size, the sketch revision, and the streamer's pending/created/evicted counters — against the frame
that last DREW. A signal that arrives while the loop is asleep is still there when it looks, because it is a
value rather than a notification. `wake()` exists only to make the answer arrive sooner; it is never how the
answer is found. **Stopping the loop entirely** — the cheaper version — is [priced and
refused](../../../performance/deferred-optimizations/idle-loop-stop.md): an event-driven wake is one
forgotten `wake()` away from a map that looks frozen, and that is a silent regression the day somebody adds
a twelfth source of change.

**It is in BOTH modes**, and deliberately so: plan mode is the fallback a weak device gets, and redrawing a
still plan sixty times a second is the last thing such a machine needs.

**What idle costs the world:** the picture freezes, sway and UV scrollers included, until the next change.
Nothing is cut — the [protected list](../1-the-map-profile/protected-list.md) is about what the build and
the frame carry, not about a still map — and the first input resumes all of it
([edge-cases](../../../edge-cases/dispatch-console.md)). If a field verdict says a frozen world reads as a
hung one, the lever is an idle RATE rather than an idle stop.

**The claim is readable rather than asserted:** the status bar shows `idle` in place of a frame rate, and
`?inventory=1`'s report carries **`framesSkipped`** beside `frames` — a capture with 400 frames and 0 skips
was taken on a moving map, one with 40 frames and 3 600 skips on a console at rest, and the two cannot be
compared without it.

**Still owed:** the wake latency measured under a thumb and the battery/thermal delta over a shift-length
idle, both on the 2/03 device.

### 02 — The long session

Residency drift and texture-array growth over hours of panning. The rule to watch:
[a texture array that GROWS invalidates every render bundle recorded against it](../../../restrictions/gpu-and-shaders.md)
— a game session ends, an operator's does not.

**Owes:** resident MB at t=0 / 30 min / 2 h on the [pinned district](../1-the-map-profile/readme.md), and the count of bundle re-records over that
window. A drift with no ceiling is a finding, not a footnote.

## Verification

- The idle claim is read off a capture, not asserted: draws at rest, over a stated window.
- The wake latency is measured under the thumb, on the real device, and judged from the driver's seat as well
  as from the number — per
  [directive 4](../../../project-goals.md#4-better-must-be-demonstrated-not-assumed).
- The 2-hour session ends with the world still correct: cars and peds still drawn, the hour still turning
  (the [protected list](../1-the-map-profile/readme.md), re-read at the end of a long run rather than the
  start).
