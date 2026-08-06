# 003 — C++ framework extraction (`asi::`)

Part of the [asi/sdk chain](readme.md). Depends on 002. The load-bearing step: the C++ framework
moves into `asi/sdk/src/` under namespace `asi::`, the three inversions land, and perfect-map
becomes a consumer. **Referee: the rebuilt `.asi` against 001's baseline — byte-identical modulo
the PE header timestamp is the target; if the namespace/layout rename makes that unreachable, the
fallback is an identical verify-only site report + the unchanged KERNEL32-only import table + an
explained size delta, and this file's ledger names which was achieved.**

## Context

Coupling was measured at review (the architecture doc carries the classification): `mem.hpp`,
`hook.hpp`, `freestanding.cpp` and the Makefile move untouched; `log.hpp`, `coexistence.hpp`,
`dllmain.cpp` need one parameter (tag/filename); `patch_table.hpp`, `fingerprint.hpp`,
`config.hpp` need the inversions. The single-TU include model (one `dllmain.cpp` includes
everything; no separate SDK objects) is preserved — it is what keeps `-nostdlib` simple.

## Decisions

1. **Namespace `asi::`** for everything that moves (user verdict). Perfect-map payloads stay
   `pm::`/`pm::patches::`; generated constants stay `pm::gen` (002's namespace parameter).
2. **The plugin surface** (constraint 7 of the architecture): the SDK's attach lifecycle calls
   plugin-supplied pieces — the tag + log filename, the generated site table, the apply entry
   point. Concretely: `patch_table.hpp` loses `#include "apply.hpp"` and takes the plugin's apply
   function + table; `fingerprint.hpp` takes the fingerprint/exe constants as arguments instead of
   reading `pm::gen::` directly. The exact C++ mechanism (config header the plugin provides vs
   function parameters) is decided in-code, judged by: no SDK header names a plugin symbol.
3. **Config split:** framework knobs become `ASI_APPLY`/`ASI_DEBUG` (internal rename — the
   `make` / `make APPLY=1` / `make DEBUG=1` interface is unchanged); `PM_FIX_*`/`PM_*_LOG` stay in
   perfect-map's own config header.
4. **Makefile fragment:** `asi/sdk/mk/asi-plugin.mk` carries the toolchain, flags, link line and
   rules; perfect-map's Makefile shrinks to OUT name + payload defines + include. The fragment's
   `HDRS` globs BOTH the SDK headers and the plugin's `src/**/*.hpp` — fixing the latent
   staleness bug (perfect-map's `HDRS` missed `src/patches/*.hpp`).
5. **Hook-comment reword, not refactor:** `hook.hpp`'s comments name perfect-map sites; they
   become generic examples. Code untouched.

## Tasks

- [ ] Move + rename per decisions 1–3; perfect-map's `src/` keeps only `dllmain.cpp` (thin),
      `config.hpp` (payload half), `patches/`, `generated/`.
- [ ] Makefile fragment (decision 4); perfect-map consumes it; `make`, `make APPLY=1`,
      `make DEBUG=1` and the per-fix `PM='-D…'` bisection all still work.
- [ ] Referee run: build APPLY=1 + verify-only; compare against 001's baseline (byte-compare with
      the PE `TimeDateStamp` masked; `objdump -p` import table; sizes).
- [ ] `asi/perfect-map/docs/architecture.md` + `README.md` updated in the same change (the
      framework sections now point at the SDK); `asi/sdk/README.md` gains the consumer how-to.

## Verification

Both build modes green from perfect-map's thin Makefile; the referee's verdict recorded (target or
named fallback); no SDK header names a plugin symbol (grep); full suite + tsc + `eslint .` green.

## Measurements / notes

*(ledger: byte-compare verdict, import table diff, sizes per mode, what moved untouched vs
reworded)*
