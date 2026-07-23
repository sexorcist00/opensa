# fetch-pack

The plan-086 finishing tool: pack a pmb build's `opensa/` game dir into the fetch loader's
content-hashed zip chunks + `manifest.json` under `static/games/<game>-<version>/`. One build serves
both surfaces — local play reads `build/<id>/opensa` directly (http-dir / folder mode), hosted fetch
downloads these chunks of the SAME bytes.

```bash
npm run fetch:pack                # defaults: --build ./build/original --out ./static/games
npx tsx tools/fetch-pack/src/cli.ts --build ./build/gostown
```

Identity comes from the pak manifest (`game` + `appVersion`, plan 086 phase 1); a pre-086 pak falls
back to the build folder name + the root package.json version, loudly.

Architecture, group mapping and the slicing scheme: [docs/plans/001-architecture.md](docs/plans/001-architecture.md).
