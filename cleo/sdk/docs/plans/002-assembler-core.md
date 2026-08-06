# 002 — Assembler core (the decoder's mirror)

Part of the [cleo/sdk chain](readme.md). Depends on [001](001-scaffold.md) (a compiling project).
Delivers the load-bearing half of the SDK: IR → standard CLEO 4 bytes, proven against the corpus
byte-for-byte. Everything after this plan is surface; this plan is the format.

## Context

`@opensa/cleo` already owns the format's ground truth in the read direction: `core/operands.ts`
(the type-byte operand layer, a LOSSLESS union), `core/decode.ts` (u16 opcode + DB arity + variadic
tail + `__SBFTR` trailer), and the corpus fixtures of real Sanny-compiled bytes. The assembler is
the same knowledge run backwards — and because the decoded union is lossless, the strongest
possible test exists for free: re-assembling a decoded corpus script must reproduce its bytes
EXACTLY. That test — not our reading of any spec — is the referee for every encoding decision here.

## Decisions

1. **IR is the assembler's contract** (`src/ir.ts`): a flat instruction list — opcode by Sanny name
   OR raw id, negation flag, typed operands with symbolic labels and lvars. The DSL (004) produces
   it; the whitelist gate (003) walks it; the assembler consumes it. Arities checked against the
   generated table from `@opensa/cleo` at IR construction, not at emit time.
2. **Operand writer mirrors `operands.ts` one-to-one** — same type-byte set (`0x01`–`0x13`), same
   payload layouts, byte-per-char strings, NUL-padded fixed forms. Int width policy: smallest width
   that holds the value (int8 → int16 → int32) — deterministic, and matching Sanny's practice as
   the corpus re-encode test will prove or correct.
3. **Labels resolve to the corpus's negative-offset convention** for custom scripts. Two-pass
   assembly: lay out with worst-case widths is NOT acceptable if it breaks byte-identity — offsets
   are int32 in the corpus (pin this against the fixtures); the re-encode test decides.
4. **LVAR allocator over `var-space.ts` semantics** — deterministic, declaration-ordered, timer
   slots reserved exactly as the VM defines them. The VM is the ground truth for what a local slot
   means; the allocator must never hand out a slot the VM treats specially.
5. **Native-call tails (`0AA5`–`0AA8`)**: declared head operands, then args + output vars, then the
   `0x00` terminator — the decoder's variadic rule run backwards.
6. **Trailer always emitted:** `[u32 codeEnd]["__SBFTR\0"]`, no VAR/FLAG/SRC metadata (we are not
   Sanny; the decoder treats the footer as opaque and the trailer alone gives tooling the code
   boundary). The corpus re-encode test must therefore compare the CODE region byte-exactly and the
   footer by policy, not blindly.
7. **Determinism is a tested property**, not a hope: build twice, compare bytes, in CI.

## Tasks

- [ ] `src/assemble/operands.ts` — the writer; property tests `readOperand(emit(x)) ≅ x` across the
      full type-byte set (reusing `@opensa/cleo`'s reader as the oracle).
- [ ] `src/assemble/emit.ts` — instruction emission (u16 opcode, negation bit, arity from the
      generated table, variadic tails).
- [ ] `src/assemble/labels.ts` — two-pass label resolution, negative offsets, located errors for
      unknown/duplicate labels.
- [ ] `src/assemble/lvars.ts` — the allocator, pinned to `var-space.ts` (import its constants, do
      not copy them).
- [ ] `src/assemble/trailer.ts` + top-level `assemble(ir): Uint8Array`.
- [ ] **The referee test:** for each corpus fixture — decode → IR-from-decoded → assemble →
      byte-identical code region. Any mismatch is an encoding fact we got wrong; fix the writer,
      never special-case the test.
- [ ] Determinism test (double build, byte compare).
- [ ] Record in Measurements: corpus files re-encoded, total bytes proven, any encoding fact the
      referee test corrected.

## Verification

Every corpus fixture round-trips decode → assemble byte-identically over its code region; operand
property tests green across all type bytes; determinism test green. No engine file touched.

## Measurements / notes

_(filled when executed)_
