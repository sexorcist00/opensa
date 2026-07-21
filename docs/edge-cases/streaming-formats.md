# Native-format & streaming invariants

Versioning rules and the memory model of the `.ospak` streaming path (plans 074/02, 074/05).

- **Unknown major versions are rejected loudly**; minors only add optional sections. The v0 layouts were
  explicitly throwaway — don't try to read them.
- **Mip chains must be complete in-file** — the runtime never generates mips. Odd (non-pow2) textures are
  resampled offline, which also dodges WebGPU's BC block-alignment constraint.
- **Pak bytes never live whole in JS.** The pak worker range-reads (HTTP Range or Blob slices); JS heap
  target < 500 MB and flat. Teleport hops can queue ~257 MB transient (mitigated by stale-blob pruning +
  an in-flight cap).
- **Vite's dev server doesn't guarantee HTTP Range** for the whole-map pak — auto-detected, falls back to
  whole-pak mode. `scripts/serve-static.ts` serves Range correctly.
- **≤ 1 cell create per frame**; eviction only outside the outer ring; the old LOD level stays until its
  replacement is resident (atomic swap).
- **The placement mapper is parsed only under `debugPicking`** — a full map's mapper runs to tens of MB
  against a ~21 MB steady heap; F2 Map pick/name/hide costs that memory.
- **The http-dir dev loader buffers the world as a Blob** (~332 MB at boot) — fine for dev; the lab keeps
  URL streaming. A follow-up may move it to URL streaming.
- **VER1 IMG (GTA3/VC dir+img) is unsupported** — SA-only VER2.
- **Asset caches have no eviction** — bounded by archive content, not by an LRU (vehicle model textures do
  have an LRU).
