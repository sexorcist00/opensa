# Open issues

Known unsolved problems that have been investigated but **deliberately shelved** — no shipped fix
yet. Each file records the symptom, the root cause we found, the approaches we tried (and why each
fell short), and pointers for whoever picks it up later. Same spirit as `docs/features/*`, but for
problems rather than implemented features.

These are NOT plans (`docs/plans/*` are for work we intend to do soon) and NOT features
(`docs/features/*` are for things that work). When an open issue gets a real fix, promote it to a
plan/feature and delete the entry here.

| Issue                                                       | Doc                                                      | Status                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alpha cutout black edge (foliage/fences)                    | [alpha-edge.md](alpha-edge.md)                           | shelved — best partial fixes leave a residual artifact                                                                                                                                                                                                                                                   |
| "Locked" (anti-rip protected) DFF/TXD models                | [locked-dff.md](locked-dff.md)                           | 🟡 mostly solved — 4 known lock variants recover (inflated item/struct sizes + hidden TexDictionary wrapper); remaining: uncovered lock cases in the wild, to finish later                                                                                                                               |
| Crash entering a freshly-spawned car (`readBody` null body) | [vehicle-enter-null-body.md](vehicle-enter-null-body.md) | shelved — narrowed to a streaming/physics handle-pool race (teleport-triggered); needs a runtime trace to pin                                                                                                                                                                                            |
| "Ghost barriers" — mass map instances corrupt real SA       | [ghost-barriers.md](ghost-barriers.md)                   | 🟡 solved by budgets, not at the root — int16 building-pool indexes in `IplDef` (≤ 32,767 permanent text rows) + 3 more unbounded structures; binary-stream placement + build guards keep us under the ceiling; remaining: a 100 % fix that LIFTS the limit (own engine patch) so any object count works |
| 2dfx particle emitters on generated LODs (new-game crash)   | [lod-2dfx-particles.md](lod-2dfx-particles.md)           | 🟡 solved by stripping — LOD clones carried particle 2dfx; emitters don't unload → pool exhaustion → new-game crash + far smoke overdraw; particles stripped from every LOD, coronas kept; also fixed in Proper Fixes (likely ProperFixes.asi); remaining: make particles actually WORK at LOD range     |
