# 003 — cutscene viewer: cycle vehicle cutscenes in real SA for field debugging

**Status: PLANNED 2026-08-12 (next up, user's call).** A debug instrument, not a corpus replacement:
every vehicle-cutscene field round so far cost "new game → sit through the intro" per look. The viewer
turns that into: type a cheat code, land in the first vehicle cutscene, cycle the rest with `[` / `]`.
It is the field-testing multiplier for vehicle-cutscene plan 002 steps 8–11 and plan 003 (plates), and
for every cutscene-adjacent job after them.

## Why CLEO, not ASI (decided 2026-08-12)

The cutscene API is script-first: SA's own main.scm plays scenes with four opcodes —
`02E4 LOAD_CUTSCENE_DATA 'NAME'` → `02E7 START_CUTSCENE` → `02E9 HAS_CUTSCENE_FINISHED` →
`02EA CLEAR_CUTSCENE` — and in SA the object list + anims come from `<name>.dat` INSIDE cuts.img (the
III/VC-era per-object `02E5/02E6` calls are gone), the camera rides the `.cut`. The scene NAME is the
entire input. CLEO4 covers the rest natively: `0ADC IS_CHEAT_STRING_JUST_ENTERED` (the entry code),
`0AB0 IS_KEY_PRESSED` (VK `[` = 0xDB, `]` = 0xDD), INI/file reads for the scene list, text draw for
the on-screen label. The bottle already runs CLEO (the vehicle mods ship `cleo/` folders), and this
repo already authors scripts through its own SDK DSL with a proven build (`npm run build:cleo-scripts`).
An ASI would re-implement all of that against `CCutsceneMgr` with per-exe fragility (the HOODLUM
relocation trap) and a compile-deploy loop where CLEO is drop-a-file.

**Single-target, deliberately.** Unlike 001/002 this script is NOT dual-target: OpenSA has no cutscene
system to drive (the six unconsumed 2dfx types' neighbour fact — plan 100/101). The headless story test
covers the emitted opcode structure and budget; the behaviour verdict is the bottle's.

## Design

- **The scene list is generated OFFLINE by our own tooling** — never hand-maintained. The census knows
  the 23 cs vehicle names; the ANPK channel reader (`scripts/debug/cutscene-anim-channels.ts`) knows
  which of the ~148 cutscenes in `anim/cuts.img` drive which objects. Scan → `cutscene-viewer.ini`
  beside the compiled script: one row per scene, `name = cs vehicles present` (the label text). The
  intro pair alone proves the value: the vehicles live in `prolog1/prolog3`, not `intro*` — nobody
  guesses that by name.
- **Script state machine:** idle → (cheat `CSVIEW`, not on a mission) → viewer: freeze player, fade,
  load+start `list[i]`, draw `[i/N] prolog3 — cstaxi92, cscopcarla92`; `]` next, `[` previous (clear →
  small settle wait → load next), scene end → restart the same scene (a held look beats a black
  screen); `Backspace` → clear, unfreeze, fade back, idle.

## Steps

### 0 — recon: pin the start sequence and the runtime facts

- [ ] Verify against the decompiled main.scm / gta-reversed that SA's `02E7` needs nothing beyond
      `02E4` (no per-object `02E5/02E6`), and whether interior scenes need `04BB`/area handling or the
      `.dat` carries it. Record the exact call sequence main.scm uses (fades, player control, widescreen)
      — the viewer copies the parts that matter for stability and skips ceremony.
- [ ] Confirm the bottle's CLEO version serves `0ADC`/`0AB0`/INI reads (its installed scripts already
      use CLEO4 opcodes — verify, don't assume).
- [ ] Back-to-back replay stability: the known-fragile part. Budget explicit settle waits between
      `02EA` and the next `02E4`; a scene that fails to start gets a timeout + auto-skip, never a hang.

**Record:** the verified sequence + the waits that proved stable.

### 1 — the scene list generator

- [ ] A vehicle-cutscene-side debug script (reuses the census + the ANPK walk) emits
      `cutscene-viewer.ini`: `[scenes]` rows `prolog3=cstaxi92,cscopcarla92`, vehicle scenes only.
- [ ] Row count recorded here; spot-check three entries against `cutscene-anim-channels.ts` output.

### 2 — SDK vocabulary

- [ ] Add the missing opcodes to the SDK DSL table (cutscene four, cheat check, key press, INI read,
      text draw — whichever are absent), each with the SDK's usual emission test.

### 3 — the script

- [ ] `cleo/scripts/cutscene-viewer/script.ts` + `story.test.ts` (headless: state machine shape, the
      opcode sequence per transition, instruction budget per tick in idle ≈ a cheat poll and nothing
      else — the rhino lesson: idle cost is the number that matters).
- [ ] Mission guard, player freeze/restore, the label, the settle waits from step 0.

### 4 — FIELD: the instrument proves itself

- [ ] Drop the compiled `.cs` + ini into the bottle's CLEO folder; enter `CSVIEW`; cycle the full
      vehicle list once. Verdict: every scene reachable, `[`/`]`/Backspace behave, no hang on any scene
      (auto-skip counts as behaving).

**STOP: user's verdict closes the plan.** **Record:** verdict + how many scenes the list carries + any
scene that needed the timeout path (each is a fact about that scene worth a line).

## Notes

- Ships as a DEBUG artifact to the bottle only — not part of any game build; the README table gains its
  row when it lands.
- Once alive, vehicle-cutscene's remaining gates (bike, boat, plates, full fleet) test in minutes: the
  tomorrow-order is this script first, then back down the vehicle-cutscene chain with it in hand.
