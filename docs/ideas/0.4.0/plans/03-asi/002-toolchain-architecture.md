# 002 — Toolchain & project architecture

Part of the [opensa-asi chain](readme.md). Depends on [001](001-reverse-engineering.md) (we need to know it's function-hooks + raw patches before choosing a hook lib). Delivers a **buildable, empty-but-loading ASI**: cross-compiles on macOS, loads under Wine, logs "hello", patches nothing yet.

## Context

This is the repo's FIRST native/C++ artifact — everything else is TypeScript/Nx. It must fit the monorepo conventions (a `tools/opensa-asi/` package) while carrying a C++ build that produces a Win32 PE DLL from macOS with no Windows machine and no MSVC. The user tests everything under Wine already.

## Decisions

1. **Cross-compiler: MinGW-w64 `i686-w64-mingw32-g++` (primary), Zig `zig cc` as fallback.** SA is 32-bit (PF is i386) so the target is `i686`. MinGW-w64 is the community-proven path (FLA/PF-class DLLs), installs via Homebrew, fully headless. Zig cross-compiles i386-windows with zero toolchain install and is a great fallback if MinGW linking of the C++ runtime gets fiddly — evaluate both in task 1, pin one, document the other.
2. **Static-link the C++ runtime** (`-static -static-libgcc -static-libstdc++`) so the `.asi` has no MinGW DLL dependencies — it must drop into a game folder and just work.
3. **Hook/patch lib: injector.hpp** (thelink2012, permissive license — freely reusable, unlike ProperFixes; the same lib PF/FLA use). Header-only, MinGW-compatible. **NOT plugin-sdk** — we do pure memory patches, not RW/CLEO glue; plugin-sdk's weight buys us nothing here. If injector.hpp fights MinGW, fall back to a ~200-line self-authored subset (`WriteMemory`, `MakeCALL/JMP`, `ReadMemory`, VirtualProtect wrappers) — fully transparent and debuggable, which is a maintainability plus we may take anyway.
4. **Bare `DllMain` ASI entrypoint** — no ASI framework. On `DLL_PROCESS_ATTACH`: fingerprint the exe (003), apply the patch table (003/004), log. That's the whole lifecycle.
5. **Repo layout** mirrors other tools but with a native sub-build:

   ```
   tools/opensa-asi/
     src/            # C++ (dllmain.cpp, patches/, engine addresses, fingerprint, log)
     third_party/    # injector.hpp (vendored, pinned commit)
     build/          # CMake or a plain Makefile driving i686-w64-mingw32-g++
     test/           # macOS-side byte-level unit tests (plan 005)
     docs/plans/     # promoted from this ideas chain when work starts
     package.json    # npm scripts wrap the native build (`npm run build:asi`) for monorepo consistency
     readme.md
   ```

6. **Build driver: CMake with a MinGW toolchain file** (portable, IDE-friendly) OR a plain Makefile (fewer moving parts). Pick by which the maintainer prefers to debug; wrap it behind an `npm run` script so it's invoked like every other tool in the repo. The generator's TS side (patch-table codegen, 003) stays in the Nx/vitest world; the C++ side is compiled by the wrapped native build.
7. **The "tool" is two halves**: (a) the C++ ASI source, and (b) a TypeScript generator that emits the patch table / fingerprint constants from `001`'s `patch-catalogue.md` (so the addresses have ONE source of truth, machine-checked, not hand-copied into C++). Decide the codegen boundary here; implement in 003.

## Tasks

- [ ] Evaluate MinGW-w64 vs Zig: build a trivial i686 Win32 DLL exporting a stub, load it under Wine (via a tiny loader or Ultimate ASI Loader) → confirm both work; pin MinGW-w64, document Zig fallback with exact commands.
- [ ] `tools/opensa-asi/` package scaffold: layout above, `package.json` scripts (`build:asi`, `clean`), README with macOS setup (brew formula, versions).
- [ ] Vendor injector.hpp at a pinned commit under `third_party/` with its license; a compile smoke that includes it.
- [ ] Minimal `dllmain.cpp`: `DllMain` → open a log file next to the exe, write a banner + build hash, return. Static-linked runtime; verify `.asi` has no external DLL deps (objdump import table).
- [ ] Wine load test: drop the built `.asi` into a Wine SA install with an ASI loader, boot, confirm the banner appears in the log. Document the exact Wine invocation (reuse the user's existing Wine setup).
- [ ] CMake/Makefile finalized; `npm run build:asi` produces `opensa.asi` deterministically (record size/hash).
- [ ] Decide + document the TS-generator ↔ C++ boundary (how `patch-catalogue.md` becomes compiled constants).

## Verification

- `npm run build:asi` on a clean macOS + brew MinGW produces a loadable PE32 DLL; import table shows only KERNEL32/USER32 (no MinGW runtime DLLs).
- Wine boot writes the banner log — the ASI loads into the real game process.

## Measurements / notes

- chosen toolchain + versions; Zig fallback command: …
- built `.asi` size / imports: …
- Wine invocation for load test: …
