# The twin-loop swap window, its crossfade, and the bed's height bounds

Six numbers in [`packages/audio/src/ambience.ts`](../../packages/audio/src/ambience.ts), taken 2026-09-09
while building [203/4-02](../plans/203-audio/readme.md). They are the whole of what is fitted in the
ambience bed — the MECHANISM around them is recovered, not invented
([how SA makes a place sound like a place](../gta-sa-original/audio-ambience.md)).

## 1. What it is

```ts
export const TWIN_SWAP_MIN_MS = 1_500;
export const TWIN_SWAP_MAX_MS = 6_000;
export const TWIN_SWAP_SECONDS = 0.025;
export const CROSSFADE_SECONDS = 2;
export const BED_FULL_HEIGHT = 60;
export const BED_SILENT_HEIGHT = 400;
```

- **The swap window** — how long a twin plays one of its two voices before the volumes are exchanged, drawn
  uniformly from the range.
- **The exchange ramp** — how long that exchange takes.
- **The crossfade** — how long one zone's bed takes to replace another's.
- **The height bounds** — the bed is at full volume at or below `BED_FULL_HEIGHT` and silent at or above
  `BED_SILENT_HEIGHT`, linear between.

## 2. What they stand in for

**San Andreas keeps every one of these at its call site, in the executable.** `CAETwinLoopSoundEntity` takes
`swapTimeMin` / `swapTimeMax` as constructor arguments, and each caller passes its own — rain is 65–350 ms,
and the rest are wherever the entity that owns them is constructed. There is nothing in `audio/CONFIG/`, in
any IPL, or in any file this project parses that carries them, so there is no data to read the way
`handling.cfg` is read. The same is true of `CAEAmbienceTrackManager`'s per-zone volume rules: they are a
hand-written `switch`, which [directive 1](../project-goals.md) puts out of reach.

Three of the six also have no original at all, because the original does not do the thing:

- SA exchanges the two volumes **instantly** (`next->m_Volume = std::exchange(curr->m_Volume, -100.f)`), so
  it has no ramp to copy. `TWIN_SWAP_SECONDS` is ours, and it exists because a step in an envelope is a
  broadband transient — the same defect `voices.ts` already ramps away from when it steals a voice.
- SA has **no bed to crossfade**: its zone tracks are streams started and stopped by a state machine, and it
  plays no general ambience at all. `CROSSFADE_SECONDS` is a number for a thing SA does not have.
- The **height rule** has a real precedent but not a real number: SA's zone 4 falls with camera height below
  `z = 1372`, a value chosen for one place. Ours is global because our listener is a dispatch camera that
  routinely sits at 900 m, which SA's never does.

## 3. What they were judged on

**Arithmetic against the census, and nothing else yet — no ear has heard them.**

- The [2026-09-09 census](../benchmarks/opensa-engine/2026-09-09-phone-audio-census.json) found **351
  looping sounds, 172 of them at least a second, the longest 5.25 s**. A swap window of 1.5–6 s therefore
  lands neither inside every cycle of the shortest loop (which would be a stutter) nor once a minute (which
  would leave the loop's own period audible for long stretches). SA's 65–350 ms is a rain-shaped number for
  a rain-shaped sound and does not transfer.
- **25 ms** for the exchange: a linear crossfade between two uncorrelated points of one recording dips about
  3 dB at its midpoint, and 25 ms is short enough for that dip to read as texture while being far longer
  than the ~1 ms an envelope step needs to click.
- **2 s** for the zone crossfade: long enough not to read as a cut when a camera pans across a boundary at
  console speed, short enough that a deliberate move into a place is heard as arriving there.
- **60 m / 400 m**: the console's own camera range. 900 m is its rest height (silent), and the map is
  legible as a place from about 400 m down.

## 4. What would retire them

- **The operator's ear on the phone**, which 4/02's own verification asks for and which has not happened —
  these are the numbers that round would move.
- A per-zone or per-bed override in `data/audio-events.dat`, if the field says one window cannot serve a
  fan hum and a seafront.
- For the height rule: a real listener model with air absorption, which would make it fall out rather than
  be stated. Nothing in this chain needs one.

## 5. Blast radius

- `TWIN_SWAP_*` changes only how often a bed's texture jumps; nothing else reads them. Too short is a
  fluttering bed, too long is an audible loop period.
- `TWIN_SWAP_SECONDS` at 0 restores SA's behaviour exactly, and the click with it — the test
  `exchanges the twin volumes at its interval` fails if it is set there, deliberately.
- `CROSSFADE_SECONDS` also sets how long a bed lives after the listener leaves its zone, because a bed is
  retired when its level reaches 0. A long crossfade means more concurrent voices at a boundary, against the
  64-voice budget.
- `BED_*_HEIGHT` is the only thing making the console quiet at rest. Raising `BED_SILENT_HEIGHT` past the
  camera's 900 m rest height makes every idle console audible, which would change 4/03's battery row.
