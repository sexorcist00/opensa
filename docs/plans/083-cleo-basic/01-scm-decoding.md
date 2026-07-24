# 083/01 — SCM/CLEO decoding & opcode model

No execution — turn a `.cs` buffer into a typed instruction stream and produce the concrete opcode
whitelist plan 02/03 implement, derived from the two real target scripts.

## Decisions (carried from the idea, one updated)

1. **Two-layer decode.** Layer A = type-byte operand reader (each SA/CLEO data-type byte → the
   correctly sized typed value: int8/16/32, float32, global/local var refs, arrays, 8-char string,
   length-prefixed string, EOL `0x00`) on `BinaryStream`
   (`packages/renderware/src/parsers/binary/binary-stream.ts`). Layer B = instruction reader:
   per opcode, walk operands until the DB-declared arity or the var-args `0x00` terminator.
   Layer A is pure and exhaustively fixture-tested.
2. **UPDATED — start from the in-repo ancestor.** The car-generator extraction already walks SCM
   param types for opcode `0x014B` (the parked-cars memory; `parsers/text` CLEO references). Plan
   task 1 is to LIFT that operand-reading into the shared Layer A rather than writing a parallel
   reader — one SCM grammar in the repo, both consumers (offline car-gen extraction, runtime VM)
   on it.
3. **Opcode DB from the Sanny Builder library, vendored + pinned** (machine-readable GTA:SA
   opcode/param JSON → a generated typed table in `packages/cleo`). Covers the CLEO extensions the
   targets use (`0x0AB1` CLEO_CALL — Wind Farm calls it 72×; `0x0E` strings; note-not-act
   `0x0A8C/0x0A8D`).
4. **Decode is total and lossless.** `Instruction[]` with offset, opcode, negated flag, typed
   operands; an offset→index map (jumps target byte offsets). An operand the DB can't describe →
   hard located error (a bad DB entry surfaces here, not as a runtime mystery).
5. **Disassembler as the proof**: `disassemble(bytes)` in Sanny-like text, eyeballed against Sanny
   Builder's decompile of both scripts; committed as fixtures.

## Subtasks

- [ ] Re-source the two target `.cs` (readme note — NO_COMMIT was cleaned); commit small copies as
      test fixtures if licensing allows, else fixture-manifest them from the user's mod library.
- [ ] Lift/generalise the existing 0x014B operand reading into Layer A; fixtures per data-type
      byte (incl. 0x09/0x0E strings, var refs, EOL); the car-gen extractor keeps passing its tests
      on the shared reader.
- [ ] Vendor the pinned Sanny DB → generated `OpcodeDef` table + loader tests (0x0001, 0x00D6,
      0x0107, 0x0453, 0x0AB1 resolve).
- [ ] Layer B + `decodeScript(bytes) → { instructions, offsetIndex }` + `disassemble`.
- [ ] Disassemble both targets; cross-check vs Sanny; commit disassembly fixtures.
- [ ] **Produce the opcode whitelist** (id → name → category: control-flow / var / model / object /
      cleo / memory) — the implementation checklist for 02/03. Record it here.

## Verification

- Round-trip: every jump/gosub target in both scripts resolves through the offset map.
- Disassembly matches Sanny line-by-line on Ferris, sampled on Wind Farm.
- Operand fixtures cover every data-type byte the two scripts contain.

## Ledger

_(whitelist, data-type bytes seen, DB gaps found)_
