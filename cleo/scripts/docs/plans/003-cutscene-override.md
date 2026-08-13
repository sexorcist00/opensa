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
- **Script flow, one shot (the opcode sequence is main.scm's own, measured in step 0):** session
  start → read ini → (empty → terminate) → wait until the player is in control (`0256
  IS_PLAYER_PLAYING` AND `$409 ONMISSION == 0` — main.scm's intro finished or skipped, the user
  skips it with one keypress) → fade out, freeze player, `04BB SET_AREA_VISIBLE` (from `[areas]`,
  default 0) → `02E4` name → **wait `06B9 HAS_CUTSCENE_LOADED`** (required: `02E7` on unloaded data
  starts degraded — no camera, no widescreen; a name that never loads, e.g. an ini typo, hits the
  timeout → clean restore) → `02E7` (the MANAGER sets widescreen and fades in itself) → poll `02E9`
  → fade, `02EA`, `04BB` back to 0, unfreeze, fade back → terminate. Never a hang.
- **The `[areas]` section rides in the same generated ini**: main.scm sets the interior area per
  scene BEFORE loading (the `.dat` does not carry it), so the generator emits `PROLOG1=14`-style
  rows and the script reads the key named by the chosen scene (missing row → 0). No hand-copying.
- **The cheapest round is a save, not a new game:** CLEO scripts start on ANY session start, so
  loading a save right after the intro plays the ini scene immediately — no intro to skip at all.
  Field loop: edit ini → load save → watch.

## Steps

### 0 — recon: pin the start sequence and the runtime facts — DONE 2026-08-13

- [x] Verified against the Sanny SA opcode library + gta-reversed + the bottle's own main.scm:
      `02E5/02E6` are `is_nop` in SA (they exist and do nothing); `02E4` alone loads the `.ifp` anims
      and the `.dat` objects+camera from cuts.img. Interior scenes DO need `04BB` from the script —
      main.scm sets the area immediately before every one of its 135 `02E4` sites; the `.dat` does
      not carry it.
- [x] Pinned the safe start point: `0256 IS_PLAYER_PLAYING` AND `ONMISSION == 0`; the ONMISSION
      global is `$409`, measured from the bottle's main.scm (`0180 SET_ON_MISSION_FLAG` @ 0xdce4 →
      offset 1636/4). One scene start from that state is the mild transition case — main.scm has
      already `02EA`-cleared its intro scene.
- [x] The bottle runs **CLEO 4.4.4** (version string in CLEO.asi) and cleo.log confirms
      `IniFiles.cleo` loads → `0AF0`/`0AF4` INI reads are served.

