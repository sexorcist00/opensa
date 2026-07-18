# Open issues

Resolved issues move to [fixed/](fixed/) with their full forensic history preserved.

Known unsolved problems that have been investigated but **deliberately shelved** — no shipped fix
yet. Each file records the symptom, the root cause we found, the approaches we tried (and why each
fell short), and pointers for whoever picks it up later. Same spirit as `docs/features/*`, but for
problems rather than implemented features.

These are NOT plans (`docs/plans/*` are for work we intend to do soon) and NOT features
(`docs/features/*` are for things that work). When an open issue gets a real fix, promote it to a
plan/feature and delete the entry here.

| Issue                                                              | Doc                                                        | Status                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alpha cutout black edge (foliage/fences)                           | [fixed/alpha-edge.md](fixed/alpha-edge.md)                 | ✅ FIXED by construction in the own-engine texture pipeline (074/03: premultiplied offline mips + dilation + A2C); field-confirmed 2026-07-11                                                                             |
| "Locked" (anti-rip protected) DFF/TXD models                       | [locked-dff.md](locked-dff.md)                             | 🟡 mostly solved — 4 known lock variants recover (inflated item/struct sizes + hidden TexDictionary wrapper); remaining: uncovered lock cases in the wild, to finish later                                                |
| Crash entering a freshly-spawned car (`readBody` null body)        | [vehicle-enter-null-body.md](vehicle-enter-null-body.md)   | shelved — narrowed to a streaming/physics handle-pool race (teleport-triggered); needs a runtime trace to pin                                                                                                             |
| "Ghost barriers" — mass map instances corrupt real SA              | [fixed/ghost-barriers.md](fixed/ghost-barriers.md)         | ✅ ROOT-FIXED by our `perfect-map.asi` (2026-07-09): the int16 `IplDef` ceiling is LIFTED via sidecar hooks — any object count works                                                                                      |
| 2dfx particle emitters on generated LODs (new-game crash)          | [fixed/lod-2dfx-particles.md](fixed/lod-2dfx-particles.md) | ✅ crash ROOT-FIXED in-engine by `perfect-map.asi` (2026-07-09, plans 008/009: null-`m_SystemBP` guard); particles KEPT on LODs by default, confirmed in-game                                                             |
| Own engine: short-fog NIGHT renders pure black (rain/fog weathers) | [engine-night-sky-black.md](engine-night-sky-black.md)     | investigated 2026-07-18 — the authored night gradient is correct up to the sky LUT (0.0414 linear) and arrives ~0 on screen; loss is in the sky pass / its uniform feed. Repro: `?spawn=1456,-1400,30&hour=21&weather=16` |
