# 002 — TS codegen extraction + provenance convention

Part of the [asi/sdk chain](readme.md). Depends on 001. Moves the TypeScript half of the codegen
into the SDK and adopts the provenance convention decided at review. **Referee: perfect-map's
generated `src/generated/patches.hpp` is byte-identical before/after.**

## Context

Perfect-map's `gen/generate.ts` is a pure catalogue→header renderer plus a hard-error validator;
its interfaces (`ByteAnchor`, `FileAnchor`, `Fingerprint`, `CatalogueEntry`) and the `FINGERPRINT`
constant (the canonical exe identity) are plugin-agnostic — the city-life roadmap plan already
declares it will reuse the fingerprint verbatim. Only the `CATALOGUE` array (addresses, bytes,
strategies) is perfect-map's own. The emitted namespace is currently hard-coded (`pm::gen`); it
becomes a parameter so the header stays byte-identical for perfect-map while a future plugin gets
its own.

## Decisions

1. **SDK layout:** `asi/sdk/gen/` — `catalogue.ts` (the interfaces), `render.ts`
   (`renderHeader(catalogue, {namespace})` + `validate()`), `sa-fingerprint.ts`
   (`SA_FINGERPRINT`). Co-located tests.
2. **The generator stays plugin-invoked:** each plugin keeps a thin `gen/generate.ts` that imports
   the SDK library, passes its catalogue, namespace and output path. No SDK CLI — a library, like
   the C++ half.
3. **Provenance convention (review verdict):** `CatalogueEntry` gains a required `provenance`
   field — the gta-reversed-modern file/function the entry was derived from and the commit
   consulted at RE time. The four existing entries record their file/function (known from
   `docs/patch-catalogue.md`) with the commit honestly marked unrecorded (pre-SDK RE, 2026-07);
   the convention binds new entries. Navigation, not correctness — the exe-side byte verify
   remains the referee.
4. **Validator scope unchanged:** the SA address range (`0x400000..0x2000000`) is SA ground truth
   and stays; this is an SA-scoped SDK.
5. **Test split:** synthetic-fixture validation/render tests move to the SDK; "renders the real
   catalogue" and the fingerprint-value assertions stay perfect-map's.

## Tasks

- [ ] `asi/sdk/gen/` per decision 1, moved (not copied) from perfect-map; perfect-map's
      `gen/catalogue.ts` keeps `CATALOGUE` and imports the interfaces + `SA_FINGERPRINT`;
      its `gen/generate.ts` becomes the thin invoker (decision 2).
- [ ] Provenance field + the four entries filled (decision 3);
      `asi/perfect-map/docs/patch-catalogue.md`'s provenance section points at the typed field as
      the machine home.
- [ ] Test split (decision 5); suite green.
- [ ] Referee: regenerate → `git diff --stat asi/perfect-map/src/generated` empty /
      byte-compare the emitted header against 001's tree.

## Verification

`npm run gen -w @opensa/perfect-map-asi` emits a byte-identical `patches.hpp`; full suite + tsc +
`eslint .` green; the SDK has no import from `asi/perfect-map` (dependency direction holds).

## Measurements / notes

*(ledger: header byte-compare result, test counts moved vs kept)*
