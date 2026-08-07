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
