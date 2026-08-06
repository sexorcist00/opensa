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

- [ ] Reverse ONE unrolled block into a spec (inputs, per-link angle formula, wrap handling);
      write it into this ledger.
- [ ] Go/no-go prototype: a minimal authored script that resolves `track_1` by name and rotates it,
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

(spec of the per-link math; prototype verdict; measured numbers; field verdicts)
