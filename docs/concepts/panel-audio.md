# Panel audio, and what AAA actually costs

**Opened 2026-09-10**, on the user's request, paraphrased in English because this repository is English-only:
*a AAA audio system for the dispatch panel — it already handles the game's sounds, and now it needs the
PANEL's, almost all of which are shared with PCAD while some belong to the console alone.*

Two questions, and they are **not** the same one:

1. **What does the panel have to SAY?** The dispatcher's work makes events — a call arrives, a unit panics,
   the board goes stale — and none of them is a sound in San Andreas' banks. Where do those sounds come from,
   what are they called, and who else speaks the same names?
2. **What is missing between what [203](../plans/203-audio/readme.md) built and something anybody would call
   AAA?** Directive 6 says AAA is a measurable claim rather than a mood, so this half is a list of named
   defects with named fixes, not an aspiration.

**No code, and no plan yet.** This is the research record and the go/no-go. The decisions it opens go to the
Ask Menu before anything is written.

---

## 0. What exists today, checked rather than remembered

Read out of the tree on 2026-09-10, not from memory:

| Piece | State |
| --- | --- |
| `@opensa/audio` | context + autoplay gate, 64-voice pool, spatial model, zone lookup, ambience bed, the recovered dummy-engine model, absence reporting |
| The console | hears the world: the ambience bed, and every unit's engine and siren |
| The event table | `data/audio-events.dat` — our own vocabulary, authored, overridable, [documented](../contracts/audio.md) |
| Mixing | **one** master gain. No buses, no compressor, no limiter, no ducking |
| Panel sounds | **none.** Nothing the console does about itself makes a sound |
| Volume | four steps on one key, **not persisted** — a reload is full volume again |

And one defect that falls straight out of reading `voices.ts` against `spatial.ts`:

> **An alert can be refused by 64 car engines.** The pool ranks a voice by `audibleGain`, which for a
> positionless sound (`source === null`) is its bare gain. A panel alert authored at 0.8 therefore ranks
> BELOW sixty-four engines at 1.0 near the camera, and `play` returns `null`. Nothing reports it as anything
> but a refusal count.

That is not a bug in decision 4.2 (*steal the quietest at the listener*) — that rule is right, and it is right
**within the world**. It is a bug in having one pool for two things that are not comparable.

---

## 1. The fact that decides the architecture

