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
  if a convention shifts.

## Steps

- [ ] Engine seam: smashed-lamp state in `vehicle-lamps.ts`/`vehicle-lamp.system.ts` (negative
      tests first: unknown light index, dead car), atlas row for `0x6C2100` (+ `0x6C2130`
      read-back), unit + story coverage on the fake-GPU boot path.
- [ ] Authored script + story test (declared budget; record instr/poll and artifact size vs
      275 B + 19 238 B footer).
- [ ] Ship via the pak build; field close-out: hotring dark at night in OpenSA (headless screenshot
      A/B — lamps on a stock car, dark on the hotring) + manual real-CLEO Wine verdict.

## Verification

Headless: lamp-state unit suite; story test in budget; whitelist gate green; byte-deterministic
rebuild. Field: the night A/B on both runtimes. Ledger records sizes, per-poll cost, and both field
verdicts.

## Ledger

(measured numbers; field verdicts)
