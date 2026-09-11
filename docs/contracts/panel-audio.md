# Panel audio — the vocabulary two applications share

**What a dispatch event is called, who makes the sound for it, and what happens when a name is spelled
otherwise.** Two applications are built against this: the **OpenSA console** (this repository) and the
**PCAD client** (`sexorcist00/pcad`), which already has a working panel-sound system this document adopts
rather than replaces.

Plan: [204 — panel audio](../plans/204-panel-audio/readme.md). The game's own sounds are
[audio.md](./audio.md) and are a different subject: those are San Andreas' authored data, these are the
product's own vocabulary.

---

## 1. Three categories, one owner each

| Category | Owner | What belongs to it | The test |
| --- | --- | --- | --- |
| **`world`** | the console | engines, sirens, the ambience bed | it is derived from the pak and from positions |
| **`map`** | the console | the lifecycle of units and incidents: a call appears, a unit arrives, a call closes, a unit stops reporting | **the console can SEE it in the board it already holds** |
| **`cad`** | PCAD | the panic press, an ALPR hit, the simplex handshake, radio keying, a direct message, the link state | it exists only inside the plugin or the backend; nothing in the board could produce it |

**The line between the last two is a test with an answer rather than a taste**: *can the console see it in
the board it already holds?* Nothing in `Operations` can produce an ALPR hit, and PCAD raises no trigger at
all today for a unit arriving on scene.

## 2. The owner makes the sound

A dispatcher is themselves a player, so the game and the browser are routinely open **on one machine**. If
both voiced every event, a panic would arrive twice, at two different delays, and the second one would read
as a second panic.

So: **a surface voices the categories it owns, and DISPLAYS the rest.** A forwarded event still flashes the
map, still writes a line in the log, still raises a notification — it just does not make a sound.

### The assumption this rests on, and it is stated because it could not be asked

**Ownership is a SUPPRESSION rule, not a permission rule** — taken 2026-09-10 while writing this document,
after the questioning round had closed, and recorded here so the next reader can overturn it.

> A surface suppresses an event it does not own **only while it knows the owner is present and voicing**.
> With no such handshake, every surface voices everything it can see.

Without that clause the rule has a hole with the worst possible shape: a dispatcher working the console
alone, with no game running, would hear **no panic at all**, because its owner is not there to voice it. A
suppression rule degrades into *you hear it twice*; a permission rule degrades into *you hear nothing*, and
only one of those is survivable.

**Where the handshake lives is not settled** and is deliberately not invented here. Until it exists, the
console voices every event it is given, which is the safe half of the trade.

## 3. The events

`✓` in **floored** means the sound is heard even when its bus is muted, at the pool's own floor
([204/1-04](../plans/204-panel-audio/readme.md)) — reserved for the two events this whole chain exists to
deliver.

### `cad` — PCAD's

| Name | Raised when | Floored | In PCAD today |
| --- | --- | --- | --- |
| `panic_button` | a unit presses panic | **✓** | `panic_button` |
| `link_lost` | the WebSocket drops | **✓** | — **new** |
| `link_back` | it comes back | | — **new** |
| `assist_request` | a unit asks for assistance | | `assist_request` |
| `alpr_hit` | a plate read matches | | `alpr_hit` |
| `simplex_request` | a simplex exchange is offered | | `simplex_request` |
| `simplex_accepted` | …accepted | | `simplex_accepted` |
| `simplex_declined` | …declined | | `simplex_declined` |
| `bolo_new` | a BOLO is posted | | — **new** |
| `notification` | anything else the plugin says | | `notification` |

### `map` — the console's

| Name | Raised when | In PCAD today |
| --- | --- | --- |
| `call_created_p1` / `_p2` / `_p3` | a call appears, **priority-coded** | `call_created`, one sound for all three |
| `incident_created` | an incident is opened | `incident_created` |
| `unit_assigned` | a unit is committed to a call | — |
| `unit_arrived` | a unit reaches its scene | — |
| `call_closed` | a call clears | — |
| `unit_stale` | a unit stops reporting (the backend marks one at 300 s) | — **new** |

**Where the console gets them: a DIFF of two boards, not a stream**
([`board-events.ts`](../../apps/dispatch/src/world/board-events.ts), 204/3-01). The console renders a board
it does not own, so there is nothing to subscribe to; it keeps the last snapshot and compares. Three
consequences a reader of this table needs:

- **The first board raises nothing.** Everything on it is already there rather than newly arrived, and a
  console that announced its whole roster at open is one somebody mutes in the first minute.
- **`incident_created` is not raised by the console.** Its domain has one concept — an `Incident` with a
  priority — so a new one is a new CALL, and the console raises the priority-coded name. PCAD's own
  `incident_created` stays in the vocabulary because PCAD raises it; a console hearing it from PCAD plays it.
- **`unit_stale` is not raised yet**, because staleness is not in the snapshot: the backend marks a unit at
  300 s and the board carries no such field. It arrives with the field, not before.

**Why the priority split.** [DESIGN.md](../../apps/dispatch/DESIGN.md) encodes a call's priority three ways
in the visuals and says *this is the rule for any state the console adds later*; one chime for P1 and P3
alike is a channel that throws the priority away. PCAD already ships the assets for it —
`priority_start` / `priority_middle` / `priority_end` — and plays only the first, wired to `assist_request`.

## 4. The message carries the name

**A sound is chosen by an explicit field and never by matching the notification's text.** PCAD resolves it
today by searching the title:

```lua
if title_lc:find("assistance request", 1, true) then return "assist_request" end
```

Reword that title, translate it, or fix a typo in it and the sound stops — **silently**, with the
notification still appearing exactly as before. So the contract is a field:

```json
{ "title": "Assistance Request", "body": "…", "sound": "assist_request" }
```

| The mistake | What happens | What says so |
| --- | --- | --- |
| No `sound` field | No sound; the notification still shows | Nothing today. A surface MAY fall back to `notification` and should say it did |
| A `sound` no build knows | Silence for that event | One line per distinct name, counted in the report's absence |
| A name in the wrong category | It plays, on the wrong bus — so it may duck the world when it should not, or be suppressed when it should not be | Nothing. **This is the silent one**, and the reason the table above is the single place either repository reads |

## 5. The sound set, and where it came from

**Provenance, recorded because it is written nowhere else and in six months there is nobody left to ask.**

The 27 files under PCAD's `client/moonloader/cad_system/resource/sound/` are **the project owner's own or
commissioned**, confirmed 2026-09-10, and may be published. They carry no metadata (`RIFF…WAVEfmt` and
nothing else) and the repository holds no licence file for them, which is exactly why this paragraph exists.

**Not part of the set**: the *Immersive Radio* RTO/CPD voice library that `_cadparserradio.lua` loads. It is
**not in the repository** — the Lua client reads it out of the player's own MoonLoader tree, which is a
different act from a server distributing it, and it is out of scope here.

**Every name resolves to something.** A build that ships no file for a name falls back to a **synthesised**
tone and says so in its report. That is not a degraded mode to be embarrassed about: a computed tone has no
failure mode to inherit, and a panic button may not inherit
[203's decision 4.3](../plans/203-audio/concept.md), where silence is the normal case for anything missing.
