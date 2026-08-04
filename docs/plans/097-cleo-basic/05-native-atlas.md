# 097/05 — The native atlas: memory & native calls as an object-capability facade

The subsystem the recon promoted from "future seam" to load-bearing: **5 of the 7 corpus mods read game
memory or call exe functions by address.** The honest design is NOT byte-level emulation — the corpus's
entire native surface is ~15 well-known SA 1.0 US addresses/offsets. "Memory" becomes a declarative
atlas mapping that address space onto engine operations. Field checkpoint 2 closes it: **the fire
ladder rises, the van door slides, the tank tracks roll.**

## The observed surface (the whole of it — from the 2026-08-04 disassembly)

| Kind | Address / offset | Meaning (gta-reversed name) | Used by |
| --- | --- | --- | --- |
| fn | `0x4C5400` | `CClumpModelInfo::GetFrameFromName(clump, name)` | firela, van door |
| method | `0x59AFA0` | `CMatrix::SetRotateXOnly(angle)` | firela, van door |
| method | `0x59AFE0` | `CMatrix::SetRotateYOnly(angle)` | firela, van door |
| method | `0x59B020` | `CMatrix::SetRotateZOnly(angle)` | firela, van door |
| method | `0x59B120` | 3-arg matrix method (translate/rotate — confirm in gta-reversed) | rhino |
| global | `0xB74494` | `CPools::ms_pVehiclePool` (pool walk) | rhino |
| global | `0xC812F0` | CWeather block (wind strength) | wind farm |
| global | `0xB6F118` | to be named from gta-reversed before serving | wind farm |
| offset | `CEntity+0x18` | `m_pRwObject` (the clump) | firela, van door |
| offset | `RwFrame+0x10` | the modelling `CMatrix` | all class B |
| offset | `CMatrix+0x30/34/38` | pos.x/y/z (frame+64/68 in the scripts) | van door, rhino |
| opcode | `095F` | GET_DOOR_ANGLE_RATIO (honest opcode, no memory) | van door |
| opcode | `0A97/0AEB` | vehicle handle → "pointer" | all class B |
| opcode | `0A8C/0A8D/0A8E` | WRITE/READ_MEMORY, INT_ADD (pointer arithmetic) | all class B + wind farm |

Every entry's meaning is recovered from the reversed source (`docs/links.md` → gta-reversed) — the
recover-the-real-formula rule. No fitted constants: an offset we cannot name does not get served.

## Decisions

1. **Pointers are opaque tokens.** `GET_VEHICLE_POINTER` returns not a number but a token
   `(domain: vehicle, handle, offset: 0)` (encoded so it survives storage in a 32-bit script var —
   a tagged index into a token table). `INT_ADD/SUB` on a token derives `(same base, offset±n)`.
   Arithmetic between two tokens, or on a raw int that is not a known global address, follows the
   unimplemented tier — observably.
2. **The atlas is data.** One table, pinned to the ONE canonical 1.0 US exe (the perfect-map
   doctrine — 14 383 616 B): absolute addresses (functions, globals) and per-struct offset maps, each
   entry naming its gta-reversed symbol and mapping to a host operation. Adding an entry is adding a
   ROW (+ its handler if a new capability is needed), never touching the VM.
3. **Resolution paths**:
   - `READ_MEMORY(token)` → struct-offset map of the token's domain → engine query
     (`CVehicle+0x18` → a clump token for that vehicle; matrix field reads → current part pose).
   - `READ_MEMORY(absolute int)` → globals table (`0xC812F0` → the weather system's wind value;
     pool globals → the pool facade below).
   - `WRITE_MEMORY(token)` → engine mutation (matrix pos writes → `setPartTranslation` on the part
     behind the frame token).
   - `CALL_FUNCTION/METHOD(address)` → functions table (`GetFrameFromName(clumpToken, name)` →
     `VehicleHandle.partIndex(name)` → a frame token; `SetRotate*Only(angle)` on a matrix token →
     `setPartRotation` with the axis quat — SA's matrix convention mapped once, tested against the
     door-hinge conventions from the comet work).
4. **Frame tokens ride the vehicle part registry.** The comet chain made parts first-class
   (`VehicleHandle.partIndex/setPartRotation/setPartTranslation`, doors as hinge subtrees). A frame
   token = (vehicle handle, part index). `misc_a/misc_b/misc_c`, `dvan_l/dvan_r` resolve exactly like
   door parts. A name the model lacks → null token; subsequent ops no-op with a once-log (matches real
   CLEO's null-deref crash being the mod's bug, ours degrades instead).
5. **The pool facade.** Rhino walks `CPools::ms_pVehiclePool` (objects array + slot map + size).
   Serve it as a virtual pool over the live vehicle registry: the atlas answers the exact reads the
   walk performs (array base, slot byte, entry stride) with token-yielding results. Scoped to what
   rhino's loop actually reads — recorded in the plan, extended by data later.
6. **Semantics stay SA's; execution stays ours.** The atlas encodes what the DATA (addresses) MEANT;
   the implementation is `VehicleHandle`/engine calls. No 2004 code is ported (project-goals split).
7. **`GET_DOOR_ANGLE_RATIO 095F`** — honest opcode on the vehicle facet: current door openness
   0..1 from the vehicle's door state (the enter/exit animator owns door angles; expose a read
   accessor — the "read derived numbers through an accessor the owning system publishes" restriction).
8. **Unknown address/offset/method → ONE observable path**: once-log with the raw address, tier
   policy (plan 07), and a row in the coverage report. Never a silent wrong read: an unserved READ
   returns 0 **and marks the thread's coverage entry** so the field symptom ("ladder doesn't move")
   has a named cause in F2.

## Subtasks

- [ ] Token model + INT_ADD/SUB derivation + storage-in-var round-trip tests.
- [ ] Atlas table format (functions/globals/struct offsets, each row: address, symbol name, handler
      ref) + the ~15 corpus entries; name `0xB6F118` and `0x59B120` from gta-reversed first.
- [ ] READ/WRITE/CALL resolution through the atlas + unit tests per row (mock host).
- [ ] Frame tokens on the part registry + matrix-op mapping (+ conversion tests against the comet
      door conventions — axis/sign fixtures).
- [ ] Wind global → weather system read (Wind Farm's sway now wind-driven — its class-A behaviour
      completes here).
- [ ] Pool facade scoped to rhino's walk + tests.
- [ ] Door-angle accessor + `095F`.
- [ ] `cleo-run --atlas` (plan 02 extension): headless trace shows resolved symbol names, not raw
      addresses ("GetFrameFromName('misc_a') → part 7").
- [ ] Headless integration: firela + van door decoded scripts drive the expected part
      rotations/translations on a fake vehicle; rhino's walk finds the fake pool's rhinos.
- [ ] **Field checkpoint 2**: firela/newsvan/rhino installed as vehicle mods (vehicle-installer) +
      scripts hand-placed; ladder rises on the parked firela, van door slides open with the door,
      rhino tracks animate while driving. Judged from the reporter's angle rule: each mod's OWN
      visible behaviour, on video/screenshots, into the ledger. Per-frame cost of rhino's math
      measured through the frame-span ledger.

## Verification

- Every corpus native instruction resolves through the atlas in headless runs (zero unknown-address
  logs on the corpus).
- Axis/sign fixtures: SetRotateXOnly(π/4) on a known part matches the expected engine quat.
- Field checkpoint 2 accepted; rhino per-frame cost recorded against the plan 03 budget.

## Ledger

_(atlas rows landed, symbol names for the two unresolved addresses, axis-mapping fixtures, rhino cost,
field checkpoint 2 record)_
