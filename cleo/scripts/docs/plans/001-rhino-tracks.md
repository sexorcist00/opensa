# 001 — rhino tracks: our own track script

**Goal:** replace the author's `rhino tracks.cs` with an SDK-authored dual-target script that rolls
the GTA 5 Rhino's tracks on BOTH runtimes — including ours, where the original's tracks do not
rotate today (the 097/07 class-B defect). Field checkpoint: tracks visibly rolling in OpenSA AND
under real CLEO on the canonical exe.

## What exists (recon 2026-08-06, disasm in the session; re-derive with `scm-disasm`)

- **The original:** 16 572 B code / 2 085 instructions / 35 opcodes (`SCRIPT_NAME 'PANZER4'`).
  Measured on our VM: avg ~300, peak 1 334 instr/tick (097/07 ledger). Field-proven at 120 fps on
  real SA — the bar to beat, not just match.
- **Cost shape:** every frame (`WAIT 0`) it walks the vehicle pool BY HAND — `0A8D READ_MEMORY` of
  `0xB74494`, then ~139 slots × ~6 instructions ≈ 800+ instr/frame **even with zero rhinos in the
  world**. That walk is the bulk of the peak.
- **Per-link math is unrolled by hand:** 12 near-identical ~1 107 B blocks (GOSUB targets spaced
  exactly 1 107 B apart), one per track link, all funnelling into one shared tail that calls
  `0AA6 CALL_METHOD 0x59B120` (`CMatrix::SetRotate(x,y,z)`) and restores the frame position with
  3 `WRITE_MEMORY`.
  **Corrected by the step-1 reversing (see the ledger):** the 12 blocks are an angle→VISIBILITY
  ladder and never call the tail themselves; the tail is called from 22 link sites, and there is a
  13th, larger subroutine (offset 373, 2 690 B) that holds the sibling walk.
- **Frame addressing is the fragile part:** the original chains through `RwFrame+0x9C` (the sibling
  pointer) — the exact walk our VM only serves via the `docs/hacks/cleo-frame-sibling-order.md`
  stand-in, and where the tracks-don't-rotate defect lives.
- **The model names every part:** `track_1`…`track_12`, `wheel_small_1..8`, `wheel_big_0/1`
  (verified in the DFF). The atlas already serves lookup BY NAME (`NativeWorld.partIndexByName`,
  the `GetFrameFromName` emulation) and the `SetRotate*` family lands on parts — real CLEO serves
  the same via `CClumpModelInfo::GetFrameFromName`.
- **Dead weight:** the speed-HUD trio `03F0/0343/07FC` (`'BB_05'`) is not VM-served, sits outside
  the dual-target whitelist, and is dead on OpenSA today. Every other opcode the script uses IS in
  `DUAL_TARGET_OPCODES` (`cleo/sdk/src/whitelist/whitelist.generated.ts`).

## Design

- **Walk cars with `0AE2`** (recursive car walk, as no_lights does) instead of the manual pool
  scan — cost proportional to the ACTUAL car count (~2 instr/car), ~10× less in the common frame.
- **Loop over track links** instead of 12 unrolled copies: a name table `track_1`…`track_12`, each
  link resolved by name once per rhino, the shared math in one subroutine. Expected artifact
  ~2–3 KB vs 16.5 KB.
- **Address frames BY NAME, never by sibling chain** — this sidesteps the sibling-order hack
  entirely. If the prototype proves rotation lands (step 2), the hack loses its only consumer;
  its retirement path is recorded in the hack file — move it per the standing rule when that
  happens.
- **Recover the per-link math ONCE** (step 1): the 12 blocks are copies; reverse one block into a
  spec (what angle each link gets from wheel spin/heading) before reimplementing. The original is
  the source of truth for what its data MEANS, not for its shape.
- **Drop the speed HUD** — it cannot pass the dual gate and our engine owns its own HUD.
- **Shipping:** the author's mod in `mods-src/` stays byte-untouched; the pak build ships OUR
  artifact in place of the author's `.cs` (mechanism decided in step 4 — if a name rule appears,
  it goes to `docs/contracts/mods.md` in the same change).

## Steps

- [x] Reverse ONE unrolled block into a spec (inputs, per-link angle formula, wrap handling);
      write it into this ledger.
- [x] Go/no-go prototype: a minimal authored script that resolves `track_1` by name and rotates it,
      run headless — does `SetRotate` land on the part, and does this answer whether the
      tracks-don't-rotate defect was ONLY the sibling walk (or also the optimizer's dropped parent
      frames)? Verdict into the ledger before the full port.
- [ ] Full script in the DSL + story test (declared per-frame budget; the original's avg ~300 /
      peak 1 334 is the calibration point — beat it and record both numbers).
- [ ] Shipping decision + wiring: our artifact replaces the author's in the pak build; contracts
      row if a name rule appears.
