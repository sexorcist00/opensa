# 003 — cutscene override: play a chosen cutscene at new game, picked by ini

**Status: PLANNED 2026-08-12, REWRITTEN 2026-08-13 (user's call).** A debug instrument, not a corpus
replacement: every vehicle-cutscene field round so far cost "new game → sit through the intro" per
look. The override turns that into: write a scene name into an ini, start a new game, watch that
scene. It is the field-testing multiplier for vehicle-cutscene plan 002 steps 8–11 and plan 003
(plates), and for every cutscene-adjacent job after them.

**What the rewrite dropped (2026-08-13):** the first version was a viewer — cheat code `CSVIEW`,
cycle scenes with `[`/`]`, on-screen label, restart-on-end. The user cut it to the part that pays:
no cheat detection, no key polling, no state machine, and — the known-fragile bulk — no back-to-back
scene transitions to stabilise. One ini key, one scene per run, script terminates when the scene ends.

## Why CLEO, not ASI (decided 2026-08-12, survives the rewrite)

The cutscene API is script-first: SA's own main.scm plays scenes with four opcodes —
`02E4 LOAD_CUTSCENE_DATA 'NAME'` → `02E7 START_CUTSCENE` → `02E9 HAS_CUTSCENE_FINISHED` →
`02EA CLEAR_CUTSCENE` — and in SA the object list + anims come from `<name>.dat` INSIDE cuts.img (the
III/VC-era per-object `02E5/02E6` calls are gone), the camera rides the `.cut`. The scene NAME is the
entire input, and here it comes from an ini read — CLEO4 serves that natively (`0AF4`-family INI
opcodes). The bottle already runs CLEO (the vehicle mods ship `cleo/` folders), and this repo already
authors scripts through its own SDK DSL with a proven build (`npm run build:cleo-scripts`). An ASI
would re-implement all of that against `CCutsceneMgr` with per-exe fragility (the HOODLUM relocation
trap) and a compile-deploy loop where CLEO is drop-a-file.

**Single-target, deliberately.** Unlike 001/002 this script is NOT dual-target: OpenSA has no cutscene
system to drive (the six unconsumed 2dfx types' neighbour fact — plan 100/101). The headless story
test covers the emitted opcode structure and budget; the behaviour verdict is the bottle's.

## Design

- **`cutscene-override.ini` beside the compiled script is the whole interface.** Head of the file is
  a generated comment block listing every vehicle cutscene and the cs vehicles it drives (the lookup
  that answers "which scene shows the taxi?" — the intro pair alone proves the value: the vehicles
  live in `prolog1/prolog3`, not `intro*`, and nobody guesses that by name). Below it, one key:

  ```ini
  ; vehicle cutscenes (generated — do not hand-maintain the list):
  ;   prolog1 = cstaxi92, ...
  ;   prolog3 = cstaxi92, cscopcarla92
  ;   ...
  [cutscene]
  scene = prolog3
  ```

  `scene` accepts ANY cutscene name in `anim/cuts.img` (~148), not just the listed vehicle ones —
  the comment lists the vehicle scenes because those are the job. Empty `scene`, missing key or
  missing ini → the script is INERT (terminates immediately); that is the shipped default.
- **The comment list is generated OFFLINE by our own tooling** — never hand-maintained. The census
  knows the 23 cs vehicle names; the ANPK channel reader (`scripts/debug/cutscene-anim-channels.ts`)
  knows which cutscenes drive which objects.
- **Script flow, one shot:** session start → read ini → (empty → terminate) → wait until the player
  is in control (main.scm's intro finished or skipped — the user skips it with one keypress) → fade,
  freeze player, `02E4` name → `02E7` → poll `02E9` → `02EA`, unfreeze, fade back → terminate.
  A scene that fails to start gets a timeout + clean restore, never a hang.
- **The cheapest round is a save, not a new game:** CLEO scripts start on ANY session start, so
  loading a save right after the intro plays the ini scene immediately — no intro to skip at all.
  Field loop: edit ini → load save → watch.

## Steps

### 0 — recon: pin the start sequence and the runtime facts

- [ ] Verify against the decompiled main.scm / gta-reversed that SA's `02E7` needs nothing beyond
      `02E4` (no per-object `02E5/02E6`), and whether interior scenes need `04BB`/area handling or the
      `.dat` carries it. Record the exact call sequence main.scm uses (fades, player control,
      widescreen) — the override copies the parts that matter for stability and skips ceremony.
- [ ] Pin the safe start point: what "player in control after the intro" looks like from a CLEO
      script (the wait condition), and that one scene start from that state is clean — main.scm has
      already `02EA`-cleared its own scene by then, so this is the mild case of the transition
      problem, not the back-to-back one.
- [ ] Confirm the bottle's CLEO version serves the INI-read opcodes (its installed scripts already
      use CLEO4 opcodes — verify, don't assume).

**Record:** the verified sequence + the wait condition that proved stable.

### 1 — the ini generator

- [ ] A vehicle-cutscene-side debug script (reuses the census + the ANPK walk) emits
      `cutscene-override.ini`: the comment header (one row per vehicle scene,
      `; name = cs vehicles present`) + `[cutscene]` with `scene =` empty.
- [ ] Row count recorded here; spot-check three entries against `cutscene-anim-channels.ts` output.

### 2 — SDK vocabulary

- [ ] Add the missing opcodes to the SDK DSL table (cutscene four, INI string read, fade /
      player-control if absent — whichever are missing), each with the SDK's usual emission test.

### 3 — the script

- [ ] `cleo/scripts/cutscene-override/script.ts` + `story.test.ts` (headless: the inert path
      terminates without touching a cutscene opcode; the set path emits wait → fade/freeze → `02E4`
      → `02E7` → `02E9` poll → `02EA` → restore → terminate; the timeout path restores and
      terminates. Budget: the wait/poll loop cost per tick — the rhino lesson: idle cost is the
      number that matters).

### 4 — FIELD: the instrument proves itself

- [ ] Drop the compiled `.cs` + ini into the bottle's CLEO folder. Three rounds: `scene = prolog3`
      → new game → skip intro → the scene plays and control returns cleanly; a second scene name to
      prove the ini is the knob; `scene =` empty to prove inert.

**STOP: user's verdict closes the plan.** **Record:** verdict + the ini row count + any scene that
needed the timeout path (each is a fact about that scene worth a line).

## Notes

- Ships as a DEBUG artifact to the bottle only — not part of any game build; the README table gains
  its row when it lands.
- Once alive, vehicle-cutscene's remaining gates (bike, boat, plates, full fleet) test in minutes:
  the order is this script first, then back down the vehicle-cutscene chain with it in hand.