**Record (measured off the bottle's main.scm, 3 079 599 B, and gta-reversed `CCutsceneMgr`):**

- main.scm's sequence at every site (PROLOG1 @ 0x43300, PROLOG3 @ 0x434f7 are the vehicle pair):
  `04BB area` → `02E4 'NAME'` → **loop until `06B9 HAS_CUTSCENE_LOADED`** → `02E7` → `016A DO_FADE`
  in → loop until `02E9` → `016A` fade out + `016B IS_FADING` wait → `02EA` → `04BB` restore. The
  waits are all CONDITION-driven (`06B9`/`02E9`/`016B`) — no fixed settle sleeps anywhere, which
  retires the old viewer plan's "budget explicit settle waits" worry.
- **`06B9` is the load-bearing discovery**: gta-reversed's `StartCutscene` on not-yet-loaded data
  still flips play status but SKIPS camera setup and widescreen — a degraded half-start, not an
  error. The override's timeout path exists exactly for a name that never reaches LOADED.
- The manager itself sets widescreen on start and fades in (`TheCamera.SetWideScreenOn()`,
  `Update_overlay`) — main.scm's fades are courtesy framing, and the script copies only those.
- Scene names: main.scm stores them UPPERCASE; the manager compares case-insensitively. 135 unique
  scenes are referenced by main.scm (vs ~148 in cuts.img — the census list is the superset).
- Areas measured (adjacent-`04BB` decode reaches 54/135 sites; the generator owns the full decode):
  `PROLOG3=0`, `PROLOG1=14`, `INTRO1A=3`, `INTRO2A=2`; histogram of decoded sites
  `{0:3, 1:21, 2:11, 3:8, 5:4, 6:1, 10:1, 11:3, 12:1, 14:1}`.

### 1 — the ini generator — DONE 2026-08-13

- [x] `scripts/debug/cutscene-override-ini.ts` (imports the tool's census + the ANPK walk) emits
      `cutscene-override.ini`: the comment header (one row per vehicle scene), `[cutscene]` with
      `scene =` empty, and `[areas]` decoded from main.scm (nearest immediate-arg `04BB` within 64
      bytes before each `02E4`; only non-zero rows are emitted).
- [x] **35 vehicle scenes, 65 area rows.** Spot-checked against `cutscene-anim-channels.ts`:
      PROLOG3 = cscopcarla92+cstaxi92 (the known pair), STRP4B2 = csmtbike92, RIOT4E1 =
      CsCopcarSF+CsFirela, GARAG3A = csremington92 — all match.

**Record:**

- **The scene's OBJECT list comes from the IFP's `NAME` chunks, not the `.dat`** — the `.dat` inside
  cuts.img is CAMERA data (zoom/FOV keyframes; measured on prolog3.dat, and no `.dat` names any
  model). The 2026-08-12 note saying objects come from the `.dat` was wrong; cutscenes.md fixed in
  the same change.
- **`csdinghy` appears in NO cutscene** — 22 of the census's 23 cs vehicles are driven somewhere
  across the 35 vehicle scenes; the boat alone is scene-less (a cutscene model with no cutscene —
  cut content, like `csandrom92`'s dead txdcut row). Consequence for vehicle-cutscene plan 002 step
  9: the boat conversion has NO stock scene to field-test in; its verdict needs another route.
- Anim object names are mixed-case in the ANPK (`CsCopcarSF`, `CsFirela`) — the generator matches
  case-insensitively, and the ini prints the census's lowercase cs names.
- Area decode coverage across ALL 135 main.scm sites: 68 decoded from an immediate arg, 67 have no
  `04BB` within 64 bytes (second scenes of a mission inherit the area from earlier flow — the
  generator deliberately does not chase control flow; those scenes ride the default-0 note in the
  ini header).

### 2 — SDK vocabulary — DONE 2026-08-13

- [x] The opcode TABLE needed nothing: the vendored Sanny DB already knows every opcode the flow
      uses (`02E4/02E7/02E9/02EA/06B9`, `04BB`, `016A/016B`, `0256/01B4`, `0AF4/0AF0`), with names,
      arity and condition flags. The real gaps were two:
- [x] **A target for real-SA-only scripts.** The gate's rule was "the VM half always holds", and the
      VM serves no cutscene opcode — so `dual`/`opensa-only` both refuse this script by design. Added
      `target: 'sa-only'`, the MIRROR of `opensa-only`: the real-CLEO half always holds (new
      `servedByRealCleo44` — game opcodes + classic CLEO 4 core + the IniFiles module `0AF0–0AF5`
      the bottle measurably loads), the VM half is lifted, and the artifact name carries it
      (`<name>.sa-only.cs`; contract row added to `docs/contracts/mods.md` in the same change). The
      other bottle modules (FileSystemOperations, IntOperations, CLEO+) stay unclaimed until a
      script needs one — extending the predicate is the way to claim them.
- [x] **Local string8 vars** for the ini read: `lvarStr8` (IR) + `s.localString(name)` (DSL,
      allocator's 2-slot `string8` kind — the allocator and the byte writer both already knew the
      type). Same-name-different-kind is a build error.
- [x] Tests: whitelist gains 4 cases (the cutscene sequence + ini read passes `sa-only` and fails
      `opensa-only`; a VM-only opcode and a file-module opcode both fail `sa-only`; the artifact
      name), DSL gains 2 (string8 takes two slots; kind collision throws). cleo/sdk + cleo/scripts:
      **91 tests / 11 files green.** No whitelist regeneration needed — `sa-only` is a predicate
      over the vendored DB, not a generated set.

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
