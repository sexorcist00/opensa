# 097/08 — CLEO authoring SDK: write OUR OWN scripts, target SA and OpenSA

A root-level subproject (the `asi/perfect-map` pattern: a self-contained workspace project outside
`packages/`/`tools/`, because it AUTHORS runtime content rather than building the map) that lets us
write CLEO scripts in TypeScript and compile them to standard `.cs` bytecode. One source, two
runtimes: the same compiled script runs under **real CLEO on the canonical SA 1.0 US exe** and under
**our VM** — which also makes every authored script a conformance test of the VM against real CLEO
(the impersonation doctrine, exercised from the other side).

**Execution chain:** [`cleo/sdk/docs/`](../../../cleo/sdk/docs/architecture.md) — the project-local
architecture + plans 001–005 ([chain readme](../../../cleo/sdk/docs/plans/readme.md), the
`asi/perfect-map` pattern). This file stays the root-level plan: the goals check, the scope cuts,
and the chain's ledger.

**Why now:** the user's call (2026-08-05). The corpus work proved the VM; the next consumers of
scripting are OURS — city-life is the named future customer (ped ambience, spawn logic). Authoring
in Sanny Builder means a Windows GUI tool, no types, no tests, no CI; authoring in TS against our
own vendored opcode DB gives all three and emits the very format mod authors already ship.

**Explicit scope cut (same user call):** NO corpus rewrites. rhino tracks stays the author's script
(field-proven at 120 fps, in budget); `no_lights.cs` is SKIPPED entirely — not supported, not
rewritten (the native light-damage alternative is recorded in
`docs/postmortem/097-hotring-hotknife-intake.md`).

## The goals check (docs/project-goals.md)

1. **Authored data read as meant:** the SCM/CLEO bytecode format and the vendored+pinned Sanny
   opcode DB (`packages/cleo/vendor/sa.json`) — we EMIT exactly the format mod authors write, so
   our scripts are ordinary CLEO mods, installable anywhere.
2. **What the original does / why not our answer:** authors compile Pascal-ish Sanny source on
   Windows. The FORMAT is the contract; the authoring tool is not. Ours is typed, headless-testable
   and CI-gated.
3. **Better, demonstrated:** every authored script round-trips through our own disassembler
   (snapshot), runs headless on the VM with a story test, and decodes 100 % via `scm-disasm` — all
   in CI. Sanny gives none of these.
