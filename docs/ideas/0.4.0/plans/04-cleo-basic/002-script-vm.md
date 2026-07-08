# 002 — Script VM & thread scheduler

Part of the [basic CLEO chain](readme.md). Depends on [001](001-scm-decoding.md) (decoded instructions). Delivers the **engine-agnostic execution core**: a cooperative SCM thread engine with the opcode-handler registry. Knows nothing about three.js — the extensibility keystone.

## Context

SCM runs as cooperative green threads: each script thread has an instruction pointer, local var slots (0–31 + two timer vars 32/33 that auto-increment), a boolean condition flag (set by conditional opcodes, consumed by `GOTO_IF_*`), a gosub return stack, and a wait timer. A thread executes opcodes back-to-back until `WAIT ms`, then yields; the scheduler re-runs it once `ms` of game time has elapsed. This is a tiny, well-defined VM — the trick is making it EXTENSIBLE (add opcodes without touching the core) and HEADLESS-TESTABLE (no engine dependency).

## Decisions

1. **Engine-agnostic VM.** The VM operates on decoded instructions + a `CleoHost` interface (injected). Every opcode that DOES something in the world is a handler that calls `host.*`; the VM itself only implements control flow, vars, waits, and the dispatch loop. So the whole VM is unit-testable with a mock host (assert "spawnObject called with model X at (x,y,z)"), and 003 supplies the real host.
2. **Opcode-handler registry.** `registerOpcode(id, handler)` where `handler(ctx, operands) => OpcodeResult`. `ctx` exposes the thread (read/write vars, set condition flag, jump, gosub/return, wait) + the host. Control-flow opcodes (0x0001 WAIT, 0x0002 GOTO, 0x004D/0x004C GOTO_IF_FALSE/TRUE, 0x00D6 ANDOR, 0x0050/0x0051 gosub/return, 0x004F CREATE_THREAD, 0x03A4 NAME_THREAD, 0x004E END_THREAD) are built-in handlers; world opcodes are registered by 003. Adding an opcode = one `registerOpcode` call.
3. **Var model.** Local vars per thread (int/float reinterpreted like SCM — a 32-bit slot read as int or float per the operand type); global var block shared across threads; arrays. `ANDOR` state machine for multi-condition `IF` blocks (SA's `0x00D6` sets how many following conditions combine). Timers auto-advance with game delta.
4. **Cooperative scheduler tied to game time.** The runner ticks each frame with `delta`; per thread, decrement the wait timer, and while not waiting execute opcodes up to a **per-frame instruction budget** (guard against an accidental infinite loop hanging the browser — a script with no WAIT must not freeze the tab; budget exceeded → log + yield, resume next frame). Waits use GAME time (pauses with `gameState`), consistent with `game.getHours` advancing only in play.
5. **Deterministic + observable.** Same script + same host responses → same execution (seedable where scripts use randomness opcodes). Every opcode dispatch is traceable (005's tracer hooks here). Unknown opcode → `host.onUnimplemented(id)` (default: log once + treat as no-op returning "continue") so an unsupported script degrades loudly, never crashes the VM.
6. **CLEO_CALL (0x0AB1) supported** as a built-in (call an SCM offset with args, like gosub-with-params + return values) since Wind Farm needs it — it's control flow, so it belongs in the VM core, not the world bridge.

## Tasks

- [ ] `CleoHost` interface stub (world methods declared, implemented in 003; the VM only depends on this shape).
- [ ] Thread type: IP, local vars (+timers), condition flag, gosub stack, wait state; `ScriptThread` with cursor over 001's `offsetIndex`.
- [ ] Built-in control-flow handlers: WAIT, GOTO, GOTO_IF_FALSE/TRUE, ANDOR/IF combining, gosub/return, CREATE_THREAD, NAME/END_THREAD, CLEO_CALL (0x0AB1). Unit tests per handler (jump lands, condition consumed, gosub stack, andor combining, wait yields).
- [ ] Var read/write (int/float reinterpret, global/local/array) + operand→value resolution using 001's typed operands; tests.
- [ ] `registerOpcode(id, handler)` registry + dispatch loop with the per-frame instruction budget + unimplemented path.
- [ ] `ScriptRunner`: hold threads, `tick(deltaGameMs)` advancing waits + executing; spawn/kill threads.
- [ ] Headless integration test: a hand-assembled tiny script (WAIT/GOTO/IF + a mock world opcode) runs to a known sequence of mock-host calls over N ticks.

## Verification

- The VM runs a synthetic script producing the exact expected host-call trace, purely headless (no engine).
- A no-WAIT loop hits the instruction budget and yields instead of hanging (browser-safety guard proven).
- Control flow matches SCM semantics on fixtures (negated conditionals, ANDOR groups, gosub nesting, CLEO_CALL args/returns).

## Measurements / notes

_(record after implementation)_

- per-frame instruction budget chosen: …
- built-in opcodes implemented: …
