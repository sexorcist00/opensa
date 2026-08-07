# rw-codec/01 — Typed 2dfx payload codecs

Part of [07 — LOD generators, extended](../readme.md). **Gated on nothing.** Split out of the old A2/A3 so
the codec ships and is proven on its own, before anything transforms a payload with it.

Today `@opensa/rw-codec/dff` treats every 2dfx entry as opaque bytes: `extract2dfxEntries` /
`build2dfxSection` preserve any type verbatim and `build2dfxSection` rewrites only the first 12 bytes (the
position). That is enough to MOVE an entry and not enough to ROTATE one, which is why baked cells drop every
rotation-bearing type. This plan adds the missing typed layer and nothing else.

## Scope

Three payloads, chosen because they are the ones a LOD wants to carry and the runtime parser already knows
how to read (`packages/renderware/src/parsers/binary/dff.ts` decodes all of them — the field layouts are not
research, they are a port):

| Type | Payload | Why it needs decoding |
| --- | --- | --- |
| **7 — roadsign** | plate size, **rotation**, flags, 4×16 chars of text | orientation is in the payload; a position-only transplant leaves the plate facing the wrong way |
| **10 — escalator** | bottom / top / end **vec3s**, direction | the geometry IS three points; moving the entry without moving them is meaningless |
| **1 — particle** | `effects.fxp` system name (24 bytes) + parameters | needed by [lod-common/03](../lod-common/03-emitter-thinning.md) only if rate-scaling turns out to need a payload edit — decode it here, decide there |

Everything else stays opaque and byte-verbatim. Do not build codecs for types nobody sees at LOD range.

## Decisions

1. **Decode / encode, not parse / render.** The deliverable is a symmetric pair per type in `rw-codec`,
   beside `build2dfxSection` — no transform logic, no policy, no LOD awareness. Those live in
   [lod-common](../lod-common/02-2dfx-entry-transform.md); keeping them out of the codec is what lets the
   round-trip test be an identity.
2. **Byte-identity is the contract.** `encode(decode(entry)) === entry` for every real entry we can find, not
   just for synthetic ones. This is the guard that says the decode did not quietly lose a field, and it is
   the reason this is its own plan: once a caller starts transforming payloads, an asymmetric codec becomes
   invisible corruption in a DFF nobody reads by hand.
3. **Real fixtures, not synthetic.** Per
   [`restrictions`](../../../../../restrictions/assets-and-data.md) and the project's fixture convention, the
   subjects are real stock models carrying real entries — a street-name roadsign, a mall escalator, a
   refinery smokestack. One `MANIFEST` line each in `scripts/test-fixtures.ts`.
4. **Field-width honesty.** Where the runtime parser reads a field the writer cannot reproduce (padding,
   reserved bytes, a length we infer), the codec keeps the original bytes for that span rather than
   re-deriving them. Record any such span — it is the seam where a future edit will go wrong.

## Tasks

- [ ] Port the roadsign(7) field layout from the runtime parser into a `rw-codec` decode/encode pair.
- [ ] Same for escalator(10) and particle(1).
- [ ] Round-trip identity tests over real fixture entries (all three types) — assert byte-for-byte equality of
      the re-encoded entry, and of the whole rebuilt 2dfx section.
- [ ] A negative test per type: a truncated / short entry is rejected loudly rather than decoded into
      garbage (these bytes come from a FILE, and a file is untrusted input even when our own tool wrote it).
- [ ] Enumerate, across the stock corpus, how many entries of each type exist and in how many models — the
      denominator every later "we carried N of M" claim needs.

## Verification

- `encode(decode(e)) === e` byte-for-byte on every type-7/10/1 entry in the fixture set.
- A rebuilt 2dfx section containing untouched entries of ALL types (including undecoded ones) is identical to
  the source section.
- No consumer changed: nothing outside `rw-codec` imports the new codecs yet, so no generator output moves.

## Measurements / notes

_(record after implementation)_

- stock corpus census — entries and models per type (7 / 10 / 1): …
- spans kept verbatim rather than re-derived, per type: …
