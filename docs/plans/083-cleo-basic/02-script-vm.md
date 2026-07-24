# 083/02 — Script VM & thread scheduler (engine-agnostic core)

The execution core: a cooperative SCM thread engine with an opcode-handler registry. Knows nothing
about the engine — the extensibility keystone. This plan survives from the idea essentially
unchanged (it was designed engine-agnostic); only the time source note is updated.

## Decisions

1. **Engine-agnostic VM.** Operates on decoded instructions + an injected `CleoHost` interface.
   The VM implements control flow, vars, waits, dispatch; world opcodes are handlers calling
   `host.*`. Fully unit-testable with a mock host ("createObject called with model X at x,y,z").
2. **Handler registry.** `registerOpcode(id, handler)`; `handler(ctx, operands) → OpcodeResult`;
   `ctx` = thread ops (vars, condition flag, jump/gosub/return, wait) + host. Built-ins:
   WAIT `0x0001`, GOTO `0x0002`, GOTO_IF_FALSE/TRUE `0x004D/0x004C`, ANDOR `0x00D6`,
   gosub/return `0x0050/0x0051`, CREATE_THREAD `0x004F`, NAME/END_THREAD `0x03A4/0x004E`, and
   **CLEO_CALL `0x0AB1`** (gosub-with-params — control flow, so it lives in the core).
3. **Var model.** Per-thread locals 0–31 + timers 32/33 auto-advancing on game delta; shared
   global block; arrays; 32-bit slots reinterpreted int/float per operand type; ANDOR state
   machine for combined conditions.
4. **Cooperative scheduler on GAME time.** `tick(deltaGameMs)` decrements waits and executes up
   to a **per-frame instruction budget** per thread (a WAIT-less loop logs + yields instead of
   hanging the tab). Waits pause with `gameState` (mirrors `game.getHours` advancing only in play).
   Time comes IN as delta — no `performance.now()` in the core (the same purity rule the camera
   chain uses; replays and tests feed synthetic deltas).
5. **Deterministic + observable.** Same script + same host responses → same execution; every
   dispatch traceable (plan 05 hooks here). Unknown opcode → `host.onUnimplemented(id)` (default
   log-once + no-op-continue) — degrade loudly, never crash.

## Subtasks

- [ ] `CleoHost` interface stub (world methods declared; plan 03 implements).
- [ ] Thread type (IP, locals+timers, condition flag, gosub stack, wait) over plan-01's
      `offsetIndex`.
- [ ] Built-in control-flow handlers + per-handler unit tests (jump lands, condition consumed,
      gosub nesting, ANDOR combining, CLEO_CALL args/returns, wait yields).
- [ ] Var read/write + operand→value resolution + tests (int/float reinterpret, global/local/array).
- [ ] Registry + dispatch loop + instruction budget + unimplemented path.
- [ ] `ScriptRunner`: thread lifecycle, `tick(deltaGameMs)`.
- [ ] Headless integration: a hand-assembled script (WAIT/GOTO/IF + mock world opcode) produces
      the exact expected host-call trace over N ticks; a no-WAIT loop hits the budget and yields.

## Verification

- Synthetic script → exact host-call trace, fully headless.
- Budget guard proven (no tab hang).
- SCM semantics on fixtures: negated conditionals, ANDOR groups, gosub nesting, CLEO_CALL.

## Ledger

_(budget chosen, built-ins implemented)_
