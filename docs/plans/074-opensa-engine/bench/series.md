# Bench series (append-only; the 074/11 ritual)

Compare line (prod, three-WebGL, same hardware): ls-noon ≈ **65 ms CPU / ~31 ms GPU / 14 454 draws**.

| Date       | Commit | Scene                      | frame                                 | submit   | GPU                 | draws             | residency                              | Note                                                                                                 |
| ---------- | ------ | -------------------------- | ------------------------------------- | -------- | ------------------- | ----------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 2026-07-11 | (M0)   | synthetic 12×12            | 8.33 ms (vsync)                       | 0.10 ms  | 1.44 ms             | 528               | 224 MB                                 | first light                                                                                          |
| 2026-07-11 | (M0)   | ls-bench (40 entries)      | 8.34 ms (vsync)                       | 0.20 ms  | 1.84 ms             | 807               | 294 MB                                 | real district; alpha halo dead (user-confirmed)                                                      |
| 2026-07-12 | (M1)   | drive (stream, worker pak) | avg 8.33 / p95 9.30 / **max 9.80 ms** | p95 0.30 | p95 1.77 / max 4.19 | avg 293 / max 400 | 288 MB GPU / **8 MB main-thread heap** | 42 cells created mid-drive, worst create 1.1 ms, 0 dropped frames — streaming invisible to the frame |
