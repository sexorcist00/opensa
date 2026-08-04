# 097/01 — SCM/CLEO decoding & opcode model

No execution — turn a `.cs` buffer into a typed instruction stream, prove it on the whole 7-script
corpus, and produce the opcode whitelist the rest of the chain implements. Written from scratch: the
recon confirmed there is **no SCM code anywhere in the repo** (the old "lift the 0x014B reader" task
referenced comments, not code). The design itself is validated — the recon disassembler decoded the
entire corpus with exactly this shape.

## Decisions

1. **Two-layer decode.** Layer A = type-byte operand reader (each data-type byte → correctly sized typed
   value) on a plain little-endian cursor. The full type-byte set observed in the corpus:
   `0x01` int32, `0x02`/`0x03` global/local var (u16), `0x04` int8, `0x05` int16, `0x06` float32,
   `0x07`/`0x08` (+`0x0C/0x0D/0x12/0x13`) array refs (u16 offset, u16 index var, u8 size, u8 flags),
   `0x09` fixed 8-char string, `0x0A/0x0B/0x10/0x11` string-var refs (u16), `0x0E` length-prefixed
   string, `0x0F` fixed 16-char string, `0x00` = variadic terminator. Layer A is pure and
   exhaustively fixture-tested.
2. **Layer B = instruction reader driven by the DB**: u16 opcode (top bit `0x8000` = negated
   conditional) + operands until the DB-declared arity — with THREE special forms the recon nailed down:
   - **variadic opcodes** (`004F`, `0AB1`, `0AB2`, `0AD3`, …): read params until the `0x00` terminator;
   - **native calls `0AA5–0AA8`**: head = address, [struct (methods only)], numParams (literal), pop;
     then `numParams` input args, then output vars (`0AA7/0AA8`: one), then a `0x00` terminator;
   - **the Sanny footer**: every Sanny-compiled `.cs` ends with `FLAG`/`SRC`/`VAR` metadata sections
     after the last instruction (van door: 24 597 B file, 102 instructions — the rest is a variable-name
     table). The decoder recognises the footer boundary (section magic after an unconditional
     jump/return) and stops there; the footer is preserved as an opaque tail, never "failed on".
3. **Opcode DB = the Sanny Builder library JSON, vendored + pinned** (`sannybuilder/library` `sa.json`,
   3 739 commands with `num_params` across default/CLEO/CLEO+/NewOpcodes/…) → a generated typed
   `OpcodeDef` table in `packages/cleo/core`. Regeneration is a script, the pin is a recorded version;
   a DB gap surfaces as a located decode error, not a runtime mystery.
4. **Decode is total and lossless.** `Instruction[]` with byte offset, opcode id, negated flag, typed
   operands; an offset→index map (jumps target byte offsets — negative offsets in a `.cs` are
   script-local). An operand the DB cannot describe → hard located error.
5. **Disassembler as the proof**: `disassemble(bytes)` in Sanny-like text. The recon listings (all 7
   scripts) become the reference; committed as fixtures.
6. **Corpus fixtures the real-fixture way** ([[real-fixtures-over-synthetic-tests]]): the seven `.cs`
   are small mod files — commit them under the package's fixtures if licensing allows, else
   manifest them from `NO_COMMIT/cleo` (one manifest line each). Real scripts falsify what synthetic
   ones confirm — the footer and the native-call encoding were BOTH invisible to a synthetic corpus.

## Subtasks

- [ ] Vendor + pin `sa.json`; generator → typed `OpcodeDef` table + loader tests (`0001`, `00D6`,
      `0453`, `0AB1`, `0AA7`, `0E01` resolve with correct arity/extension).
- [ ] Layer A operand reader + fixtures per data-type byte (every byte the corpus contains, incl. the
      6-byte array refs and both string forms).
- [ ] Layer B + the three special forms + `decodeScript(bytes) → { instructions, offsetIndex, footer }`.
- [ ] `disassemble()`; decode all 7 corpus scripts; commit listings as fixtures.
- [ ] **Produce the opcode whitelist** (id → name → category: control-flow / var / math / object /
      vehicle / player / native-memory / text / file / clock — with per-script frequency). Record it
      here; it scopes plans 03–05 exactly.

## Verification

- All 7 corpus scripts decode to the footer boundary with zero unknown opcodes/operands (the recon
  already achieved this — regression, not aspiration).
- Every jump/gosub/CLEO_CALL target in the corpus resolves through the offset map.
- Operand fixtures cover every data-type byte present in the corpus.
- Instruction counts match the recon census (91 / 239 / ~44 / ~102 / ~2 085 / ~64 / ~64).

## Ledger

_(DB pin, decode times, whitelist, data-type bytes seen, DB gaps found)_
