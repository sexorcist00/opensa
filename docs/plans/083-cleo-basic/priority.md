# 083 — execution priority

Linear 01 → 05, with one spike pulled forward:

| Order | Plan                         | Why                                                                                                                                                                                                                                                                     |
| ----- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | **03's phase-0 spike**       | Load ONE map-object `.osm` by name at runtime and render it — the only genuinely uncertain engine question in the chain (the VFS-subset gotcha). One day of work; a negative answer reshapes plan 03 before 01/02 are even started, a positive one de-risks everything. |
| 1     | **01 Decoding**              | Pure, fixture-driven; produces the opcode whitelist that scopes 02/03 exactly. Also requires re-sourcing the two target `.cs` (NO_COMMIT was cleaned) — start that fetch first, it's on the user.                                                                       |
| 2     | **02 VM**                    | Engine-agnostic, fully headless — can be built and tested to completion with a mock host before any engine wiring exists.                                                                                                                                               |
| 3     | **03 Host bridge**           | Consumes 01's whitelist + 02's `CleoHost` shape + the spike's verdict.                                                                                                                                                                                                  |
| 4     | **04 Packaging + wiring**    | The ship plan — both mods run in the browser. First (and main) field checkpoint.                                                                                                                                                                                        |
| 5     | **05 Extensibility + debug** | Needs a running module to instrument; converts "it works" into "it's maintainable and growable".                                                                                                                                                                        |

Checkpoints: headless suites per plan (01/02 need no browser at all); ONE field session at 04
(binary outcome: the wheel spins or it doesn't) + the real-game behaviour comparison; 05 closes
with the coverage report green in CI.

Interplay: independent of 080/081/082. Shares the vehicle-model worker path with 082/03's atlas
work only at the level of "don't refactor it under each other simultaneously" — sequence those two
plans apart if both chains run in the same period.
