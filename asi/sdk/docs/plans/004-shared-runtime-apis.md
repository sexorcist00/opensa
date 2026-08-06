# 004 — Shared runtime APIs (the duplicates die)

Part of the [asi/sdk chain](readme.md). Depends on 003. The only step that intentionally CHANGES
payload code, so its referee is verdict-level, not byte-level: the build-mode matrix compiles, the
verify-only site report is unchanged, and the behavioural confirmation rides 005's Wine/field
step.

## Context

Both payloads hand-rolled the same two things the framework didn't offer: a runtime append-logger
(the framework `Log` closes at the end of attach, before hooks fire — so `int16.hpp` grew
`DbgItoa`+`DbgAppend` and `fx2dfx.hpp` grew `PmFxDeadSystemLog`, near-duplicate
CreateFileA/itoa/WriteFile code), and a verify-my-sites-or-defer loop with the site bytes
HAND-COPIED out of the generated table — violating the no-hand-edited-address rule
(`asi/perfect-map/docs/architecture.md`'s own "declarative records" claim). This plan makes the
SDK offer both, and routes the hand-copied continuation anchors through the catalogue.

## Decisions

1. **`asi::AppendLog`** — reopen-append logger + decimal/hex formatters, usable from a live hook.
   Both payloads' private loggers are deleted in favour of it.
2. **`asi::VerifySitesOrDefer(log, sites, count, tag)`** — the shared loop; a payload states
   WHICH sites, never re-declares their bytes.
3. **Continuation anchors become catalogue sites.** The byte arrays payloads hand-declared
   (`kIncludeEntry`, `kRemoveIplEntry`, the `kCont*` continuation bytes, fx2dfx's equivalents)
   move into `gen/catalogue.ts` entries and flow through the generated header. The generated
   header GROWS — that is expected and outside 002's byte-identity claim (banked and closed).
4. **Behaviour-preserving by construction:** same checks, same order, same defer policy, same log
   *verdicts* (message wording may carry the shared tag format; the ledger records any wording
   drift so a log-diff in 005 has an honest key).

## Tasks

- [ ] Decisions 1–2 in `asi/sdk/src/`; payload duplicates deleted.
- [ ] Decision 3: catalogue entries + regenerated header; payloads reference `pm::gen::`
      constants; grep proves no byte array literal remains in `src/patches/`.
- [ ] Referee: verify-only build's site report identical to 003's (site list, order, verdicts);
      APPLY=1 + DEBUG=1 + both `PM_FIX_*` bisection combos compile and link; sizes recorded.
- [ ] Suite + tsc + `eslint .` green (catalogue tests updated for the new entries).

## Verification

No hand-declared address or expected-byte literal survives in payload code (grep with the ledger
listing the hits before/after); the verify-only report is unchanged; every build-mode combination
links with the KERNEL32-only import table intact.

## Measurements / notes

*(ledger: before/after grep counts, site report diff, sizes per mode, wording drift if any)*