- [ ] Field close-out: tracks rolling in OpenSA (closes the 097/07 defect row; update the 05-ledger
      reference and the hack file per its retirement clause) + manual real-CLEO Wine verdict.

## Verification

Headless: story test within budget, byte-deterministic rebuild, whitelist gate green. Field: tracks
visibly rolling on both runtimes — the OpenSA half is the fix proof, the real-CLEO half is the
conformance proof. Ledger records: artifact size vs 16 572 B, avg/peak instr/tick vs 300/1 334, and
the hack's fate.

## Ledger

### Step 1 — the per-link math, recovered (2026-08-07)

Sources: `tests/custom/cleo-listings/rhino.txt` (2 085 instructions, the committed listing),
`npx tsx scripts/debug/dump-vehicle-rig.ts "mods-src/original/vehicles/rhino - GTA 5 Rhino - _F_/rhino.dff"`.
No new disasm run was needed — the listing in the repo is the artifact.

**Deviation from the recon.** The plan's "12 near-identical blocks all funnelling into the shared
tail" was a hypothesis and is wrong in kind. The real shape is three parts, not one:

| Part | Offsets | What it is |
| --- | --- | --- |
| driver | 0…372 + 341…372 | pool walk + the angle source |
| link walk | 373…3 063 (2 690 B) | ONE subroutine, the whole sibling chain, 22 link sites |
| bucket ladder | 3 065…16 344, 12 × 1 107 B | angle → which track link is VISIBLE; returns a POSITION, never rotates |
| shared tail | 16 413…16 568 | deg→rad, `SetRotate`, restore/overwrite the position |

**The angle (one per rhino, per frame).** `*(vehicle + 0x658)` is `m_aCarNodes[4]` = **CAR_WHEEL_RB**
(`wheel_rb_dummy`); the script reads that frame's modelling-matrix **m_forward** column
(`frame + 0x20/0x24/0x28` = `RwFrame+0x10` matrix, `CMatrix+0x10` m_forward — the offsets our atlas
already carries as `partForward`, "rhino reads wheel spin from it") and takes
`0604 GET_HEADING_FROM_VECTOR_2D(forward.y, forward.z)` → `0@`, degrees in [0, 360). For a wheel
rolling about X the forward column stays in the YZ plane, so this heading **is the road wheel's roll
angle**. The frame chain anchor is `*(vehicle + 0x6A8)` = `m_aCarNodes[24]` = **CAR_MISC_E**
(`misc_e`) — 20 slots higher; both indices match the atlas' gta-reversed-verified table.

**The chain is exactly the model's `Bradley_dummies` children — confirmed against the rig, not
assumed.** The walk starts at the anchor frame and steps `RwFrame + 0x9C` (`next`) 22 times:

| Chain step | Frame (from the rig dump) | What the script does |
| --- | --- | --- |
| F0 | `misc_e` (dummy, no mesh) | anchor only, never touched |
| F1 | `wheel_big_0` | `SetRotate` by **h** |
| F2…F9 | `wheel_small_1` … `wheel_small_8` | `SetRotate` by **2h** |
| F10 | `wheel_big_1` | `SetRotate` by **h** |
| F11…F22 | `track_1` … `track_12` | `SetRotate(0)` + position from the ladder |

`Bradley_dummies` has exactly 23 children in exactly that order (1 dummy + 2 big + 8 small + 12
track), and the builder emits all 22 as parts (`wheel_big_0` = part 6 … `track_12` = part 27). The
**2h on the small wheels is the radius ratio** — the road wheels are half the drive sprockets'
diameter, so the script is reading the sprocket angle and doubling it for the rollers. This also
independently confirms the chain order: only this mapping puts the ×2 on the eight small wheels.

**The ladder (the heart of it).** Each 1 107 B block is a 20-step linear scan:

```
10@ = k * 1.5                      // block k = 0..11, the only thing that differs
repeat 20:                         // 20 * 18.0 = 360 degrees
    11@ = 10@ + 1.5
    if NOT( 0@ <= 10@  OR  0@ > 11@ )   // 00D6 IF 21 = OR of 2; GOTO_IF_FALSE takes the match
        -> 16349:  20@,21@,22@ = (0, 0, 0)          // this link is VISIBLE
    10@ += 18.0
-> 16381:  20@,21@,22@ = (-1e35, -1e35, -1e35)      // this link is BANISHED
```

So the windows are **half-open, `(start, start + 1.5]`**, period 18.0 degrees, and block `k` is
phase-shifted by `k * 1.5` — the 12 blocks tile one 18-degree period in 1.5-degree steps. Exactly
one link is on-screen at a time: **the 12 track meshes are a 12-frame flipbook of the tread, one
frame per 1.5 degrees of wheel roll, repeating every 18 degrees.** In closed form:

