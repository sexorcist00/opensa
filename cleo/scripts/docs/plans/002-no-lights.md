# 002 — no_lights: our own hotring light-killer + the engine lamp seam

**Goal:** the hotring (slot 494) drives with all four lights smashed — via an SDK-authored
dual-target script AND the engine half that makes the effect visible on OpenSA: an atlas row for
`CDamageManager::SetLightStatus` and a smashed-lamp state in the vehicle-lamp system. Field
checkpoint: a night hotring is dark on both runtimes.

## What exists (recon 2026-08-05/06; full natives recon in
[`docs/postmortem/097-hotring-hotknife-intake.md`](../../../../docs/postmortem/097-hotring-hotknife-intake.md))

- **The original** (`mods-src/.../hotring .../cleo-skipped/no_lights.cs`): 275 B code /
  27 instructions — plus a **19 238 B junk footer**, 70× the code it trails. Every frame
  (`WAIT 0`) it walks ALL cars via `0AE2`, checks `model == 494` SEVEN times in a row (identical
  `0039` compares under one IF 26), then per hotring: `0A97 GET_VEHICLE_POINTER` → `+1440`
  (`0x5A0`, `m_damageManager`) → four `0AA6 CALL_METHOD 0x6C2100` (`SetLightStatus`, lights 0–3 →
  SMASHED).
- **Every opcode is dual-target** (verified against `whitelist.generated.ts`) — the script
  compiles under the SDK gate as-is. On real SA it works immediately.
- **The OpenSA gap is engine-side, and it is the real cost of this plan** (the postmortem's
  verdict, unchanged): the atlas has no row for `0x6C2100`, and the engine has no smashed-lamp
  state. The seam is ready: `packages/game/src/vehicle/vehicle-lamps.ts` +
  `vehicle-lamp.system.ts` already own per-car lamps/coronas/pool lights.
- The postmortem also records the intake's tool defect around this script (`carInSphere` ignoring
  `findNext`) as FIXED in 097/07 — the headless walk is trustworthy now.

## Design

- **Script:** poll every 250–500 ms instead of every frame (the effect is idempotent; a sub-second
  latency on a fresh spawn is imperceptible), ONE model compare, same pointer math — expected
  ~100 B artifact, ~30 instr per poll. Slot 494 is the mod's install slot, read from its
  `vehicles.ide` row at authoring time — a mod script naming its own slot, not an engine hardcode.
- **Engine:** a smashed-lamp state on the vehicle-lamp system, derived from damage STATE, never
  from a model id (the no-hardcode rule) — a lamp whose status is SMASHED emits no beam, corona or
  pool light. The atlas row maps `0x6C2100` (and `GetLightStatus 0x6C2130` if the script needs the
  read-back) onto that state. Any CLEO mod smashing lights gets the effect; collision damage can
  feed the same state later (recorded as an extension, not built here).
- **Shipping:** same pattern as 001 — the author's `cleo-skipped/no_lights.cs` stays untouched in
  `mods-src/`; our artifact ships via the pak build. The `cleo-skipped/` folder name loses its
  reason once this lands — rename/move is part of the close-out, recorded in the mod-intake docs
  if a convention shifts. **Settled in step 3: no rename.** Our artifact went into a NEW `cleo/`
  folder beside it and the author's file was left byte-untouched, so no convention shifted and
  nothing that reads the original could break — see the step-3 ledger.

## Steps

- [x] Engine seam: smashed-lamp state in `vehicle-lamps.ts`/`vehicle-lamp.system.ts` (negative
      tests first: unknown light index, dead car), atlas row for `0x6C2100` (+ `0x6C2130`
      read-back), unit + story coverage on the fake-GPU boot path.
- [x] Authored script + story test (declared budget; record instr/poll and artifact size vs
      275 B + 19 238 B footer).
- [~] Ship via the pak build; field close-out: hotring dark at night in OpenSA (headless screenshot
      A/B — lamps on a stock car, dark on the hotring) + manual real-CLEO Wine verdict.
      **Shipped and OpenSA-PASSED 2026-08-07; the real-CLEO Wine verdict is outstanding.**

