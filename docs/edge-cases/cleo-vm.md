# CLEO VM — current limitations

What our CLEO bytecode VM (`packages/cleo`) does not yet match about real CLEO on SA 1.0 US, and the
model-side facts a script author trips over. The VM's design and served surface are in
`docs/plans/097-cleo-basic/`; the authoring SDK is `cleo/sdk/`.

## Native calls

- **A native-call row indexes its arguments in the SA function's C order, NOT the script's.** Real
  CLEO collects the args in stream order and then pushes them upward (`lea ecx, arguments /
  push [ecx] / add ecx, 4`, `CCustomOpcodeSystem.cpp`), so on a downward-growing stack the **last
  listed parameter is the first C argument**. `handlers/natives.ts` reverses once at the call
  boundary; a new `AtlasMemory.call` row must therefore read `args[0]` as the signature's first
  parameter and must not "fix" the order again. Only the reversal site is guarded
  (`handlers/natives.test.ts`) — a row that re-reverses is SILENT, and a wrong axis looks like a
  plausible animation rather than an error.

## Vehicle models

- **Only MESH-bearing frames become parts — a dummy frame cannot be addressed at all.** The vehicle
  builder emits a part per atomic, so pure hierarchy frames (`Bradley_dummies`, `misc_e`, …) exist in
  the DFF and are absent from the rig. A script that anchors on one gets a null frame and silently
  does nothing: rhino's track script reads `m_aCarNodes[CAR_MISC_E]`, gets 0, fails its own null
  guard, and never touches a single part — **0** effects per frame against the real rig where a
  permissive mock reports 36. Check with `scripts/debug/dump-vehicle-rig.ts` (its "parts the builder
  emitted" list is the addressable set); this is also why a VM test must be given the model's real
  part list, never the default "every asked name exists".