> `visible = ceil((angle mod 18.0) / 1.5)` → `track_<visible>`, all others at -1e35.

The shared tail then does, for every one of the 22 links: `23@,24@,25@ /= 180 * PI`,
`CMatrix::SetRotate` on `frame + 0x10`, and 3 `WRITE_MEMORY` of `20@,21@,22@` into `frame + 0x40`
(the modelling matrix' position, which `SetRotate` has just wiped). Wheels restore the position
they read; track links write what the ladder returned. Tracks always get `SetRotate(0,0,0)` — the
flipbook is pure show/hide, no rotation.

**Cross-checks (the structural model reproduces the opcode histogram exactly).** These are why the
above is a recovered spec and not a reading: 468 `ADD_VAL_TO_FLOAT_LVAR` = 12 blocks × (20 × `+1.5`
+ 19 × `+18.0`); 250 `SET_LVAR_FLOAT_TO_LVAR_FLOAT` = 12 × 20 ladder copies + 10 wheel `25@ = 0@`;
74 `SET_LVAR_FLOAT` = 12 block starts + 6 tail constants + 10 wheels × 2 + 12 tracks × 3; 240
`GOTO_IF_FALSE -16349` = 12 × 20; 11 `MULT` = 8 × `2.0` + 3 deg→rad; 1 `CALL_METHOD`; 3
`WRITE_MEMORY`; 2 `GET_VEHICLE_POINTER`. Nothing is unaccounted for.

**Two defects found in the original while reversing it — both must be fixed, not reproduced:**

1. **A parked Rhino has NO tracks at all.** The ladder's windows are half-open on the left, so the
   point `angle ≡ 0 (mod 18)` is matched by no block and all 12 links go to -1e35. At rest
   `wheel_rb_dummy` carries an identity basis (confirmed in the rig dump — it is not marked
   ROTATED), so m_forward = (0,1,0) and `GET_HEADING_FROM_VECTOR_2D(1, 0)` = `atan2(-1, 0)` =
   **exactly 270** (our `stdlib.ts` formula) — and `270 = 15 x 18`, i.e. dead on the uncovered
   point. A freshly spawned tank that has not rolled a fraction of a degree therefore shows bare
   road wheels. Present on real SA too. Our version wraps the bucket instead of leaving a gap — a
   field-checkable difference.
2. **-1e35 as a hide mechanism.** Banishing a part by translating it 1e35 metres is a NaN/overflow
   hazard anywhere downstream of a modern transform chain, and it is a position the engine has no
   reason to trust ([[next-session-roadmap]] lesson 23 — a number arriving from data is untrusted
   input). Whether we hide honestly or reproduce the teleport is a step-3 decision; either way the
   engine must not be handed 1e35 unchecked.

**One open unknown at the end of step 1 — `0AA6` argument order.** The script passes the angle as
the **third** listed parameter (`23@=0, 24@=0, 25@=angle`). Our VM (`handlers/natives.ts` →
`AtlasMemory.call`) maps listed order straight to `SetRotate(x, y, z)`, so the angle lands on **z**
— a yaw, where a road wheel physically rolls about **X**. Settled in step 2 below.

Two things the trace does NOT tell us, recorded so they are not misread later: it comes from the
synthetic recording host whose fake sibling chain is capped at three links
(`nextSiblingPart: part < 2 ? part + 1 : null`), which is why every line reads `#2`. It is a
harness artifact, not evidence about the walk or the defect.

**What our script inherits from this spec:** address `track_1..track_12`, `wheel_big_0/1`,
`wheel_small_1..8` **by name**; one modulo instead of a 240-window scan; `SetRotateXOnly`
(one argument, one axis, already served by the atlas) instead of the ambiguous 3-arg call; and the
wrapped bucket that fixes defect 1.

### Step 2 — prototype verdict: **GO** (2026-08-07)

Two throwaway harnesses (`scripts/debug/.tmp-rhino-proto.ts`, `.tmp-rhino-anchor.ts` — deleted
after the run, per the debug-scripts rule; every number below is off a run, not derived).

**1. Name addressing works end to end — the design is viable.** A minimal authored script
(`0AE2` car find → `IS_CAR_MODEL 432` → `0A97` → `+0x18` clump → `GetFrameFromName('track_1')` →
`+0x10` → `SetRotate`) compiled clean through the SDK gate and ran headless against a rhino-shaped
world: **0 faults, 0 atlas misses**, and the rotation landed on `track_1`. **No sibling walk was
used at any point**, so the design's core claim holds.

**2. The argument order is REVERSED — confirmed, not inferred.** Three independent lines agree:

- *Primary source.* CLEO's own `CCustomOpcodeSystem.cpp` (`opcode_0AA5`/`0AA6`) collects the args
  into `arguments[]` in stream order, then `lea ecx, arguments / push [ecx] / add ecx, 4` walks the
  array **upward**. On a downward-growing stack the LAST listed parameter is pushed last, lands at
  `[esp]`, and is therefore the **first** C argument. (`0AA6` then does `mov ecx, struc` for the
  `this`.) Source added to `docs/links.md`.
- *Corpus.* Seven `0AA7 CALL_FUNCTION_RETURN 5002240 2 2 '<name>' <clump>` sites in firela/vandoor
  list the **name first**, while `CClumpModelInfo::GetFrameFromName(RpClump*, const char*)` takes
  the clump first. Our atlas already felt this and dodged it — `getFrameFromName` identifies args
  "by shape" rather than by position.
- *Physics.* A road wheel rolls about X; the original is field-proven on real SA.

Measured on the prototype, one part, angle 0.5 rad:

| Call as written | Our VM produces | Axis |
| --- | --- | --- |
| `SetRotate 3 0  0.0 0.0 0.5` (the original's shape) | `quat(0,0,0.247,0.969)` | **Z — a yaw, wrong** |
| `SetRotate 3 0  0.5 0.0 0.0` (corrected order) | `quat(0.247,0,0,0.969)` | X — correct |
| `SetRotateXOnly 1 0  0.5` | `quat(0.247,0,0,0.969)` | X — identical, and unambiguous |

So **our VM mis-ordered every multi-parameter native call** (`0AA5`-`0AA8`) — a conformance bug with
scope far beyond this script, and a SILENT one: nothing in the suite caught it, because the only
other corpus consumer, `GetFrameFromName`, is shape-matched. It does NOT explain the tracks (track
links always get `SetRotate(0,0,0)`, identity on any axis); it DOES mean the ten wheels yawed
instead of rolling.

**Fixed out of band before step 3**, as its own change in `packages/cleo` (this plan stays
script-only): `handlers/natives.ts` reverses the args once at the call boundary so the atlas rows
read the SA signatures positionally, guarded by `handlers/natives.test.ts` (4 tests; 3 of them
verified to FAIL with the reversal removed, the 4th single-argument case correctly order-independent).
Blast radius measured, not assumed: the whole `packages/cleo` + `cleo/` suite is green at 226 tests
and exactly ONE committed fixture moved — `tests/custom/cleo-traces/rhino.txt`, 59 lines of
`quat(0,0,0.707,-0.707)` → `quat(0.707,0,0,-0.707)`, i.e. only the axis, only rhino. The rule a new
atlas row must follow is in `docs/edge-cases/cleo-vm.md`.

**3. The tracks-don't-rotate root cause is neither candidate the plan named.** Running the REAL
corpus `rhino.cs` against two worlds, 10 frames each:

| World | setPartRotation | setPartTranslation | Parts touched |
| --- | --- | --- | --- |
| A. permissive (every asked name exists — what the corpus test uses) | 9 | 27 | `#2` only |
| B. the model's REAL emitted parts (`dump-vehicle-rig.ts`, 34 parts) | **0** | **0** | none |

In B the script does **nothing, ever**: `misc_e` is not an emitted part, so
`*(vehicle + 0x6A8)` reads 0, the script's own `IF 1@ != 0` guard fails, and the walk never starts
— nine `partIndex car#257 misc_e -> missing` per run and no effect. **The chain anchor is a pure
dummy frame, and the vehicle builder emits only MESH-bearing frames as parts** (`Bradley_dummies`
and `misc_e` both vanish; the rig dump shows them frame-side and absent part-side).

That retires the plan's hypothesis: it was never the sibling walk, and never the dropped parent
frames. Consequences:

- **The sibling-order hack was never the blocker and our design does not use it.** Its retirement
  still waits on the full script shipping (`docs/hacks/cleo-frame-sibling-order.md`) — but the
  reason it must go is now different from the reason recorded there, and the hack file's
  "judged on" line points at a field checkpoint that could never have passed. Correct it when 001
  ships.
- **A dummy frame is not addressable by name at all.** Our script must anchor on MESH parts only
  (`track_1..12`, `wheel_big_0/1`, `wheel_small_1..8` — all emitted), which the design already does.
- **The corpus rhino test is green on a mock that answers yes to every gate** ([[next-session-roadmap]]
  lesson 0a, verbatim). Its `distinct parts: #2` is the recording host's 3-link sibling cap, not
  behaviour. Step 3's story test must run against the model's real emitted part list, or it proves
  nothing — and the same doubt applies to the firela/vandoor corpus tests, which use the same
  permissive default.

**Go/no-go: GO.** Nothing in the design is blocked; two of the three findings make the authored
version strictly better than a faithful port, and the third is a VM bug the port would have
inherited.

### Step 3 — full script + story test

(pending)