[Plan 202's phase 3](../plans/202-pcad-dispatch/readme.md#phase-3--the-map-becomes-vibecodes-module-10-both-repos)
says the console becomes **module 10 of PCAD's own React rewrite** — an imperative map island inside somebody
else's shell.

**So a panel-sound system built inside `apps/dispatch` is thrown away at phase 3**, or worse, ends up fighting
PCAD's own. The call list, the unit list, the radio panel — the chrome that generates almost every event in
question — will be PCAD's, not ours.

The shape that survives phase 3 is the one this repository already uses for everything else at that seam:

- **the engine layer owns the EAR** — the context, the buses, the voices, the world;
- **the shell owns the EVENTS** and names them;
- **the vocabulary is a CONTRACT** both sides are built against, exactly as
  [202 phase 2](../plans/202-pcad-dispatch/readme.md) does for the position protocol.

`DispatchAudio.play(name, position)` is already name-based, so the seam exists. What does not exist is the
vocabulary, the buses, and the guarantees.

**And that is what "almost all of them shared with PCAD" means structurally**: an event of the WORK belongs to the dispatch
domain, which PCAD owns and the map merely reflects — so its sound belongs to a vocabulary both speak, and the
Lua client can make the same sound for the same event as the browser. An event of the MAP is ours alone,
because the map is ours alone.

---

## 2. What the panel has to say

Split by **who owns the event**, which is the split that survives phase 3.

### 2a. Shared with PCAD — the work

**This section was a guess until 2026-09-10 and is now a reading.** `sexorcist00/pcad` was cloned and its
client read: **PCAD already has a panel-sound system**, with files, a volume, a settings key and a nine-entry
event vocabulary. Nothing here needs inventing — it needs adopting.

#### What PCAD actually has

`client/moonloader/cad_system/cadui.lua` carries a **two-level indirection that is the same shape as ours**:
a trigger name resolves to a sound id, and a sound id resolves to a file. `audio-events.dat` maps a name to a
bank and a slot the same way. The two designs met independently, which is the signal 202 already trusts about
the map seam.

```lua
local interface_sound_triggers = {
    notification     = "insert_07",        alpr_hit         = "outro_01",
    panic_button     = "panic_button",     assist_request   = "priority_start",
    simplex_request  = "insert_07",        simplex_accepted = "simplex_accept",
    simplex_declined = "simplex_decline",  call_created     = "dispatch_intro_02",
    incident_created = "insert_02",
}
```

Twenty-seven files under `cad_system/resource/sound/` (~2.9 MB): `DISPATCH_INTRO_01/02`, `INSERT_01..07`,
`INTRO_01/02`, `OUTRO_01..03`, `IN_01/02`, `OFFICER_INTRO_01/02`, `SIMPLEX_ACCEPT/DECLINE`,
`SirenSwitch`, `SirenToggle`, `PANIC_BUTTON.mp4`, and **`priority_start` / `priority_middle` / `priority_end`**
— the classic three-part priority-tone structure. A separate `_cadparserradio.lua` loads an *Immersive Radio*
RTO/CPD voice library (`AI_OFFICER_REQUEST_BACKUP`, `ATTENTION_THIS_IS_DISPATCH_HIGH`, `ROGER`, `TRAFFIC_STOP`
…) from the player's own MoonLoader tree.

There is already a master volume (`settings.set('audio_settings', 'master_volume', …)`) and a mute icon in the
UI, so **G7's persistence is solved on that side and not on ours**.

#### Three things the reading found that a guess would not have

1. **`alpr_hit` and the `simplex_*` handshake exist and were not in the guessed list.** An automatic
   licence-plate hit and a request/accept/decline exchange are real dispatch events with real sounds already
   assigned.
2. **The priority tones are ASSETS but not a priority.** `priority_start` is wired to `assist_request`;
   `priority_middle` and `priority_end` are loaded and never played. The three-part structure a dispatch
   console wants is sitting there unused.
3. **The trigger is resolved by string-matching the notification TITLE**, and that is fragile in a way worth
   fixing rather than copying:

   ```lua
   if title_lc:find("assistance request", 1, true) then return "assist_request" end
   ```

   Reword a title, translate it, or fix a typo in it, and the sound stops — silently, with the notification
   still appearing. A shared contract that names the event explicitly is the fix, and it is a reason for the
   contract that has nothing to do with our map.

#### What PCAD does NOT have, and a dispatcher needs

| Missing | Why it matters |
| --- | --- |
| **`link_lost` / `link_back`** | A dispatcher working a frozen board that looks live is the worst failure this product has. Nothing sounds when the WebSocket drops |
| **`unit_stale`** | The backend marks a unit stale at 300 s; a silent unit looks identical to a parked one |
| **call priority** | `call_created` is one sound for P1 and P3 alike, while [DESIGN.md](../../apps/dispatch/DESIGN.md)'s rule is that priority is carried by every channel that carries anything. The assets for it are already on disk |
| **`bolo_new`** | 202 lists BOLO as a module; no trigger for it |

### 2b. Console-only — the map

**Deliberately almost empty, and that is the recommendation.** A dispatcher works an eight-hour shift; a
console that chirps at its own chrome is one an operator turns off, and an audio system that gets turned off
protects nobody. AAA restraint here means being loud about the WORK and nearly silent about ourselves.

| Name | The event | Why it might earn a sound |
| --- | --- | --- |
| `MAP_LIMIT` | a zoom or tilt gesture hit its bound | The one case where silence is genuinely ambiguous: the gesture did nothing, and nothing is also what a broken surface does |
| `MAP_PICK` | an entity was picked | Arguable. The visual answer is immediate and unmistakable, so this is a candidate for *no sound at all* |
| `MAP_READY` | the world finished streaming | Arguable. Useful once, at open, on a slow phone |

---

## 3. Where panel sounds come from — the question the reading reopened

The concept's first draft recommended **synthesis**, on a reliability argument: a tone that is computed cannot
be missing, and every other failure in this chain takes a sound away. That argument still holds. What the
reading adds is that **the other side of the shared vocabulary is not synthesised** — PCAD plays 2.9 MB of
authored `.wav`, including voiced dispatch lines.

| Source | For | Against |
| --- | --- | --- |
| **Synthesised in code** | Zero bytes, zero licence, no fetch, no decode, **cannot 404**, sample-rate independent, deterministic, audible within one audio quantum. Exactly the right timbre for tones | A tone is a tone — no voice, no equipment character. **And the console would not sound like PCAD**, which is the opposite of a shared vocabulary |
| **PCAD's own files, served to the browser** | The two surfaces sound like ONE product. The set already exists, is already named, and is already what operators know | They live in the player's MoonLoader tree, not on a web server, so delivery is new work. **Provenance is a real question**: the RTO/CPD lines come from a third-party *Immersive Radio* pack, and a Lua script reading files a user installed is not the same act as a server distributing them |
| **The game's own banks** | Free, already delivered, already addressed | **San Andreas has no dispatch tones.** A car horn as a P1 alert is a joke, not a design |

**The recommendation is now a layered one**: synthesis as the FLOOR that cannot fail, PCAD's files as the
VOICE where they can be delivered and their provenance is clear. That is not fence-sitting — it is the same
shape `audio-events.dat` already has, where a name resolves to whatever this build carries and absence is a
reported state rather than an error. A deployment that can ship the files sounds like PCAD; one that cannot
still alerts, and says so in its report.

## 4. The eight gaps between here and AAA

Ordered by what actually bites, not by size. Each is a named defect with a named fix, per directive 6.

### G1 — One pool for two incomparable things (**the alert can be refused**)

Measured above. **Fix: buses.** `master → { world, panel }`, each a gain node, and the stealing rule applies
*within* a bus. The panel bus reserves a small number of voices the world can never take. This is not the
per-category priority table decision 4.2 refused — that decision was about ranking the world's own sounds
against each other, and it still stands inside the world bus.

### G2 — No ducking (**an alert over a city bed is unintelligible**)

**Fix:** the panel bus ducks the world bus by a fixed amount for the length of the alert plus a release. This
is the single biggest perceived-quality win available and it is a handful of lines against a gain node, using
the ramp API `voices.ts` already grew.

### G3 — No limiter (**64 voices summing can clip**)

Clipping is the most recognisable *not-AAA* artefact there is, and nothing in the chain prevents it: the pool
sums up to 64 voices plus the panel into one gain. **Fix:** a `DynamicsCompressorNode` (or a soft limiter) on
the master. Cheap, native, and it turns the worst case from a crackle into a squeeze.

### G4 — Repetition (**ten calls in a burst is a machine gun**)

The chain already learned this lesson once, from the original: `CAETwinLoopSoundEntity` randomises its swap
interval precisely because *a fixed one makes a rhythm, and a rhythm is what an ear learns and then cannot
stop hearing* ([the recovered design](../gta-sa-original/audio-ambience.md)). One-shot alerts have the same
problem in a sharper form. **Fix:** a coalescing window (one tone per burst, with the count carried visually)
plus small per-play variation.

### G5 — Latency (**a UI acknowledgement at 200 ms is not an acknowledgement**)

203's budget is *≤ 200 ms to the first sound after a gesture*, which is a cold-start figure. A sound that
answers a tap needs to be an order of magnitude quicker or it reads as a coincidence. **Fix:** panel sounds
are resident, never range-fetched — which synthesis gives by construction — and the budget is stated
separately.

### G6 — The backgrounded tab (**the dispatcher is a player**)

The operator of this product is themselves in the game, so the console is very likely **behind the game
window**. Browsers clamp background timers to ≥ 1 s, and the ambience runs on a 10 Hz `setInterval`. A P1
alert that arrives a second late because a tab is not focused is a real defect.

**Fix (and it is mostly free):** alerts are event-driven and scheduled on the `AudioContext` clock, which is
not throttled — so an alert must never be routed through the audio tick. The ambience being throttled in the
background is acceptable and should be stated rather than discovered.

### G7 — No per-bus control, and nothing is persisted

One key steps one master, and a reload is full volume again. An operator wants the world quieter than the
alerts and expects both to survive a refresh. **Fix:** a level per bus, persisted, behind a control that
answers [the cross-platform five](../restrictions/cross-platform-surface.md) — ≥ 44 px, fits 360, no hover, no
keyboard, one component that takes a size.

### G8 — Sound may never be the only channel

DESIGN.md's redundancy rule, applied: **an alert that only exists as a sound is invisible to a muted, deaf, or
headphone-less operator**, and every one of those is a normal dispatcher. Every event in §2 must have a visual
counterpart that stands alone. Conversely the audio must be safe to turn off entirely without losing
information — which is exactly what makes it acceptable to turn it ON by default.

### The ninth, deferred rather than solved

**Distance filtering.** A car at 250 m should be muffled, not merely quiet; ours is a gain and a pan. One
`BiquadFilterNode` per voice is the honest fix, and 64 of them on a Mali phone is a number nobody here has
measured. It belongs in [`docs/performance/deferred-optimizations/`](../performance/README.md) with a price
attached rather than in a plan, until somebody measures it.

---

## 5. What would be measured

Directive 6 again: the claim is measurable or it is a mood.

| Number | Why | Where it comes from |
| --- | --- | --- |
| **event → audible, ms** | G5's whole point | a new field; the context clock makes it exact |
| **alerts refused, ever** | G1's regression guard. **This one must be zero** | the pool's report, split per bus |
| **peak sample on the master** | G3: did it clip | an `AnalyserNode` sampled at the audio tick |
| voices at peak, per bus | the budget | already reported |
| ms/tick against the 2 ms | already owed by 203/3-03 | already reported |
| MB resident against 64 | already owed | already reported |
| battery delta vs `?audio=0` | already owed by 203/4-03 | a device row |

---

## 6. The design tree — what only the operator can answer

Everything above is research. These are the decisions, and they go to the Ask Menu:

1. **The asset source.** Synthesis-only, synthesis + an authored overlay, or authored files from the start?
2. **The console-only set.** All three of §2b, only `MAP_LIMIT`, or none — a console silent about itself?
3. **Where the vocabulary lives.** A contract doc both repositories are built against (and PCAD implements
   it), or a console-side table for now with the contract written when phase 3 arrives?
4. **Default on or off.** An audio system nobody enables protects nobody; one that surprises an operator on a
   shared voice channel is worse. G8's redundancy is what makes "on" defensible — but it is a product call.
5. **How much of §4 is in scope now**, and in what order. G1–G3 are small and structural; G4–G7 are a chain of
   their own.

---

## 7. The go/no-go

**Go, with the scope split in two**, and the recommendation is up front so it can be argued with:

- **The mixer half (G1, G2, G3) is worth doing whatever is decided about panel sounds.** Buses, ducking and a
  limiter improve the world audio that already ships, they are small, and G1 is a live defect today rather
  than a missing feature.
- **The panel half depends on §6's answers**, and on one thing outside this repository: how much of PCAD's own
  event surface is reachable before phase 3. A vocabulary written against events nobody can raise yet is a
  contract with one signatory.

**The risk worth naming**: this is a place where *"AAA"* can quietly become gold-plating, which is exactly what
[directive 4](../project-goals.md) exists to stop. Every item in §4 must be able to name the defect it fixes —
they do above — and the ones that cannot (reverb, HRTF, a convolution space for a top-down map) are not in
this document on purpose.