## Verification

Headless: lamp-state unit suite; story test in budget; whitelist gate green; byte-deterministic
rebuild. Field: the night A/B on both runtimes. Ledger records sizes, per-poll cost, and both field
verdicts.

## Ledger

### Step 1 — the engine seam + the atlas rows (2026-08-07)

**What the original's data means, recovered rather than assumed** (gta-reversed `DamageManager.h/.cpp`,
fetched this session; `docs/links.md` already names the repo):

| Fact | Source |
| --- | --- |
| `eLights` = 0 FRONT_LEFT, 1 FRONT_RIGHT, 2 REAR_RIGHT, 3 REAR_LEFT | `DamageManager.h:107` — confirms the 097 recon verbatim |
| `eLightsState` = 0 OK, 1 SMASHED | `DamageManager.h:116` |
| `SetLightStatus` = `m_nLightsStatus` with **2 bits per lamp** replaced; `GetLightStatus` = `>> 2i & 3` | `DamageManager.cpp:320/325` (0x6C2130 / 0x6C2100) |
| Collision damage smashes a lamp from its COMPONENT GROUP, never from a model id — `COMPGROUP_LIGHT` → `SetLightStatus(relCompIdx, SMASHED)` | `DamageManager.cpp:113` |

**The one thing the reversed source does NOT carry, stated so it is not looked for again:**
`DoVehicleLights` (0x6E1A60), `DoHeadLightEffect` (0x6E0A50) and `DoTailLightEffect` (0x6E1780) are still
plugin-call stubs there, so SA's DRAW behaviour for a smashed lamp cannot be recovered. Nothing in
`Automobile.cpp` reads the status either. The data meaning is fully recovered; the execution is ours by
default, which is the doctrine anyway.

**Our half.** The status lives on the vehicle HANDLE as a 4-bit mask (one bit is enough — SA only ever
writes OK/SMASHED into its two), and it splits by what each consumer can actually address:

