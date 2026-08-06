# 004 — DSL builder (the authoring surface)

Part of the [cleo/sdk chain](readme.md). Depends on [002](002-assembler-core.md) (the IR it
produces) and [003](003-dual-target-whitelist.md) (the gate it compiles through). Delivers the
typed TS surface a script author actually writes — no new language, no parser; the TS type system
IS the editor.

## Context

Root-plan decision 3: a typed TS builder — threads, labels, `wait`, structured control flow
lowering to the SCM conditional convention, opcodes by Sanny name — with raw opcode emission as the
escape hatch for anything the sugar does not cover yet. The sugar exists to make the COMMON shape
of a CLEO script (init, then a `wait`-paced loop with conditional blocks) readable and hard to get
wrong; it must never hide the bytecode model, because the disasm listing snapshot is the review
surface and the author has to be able to predict it.

## Decisions

1. **A script is a plain TS module** in `cleo/scripts/<name>/script.ts`, default-exporting a
   definition: `{ name, target?, budgetPerTick, build(s) }` — `name` becomes `03A4 SCRIPT_NAME` and
   the artifact filename; `budgetPerTick` is the DECLARED per-frame instruction budget the story
   test asserts (the VM's 10 000/thread ceiling is the hard gate above it).
2. **Opcodes by Sanny name, typed from the generated table:** `s.op('PRINT_STRING_NOW', ...)` with
   arity checked at IR construction; name→id via `@opensa/cleo`'s table. Rich per-opcode TS
   signatures only where the sugar layer wraps an opcode — no attempt to hand-type a thousand
   opcodes up front.
3. **Structured flow lowers to the SCM convention:** `s.if(...conditions).then(...).else(...)` →
   `00D6 IF` (and-count/or-count encoding as the corpus uses it) + conditional jump lowering with
   generated labels; `s.while`/`s.loop` sugar over the same. Explicit `s.label()` / `s.jump()`
   stay available — the sugar is optional, the labels it generates are visible in the listing.
4. **`wait` is first-class** (`s.wait(ms)`) — the cooperative VM and real CLEO both live on it, and
   a loop without one is the classic authored-script bug; the builder WARNS on a backwards jump
   that encloses no `wait` (a heuristic, stated as such — it can be suppressed per site).
5. **Locals are named handles** (`s.lvar('x')`, typed int/float/string) allocated by 002's
   deterministic allocator; globals only through an explicit `s.gvar(index)` — an authored script
   touching the global space says so loudly.
6. **The escape hatch is raw:** `s.raw(opcodeId, operands)` bypasses name lookup and sugar but NOT
   the whitelist gate or arity check. Nothing bypasses the gate.

## Tasks

- [ ] `src/dsl/` — the builder producing 002's IR: definition shape, `op` by name, labels/jumps,
      lvar/gvar handles, `wait`, the if/else lowering, `raw`.
- [ ] Lowering tests as LISTING snapshots: each sugar construct's emitted listing is a committed
      fixture (the diff IS the semantics), including the and/or condition-count encoding pinned
      against a corpus example.
- [ ] The missing-`wait` warning + suppression, with a test each way.
- [ ] `build.ts` wired end-to-end: discover → build IR → gate → assemble → decode-verify → write
      artifact (the architecture's build lifecycle, now real).
- [ ] `cleo/sdk/README.md` — the authoring how-to (write a script, build it, read its listing,
      write its story test).

## Verification

A sample script using every sugar construct compiles; its listing snapshot is committed and
readable; the same script via raw emission produces identical bytes (the sugar adds nothing the
listing cannot show). Determinism holds through the full pipeline.

## Measurements / notes

_(filled when executed)_
