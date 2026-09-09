# The default audio falloff (ref 5 m / rolloff 1 / max 300 m)

**Where:** `packages/audio/src/spatial.ts` — `DEFAULT_FALLOFF`, written 2026-09-09 with plan 203/3-02.
Consumed by `attenuation` (what a voice is heard at) and by `audibleGain` (what the pool RANKS by when it
steals), which are the same number on purpose.
**Stands in for:** SA's own per-sound maximum distance, which this project has not read and currently cannot.

## What the game actually does, and why it is not recoverable yet

SA carries a maximum distance PER SOUND — `CAESound` holds `m_fMaxDistance`, and the audio entities set it
per event when they queue a sound. That number lives in the executable's own audio code, not in any data
file this project parses: `audio/CONFIG/` carries a bank index and nothing about how far a sound reaches,
and the census of 2026-09-09 confirmed the three `.dat` files hold offsets, rates, loop points and headroom
only ([the row](../benchmarks/opensa-engine/2026-09-09-phone-audio-census.json)).

So there is no authored table to honour here **yet**. The reversed source
([gta-reversed](../links.md)) is where the per-event distances would come from, and reading them is a
research task 5/01 will have to do anyway when it writes the event table — at which point this file's job is
to be retired.

## What we do instead

The Web Audio `inverse` distance model with three constants, chosen rather than derived:

| parameter | value | the reasoning |
| --- | --- | --- |
| `refDistance` | 5 | inside a car's length, a sound is at full gain — below this the curve would only make close things louder than each other |
| `rolloffFactor` | 1 | the physical inverse law; anything else is a second fitted number on top of the first |
| `maxDistance` | 300 | the curve stops steepening here rather than cutting to zero, so a city seen from 900 m is faint instead of switched off — 203's decision 2.3, that the console's listener is the camera and altitude is quiet ON PURPOSE |

**What it was judged on: nothing yet.** No ear has heard it — the phone's tunnel went offline before this
step could reach a device, and the numbers are arithmetic against decision 2.3 rather than a field verdict.
That is the honest state, and it is why this file exists rather than a comment.

## What else moves if it changes

- **The stealing rule.** The pool steals the quietest voice at the listener, and "quietest" is this curve. A
  flatter rolloff makes distant voices compete with near ones for the 64 slots; a steeper one frees slots
  sooner and can cut a bed that should still be audible.
- **Nothing in the graph.** The gain a voice is played at IS `audibleGain`, so a change is heard and ranked
  by consistently — which is the whole reason the model is ours rather than a `PannerNode`'s.

## What would retire it

Either of these, and the second is the real answer:

1. A **field verdict** that a specific class of sound reaches too far or not far enough, which turns the
   constant into a tuned one — still a hack, but a measured one.
2. **5/01's event table carrying a per-event distance read out of the reversed source**, at which point
   `DEFAULT_FALLOFF` becomes what an event that names none falls back to, and this file moves to
   `retired/` with the commit that did it.
