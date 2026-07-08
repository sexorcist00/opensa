# 001 — SCM/CLEO decoding & opcode model

Part of the [basic CLEO chain](readme.md). No execution yet — turns a `.cs` byte buffer into a typed instruction stream and produces the concrete opcode whitelist the VM (002) must implement, derived from the two real target scripts.

## Context

Compiled SCM is little-endian: `u16` opcode (top bit `0x8000` = negated conditional), then operands each prefixed by a **data-type byte**. The engine already has the right cursor — `BinaryStream` (`packages/renderware/src/parsers/binary/binary-stream.ts`: `u8/u16/u32/i16/i32/f32/string/bytes/seek`). A standalone `.cs` is a raw thread body (no `main.scm` SCM header/segments) — decoding starts at offset 0.

The blocker to hand-writing a decoder is the operand grammar: **how many operands an opcode takes depends on the opcode**, and there are thousands. The open **Sanny Builder library** publishes this as machine-readable JSON (opcode id → name, param list, param types, "is conditional", var-args marker). We consume that as the opcode DB instead of transcribing it.

## Decisions

1. **Two-layer decode.** Layer A = a **type-byte operand reader** (given a data-type byte, read the correctly-sized/typed value: int8/16/32, float32, global/local var ref, arrays, 8-char string, length-prefixed string, EOL 0x00). Layer B = an **instruction reader** that, per opcode, reads operands until either the DB-declared arg count is met or (for var-arg opcodes) the `0x00` terminator. Layer A is pure and exhaustively unit-testable against hand-built byte fixtures.
2. **Opcode DB from Sanny library, vendored + pinned.** Import the GTA:SA opcode/param JSON at a pinned version into `packages/cleo` (or a generated TS table). It provides param arity/types for correct operand walking and human names for tracing. Cross-check a sample against Sanny Builder's own decompile of the two scripts.
3. **CLEO opcodes included.** The DB must cover CLEO extensions actually used: `0x0AB1` CLEO_CALL (Wind Farm uses it 72×), length-prefixed strings (`0x0E`), and note (not necessarily decode-act) memory ops `0x0A8C`/`0x0A8D`. Decoding ≠ executing; unknown/act-later opcodes still decode into the stream (their operands walked via the DB) so the disassembly is complete.
4. **Decode is total and lossless.** Output an `Instruction[]` (offset, opcode, negated flag, typed operands) that round-trips offsets exactly (jumps target byte offsets — the VM needs an offset→index map). An operand the DB can't describe → a hard, located error (not a silent skip) so a bad DB entry is caught here, not as a mystery at runtime.
5. **Disassembler as the deliverable proof.** A `disassemble(bytes): string` (Sanny-like text) that we eyeball against Sanny Builder's output for the two scripts — the confidence check that the grammar + DB are right.

## Tasks

- [ ] Vendor the Sanny Builder GTA:SA opcode/param DB (pinned) → a typed `OpcodeDef` table (id, name, params[], conditional, varargs); a loader + tests that a few known opcodes (0x0001, 0x00D6, 0x0107, 0x0453, 0x0AB1) resolve correctly.
- [ ] Layer A operand reader on `BinaryStream`: every SA/CLEO data-type byte → typed operand; fixtures per type incl. length-prefixed (0x0E) and 8-char (0x09) strings, var refs, EOL.
- [ ] Layer B instruction reader: DB-driven operand walking, negated-flag extraction, offset tracking, offset→index map; var-args termination on 0x00.
- [ ] `decodeScript(bytes): DecodedScript` (`{ instructions, offsetIndex }`) + a `disassemble` pretty-printer.
- [ ] Disassemble BOTH target scripts; cross-check against Sanny Builder decompiles; commit the disassembly as fixtures.
- [ ] Produce **the opcode whitelist**: the exact set of opcodes the two scripts use, tagged (control-flow / var / model / object / cleo / memory), as the implementation checklist for 002/003. Record it here.

## Verification

- Round-trip: decode → the offset map lets every jump/gosub target resolve to a real instruction (no dangling offsets in either script).
- Disassembly of both scripts matches Sanny Builder's opcode+operand reading (spot-checked line by line on the small Ferris script, sampled on Wind Farm).
- Operand reader fixtures cover every data-type byte the two scripts contain.

## Measurements / notes

_(fill during decode)_

- opcode whitelist (id → name → category) for the two scripts: …
- data-type bytes encountered: …
- any DB gaps found (opcodes missing from the Sanny library / CLEO+ ones): …