- **per LAMP** — `lampsOf` now pins each of the four lamps to its SA index (`+X` is the car's right), and
  `VehicleLampSystem` skips the beam, the pool light and the corona of a smashed one;
- **per PAIR** — the lamp MESH. A DFF authors one lamp material per end, so the lit-twin swap and the
  emissive glow can only be withheld when both lamps of an end are gone. `writeVehicleLamps` puts the mask
  in the lamp row's spare `w` (it was there all along, unused) and `vsRigid` resolves it against the
  submesh's lamp tag — where the tag and the instance both still exist. Recorded in
  `docs/edge-cases/engine-rendering.md`.

Damage is read off the CAR, not off the lit state: a parked car keeps its smashed lamps and does not light
them the moment somebody gets in.

**Atlas.** `SET_LIGHT_STATUS` / `GET_LIGHT_STATUS` resolve `this` as a vehicle token at exactly
`CAutomobile+0x5A0` — the script reaches it with plain arithmetic (`+1440`), which the 12-bit token offset
field already carries. Any other offset reports a miss instead of guessing. Args are read in the SA C order
(light, status), i.e. after the `0AA5`-`0AA8` reversal 001 fixed.

**Coverage, and each guard verified to FAIL when its fix is reverted** (the 001 lesson: a test that cannot
bite is `undefined === undefined`):

| Guard | Bites |
| --- | --- |
| `vehicle-lamp.system.test.ts` — a smashed lamp emits nothing, its three siblings still do; all four smashed emits nothing at all | 2 tests fail with the `continue` removed |
| `vehicle-lamps.test.ts` — each lamp's SA index, right/left the way SA numbers them | fails with the mirror pairing swapped |
| `engine.lamps.test.ts` — the mask reaches the GPU row; a MASK-ONLY change still re-writes it | fails with `smashed` dropped from the change test |
| `native-atlas.test.ts` — `this` that is not `vehicle+0x5A0` is refused | fails with the offset check relaxed |
| `engine-vehicle-handle.test.ts` — an index outside SA's four cannot reach the mask (JS shifts by `light & 31`, so 32 would have read lamp 0) | — (new behaviour) |

**Deviation from the plan, recorded rather than quietly satisfied:** the plan named the beam/corona/pool
suppression only. The mesh glow had to be gated too, or the plan's own field checkpoint ("a night hotring is
dark") could not pass with four glowing lenses. That made it a SHADER change, which the plan did not
declare — and the shader gate is the one part with no test, because nothing in this repo compiles WGSL
(`docs/edge-cases/engine-rendering.md` already carries that trap). It is field-verified only. NB the shader
DOES have a golden-snapshot test (`render/__snapshots__/shaders.test.ts.snap`) — that reviews the diff, it
does not compile it.

### Step 2 — the authored script (2026-08-07)

`cleo/scripts/no-lights/` — `script.ts` + `story.test.ts` (6 tests). Gate green (dual-target), zero
warnings, byte-deterministic across two builds (`c4df3745…`).

**The original, disassembled** (`scripts/debug/scm-disasm.ts` on the mod's `cleo-skipped/no_lights.cs`):
27 instructions / 275 B of code + a **19 238 B footer**. Its recipe is right and is kept verbatim —
`0A97 GET_VEHICLE_POINTER` → `0A8E INT_ADD +1440` → four `0AA6 CALL_METHOD 7086336 <ptr> 2 0 1 <k>`. The
disassembly settled the one thing the recon could not: **the arguments are listed `(status, light)`**, which
after CLEO's reversed push order is `SetLightStatus(light, SMASHED)`. Our artifact emits that call shape
byte-for-byte, so the conformance half is a direct comparison.

Everything around the call changed:

| The original | Ours | Why |
| --- | --- | --- |
| `WAIT 0` — every frame | `WAIT 400`, work BEFORE the wait | the effect is idempotent and permanent per car; a car cannot be spawned, seen and judged inside 400 ms. Waiting AFTER the work means a hotring already standing when the script spawns is dealt with on frame 1 |
| `0AE2` radius **10 000 m** from the world ORIGIN | 150 m around the player | the original scans every car that exists, every frame |
| `0441 GET_CAR_MODEL` + `0A01 IS_THIS_MODEL_A_CAR` + **7 identical** `0039` compares under one `IF 26` | one `0137 IS_CAR_MODEL car 494` | same test, 1 instruction instead of 9 |
| no player guard at all | `DOES_CHAR_EXIST` + `IS_PLAYER_PLAYING` before reading coordinates | it reads the player's coordinates regardless today |

**Measured, 60 ticks, same harness for both** (a throwaway `.tmp-nolights-measure.ts`, deleted after the
run per the debug-scripts rule; every number is off a run):

| In range | ours avg | ours peak | original avg | original peak |
| --- | --- | --- | --- | --- |
| nothing | **0.6** | 11 | 5.0 | 5 |
| 1 hotring | **1.3** | 25 | 25.6 | 26 |
| 8 cars, no hotring | **3.8** | 75 | 123.0 | 125 |
| 16 cars + hotring | **7.7** | 153 | 261.6 | 266 |
| 32 cars + hotring | **14.1** | 281 | 497.6 | 506 |

**19.7× cheaper with a hotring in range, 32× cheaper on a street of eight cars that are not one**, and the
artifact is **237 B against 19 513 B on disk** (225 B of code vs 275 B, and no 19 KB footer). Cost is linear
at ~8 instructions per car in range on a POLL tick — the declared `budgetPerTick: 160` therefore has a
stated meaning (a poll tick with the hotring plus 16 cars of traffic, measured 153), and the ~23 frames
between polls cost ONE instruction each. Effect count over 60 frames: ours 12 (3 polls × 4 lamps), the
original **236** — it re-smashes four already-smashed lamps every single frame.

**No integration test, and that is a decision rather than an omission.** 001's audit asks for a test over
the real artifact and the real runtime; here the four links of the chain are already guarded separately
(artifact → real `AtlasMemory` → real light state in the story test; handle → lamp system; handle → GPU
row), and the two that are NOT are the two an integration test in this folder cannot honestly reach:

1. the app-layer glue in `engine-cleo-setup.ts` (two calls: `setLightSmashed` / `lightsSmashed`);
2. the shader gate.

A test that restated that glue inside the test file would prove the restatement, not the product — the
exact failure 001 shipped. Both are the field checkpoint's job, and they are named here so the field run
knows what it is the only evidence for.

### Step 3 — shipped, and FIELD: PASSED on OpenSA (2026-08-07)

**Shipping is real this time, not a hand-placement.** The author's script sits in the mod's
`cleo-skipped/` folder, which the installer ignores by design, so there is nothing to substitute — our
artifact only had to be INSTALLED. It went into a new `cleo/` folder in the mod
(`mods-src/original/vehicles/hotring …/cleo/no-lights.cs`) and
`vehicle-installer --rebake original --only hotring` carried it: `vehicle-installer: cleo →
cleo/no-lights.cs`. **The chain's (d) criterion holds for 002** — the one 001 had waived — and a pmb
rebuild no longer reverts anything.

Two things done deliberately here, both learned from 001:

- `cleo-skipped/no_lights.cs` is left BYTE-UNTOUCHED. 001 shipped by replacing the author's file inside
  `mods-src/` and silently took a corpus fixture with it; adding a folder beside it cannot.
- The verdict below was taken against the REBAKED build, not the hand-placed copy — the 001 field round
  that tested the author's artifact cost a whole round-trip and a wrong attribution.

**The A/B, four headless runs, same spot / same hour / same script set** (`warnings.js`, captures in the
session; depot courtyard `?spawn=1797,-1918,14`, car at `y−5`, `?parked=0&hour=23&autoseat=1`, SEATED
confirmed on the HUD in every one):

| Run | Car | CLEO | Result |
| --- | --- | --- | --- |
| A | hotring | on | **dark** — no headlight pool on the asphalt, no tail glow |
| B | admiral | on | both tail lamps glow red, a clear beam pool ahead of the car |
| C | **hotring** | **off** | **pool ahead AND a red tail glow — the model's lamps work** |
| D | hotring | on, REBAKED build | identical to A |

**C is the run that makes this evidence rather than a screenshot.** A and B differ by the model, so on
their own they cannot separate "our script killed the lamps" from "this mod's model has no lamps at all" —
the magnitude-vs-suspect trap from 001, where three confident attributions were wrong. Same model, same
spot, same hour, only the script toggled: the lamps are there and our script is what puts them out.

`[cleo] 7 script(s): … no-lights.cs …` in every run, and **no atlas miss belongs to us**. The three
`non-native address` reads (`0x18`, `0xd`, `0x35`) appear identically in A and B — and on the admiral our
script stops at the model compare and issues nothing — so they cannot be ours; our artifact contains no
`READ_MEMORY` at all (see the step-2 disassembly). They arrive with `Car Left Door` and its unimplemented
`0AF0`/`0E43`/`0E4A`, a pre-existing class-C script.

**Still outstanding: the real-CLEO Wine verdict** (the chain's (c) criterion, the user's to give). Our
artifact emits the `0AA6 CALL_METHOD 7086336 <ptr> 2 0 1 <k>` call shape byte-for-byte, so the comparison
is direct. If it is ever re-run, note WHICH `.cs` the install carried.

**What the field run is now the ONLY evidence for**, as step 2 predicted: the two-call glue in
`engine-cleo-setup.ts` and the shader gate. Both are exercised by runs A/C/D and by nothing else in the
repo.

**No benchmark row, and it is a decision** — the same one 001's audit recorded. The instruction counts
above are VM-side and live in this ledger; no frame-time measurement was taken because the script's cost
sits far below the noise floor of the standard bench scene, so a `docs/benchmarks/` row would be noise
rather than evidence.
