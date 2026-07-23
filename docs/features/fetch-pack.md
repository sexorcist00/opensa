# fetch-pack — one build for local play AND hosted fetch

**State (2026-07-23): tool SHIPPED (plan 086 phase 2); the fetch CLIENT still boots the legacy
raw-game path — phase 3 switches it to the pak (until then the chunks are produced but not consumed
end-to-end).**

`tools/fetch-pack` packs a pmb build's `opensa/` game dir into content-hashed zip chunks +
`manifest.json` under `static/games/<game>-<version>/` — the same layout the `asset-fetch-loader`
already downloads/caches. Identity (`game`, `appVersion`) rides the pak manifest (086 phase 1).
`npm run fetch:pack`; per-game aliases build with pmb first (`npm run build:game:<id>`).

Replaced: `scripts/build-game.ts` (raw-game partitioning) — deleted; `original-extend` npm target —
deleted. Details: `tools/fetch-pack/docs/plans/001-architecture.md`.