4. **Per-frame cost:** the SDK itself is build-time — zero runtime cost. Every authored script
   states its per-frame instruction budget in its story test (the VM's 10 000/thread ceiling is the
   hard gate; rhino's measured ~2 000 is the calibration point).
5. **Mod-author contract unchanged:** emitted `.cs` are standard CLEO 4 scripts. By default the SDK
   refuses opcodes outside the DUAL-TARGET whitelist (see decision 4), so an emitted script never
   silently requires OpenSA.

## Decisions

1. **Location & name:** root `cleo/` category folder (mirror of `asi/`), first project `cleo/sdk`,
   package `@opensa/cleo-sdk` (no collision with `@opensa/cleo`, the runtime VM package). Our
   authored script SOURCES live in `cleo/scripts/` next to it; compiled `.cs` artifacts are build
   outputs, never committed.
2. **Reuse, don't fork:** the SDK imports the opcode table, encoders' ground truth and the
   disassembler from `@opensa/cleo` (the vendored Sanny DB stays the ONE source of arities). The
   assembler is the decoder's mirror: opcode-by-name emission, typed operands, label/jump
   resolution (the corpus's negative-offset convention), LVAR allocation, the `0AA5-0AA8`
   native-call tail encoding, and the `__SBFTR` trailer so decode-to-EOF tooling sees an explicit
   code boundary.
3. **DSL shape:** a typed TS builder (threads, labels, `wait`, structured if/else lowering to
   `00D6`/`004D`, opcodes by Sanny name) — no new language, no parser; the TS type system IS the
   editor surface. Escape hatch: raw opcode emission for anything the sugar does not cover yet.
4. **Dual-target whitelist as data:** allowed = (opcodes real CLEO 4.x serves on SA 1.0 US) ∩ (our
   VM's handler registry). Emitting outside it is a build ERROR unless the script declares
   `target: 'opensa-only'` — the flag is embedded in the artifact name so a `.cs` that cannot run
   on real SA is never mistaken for one that can (contract rule: the name carries it).
5. **Conformance proof, not a corpus rewrite:** the first authored script is a minimal
   `hello-conformance` (SCRIPT_NAME + a periodic `0ACD PRINT_STRING_NOW` + clean termination) —
   enough to prove assemble → disasm round-trip → headless run → field boot. Verifying it under
   real CLEO on the Wine harness is a MANUAL step, recorded in the ledger when done (the SDK's
   claim is "standard CLEO 4 bytes", proven by the whitelist + format tests until then).
6. **CI:** the SDK's own unit tests + per-script story tests join the normal test run; `.cs`
   artifacts rebuild deterministically (byte-identical for identical sources).

## Subtasks

- [ ] Scaffold `cleo/sdk` (workspace project, `type:tool` tags, README with the layout + the
      why-root-not-tools line) + `cleo/scripts/` home.
- [ ] Assembler core: emission, labels, LVARs, native-call tails, trailer + round-trip tests
      against the corpus fixtures' encoding facts.
- [ ] Whitelist gate (decision 4) as generated data + tests (a forbidden opcode fails the build
      with the two runtimes' names).
- [ ] DSL builder + `hello-conformance` script: assemble → `scm-disasm` snapshot → `cleo-run`
      story → hand-place into `build/original/opensa/cleo/` → field boot `?cleo=1` (census line
      +1, the print visible).
- [ ] Docs in the same change: `docs/commands.md` (build command), `docs/features/cleo.md` state
      row, plans README pointer; `docs/contracts/` only when a NAME rule ships (the
      `opensa-only` artifact naming from decision 4).
- [ ] Ledger: sizes, round-trip proof, headless numbers, field verdict.

## Verification

A script authored in TS compiles to a `.cs` that (a) our disassembler renders to the expected
snapshot, (b) runs headless within its declared budget, (c) boots in the field via the normal
`cleo/` path, and (d) contains only dual-target opcodes unless explicitly flagged. Re-running the
build yields byte-identical artifacts.

## Out of scope (recorded)

- Corpus rewrites (rhino stays authored; no_lights skipped — see above).
- Ped-task opcodes and city-life scripts themselves — they arrive with the class-C facet
  (city-life territory); this plan only guarantees they will have a typed, tested home.
- A Sanny-source parser (we author in TS; the DB is the shared truth).

## Ledger

**DONE 2026-08-06** — executed as the project-local chain `cleo/sdk/docs/plans/` (001–005, one
commit per plan; per-plan ledgers there). The chain's numbers:

- **Assembler proof:** all 7 corpus fixtures re-encode byte-identically (23 602 code bytes /
  2 689 instructions); the referee corrected a real decoder fact — fixed-string bytes past the
  first NUL are now preserved (`padding`), making the decoded union genuinely lossless.
- **Whitelist:** 90 dual-target of 105 VM-served opcodes (generated, drift-tested); all 15
  non-dual are CLEO+ — the corpus mods genuinely require the plugin on real SA.
- **hello-conformance:** 88 B artifact, 10 instructions; headless story green (5 prints, clean
  termination, worst 7 instr/tick vs 50 declared, avg 0.10); deterministic (byte-identical
  rebuild, sha1 `a5c253f9…`).
- **Field verdict (2026-08-06, headless harness):** census `[cleo] 7 script(s)` (+1 over the six
  shipped mod scripts), `HELLO OPENSA` toast visible on screen in Ganton — screenshot taken.
  Artifact was hand-placed for the check and removed after (a conformance artifact, not a
  shipping mod).
- **Real CLEO under Wine: PASSED, user-confirmed 2026-08-06** — the artifact in the real install's
  `CLEO/` folder, the print visible in-game on the canonical 1.0 US exe. The dual-target claim is
  field-proven on both runtimes; the impersonation doctrine exercised from the authoring side, and
  it held.
