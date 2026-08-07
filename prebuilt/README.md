# Prebuilt app (`opensa-webapp.tar.gz`)

A built copy of the web app, committed on purpose. It is here for **one** case: a device that can run the
converter but cannot run vite.

That case is real and measured — on an Android 10 / arm64 phone, rolldown's native binding is killed by SIGILL
the moment it loads, and no wasm fallback is reachable, so neither `vite` nor `vite build` works there
([edge-cases/browser-runtime.md](../docs/edge-cases/browser-runtime.md)). The converter and the static server
are untouched by it (tsx/esbuild run fine), so the only missing piece is the app itself — and an app is just
static files.

## Use it

```bash
mkdir -p build/webapp && tar -xzf prebuilt/opensa-webapp.tar.gz -C build/webapp
npm run phone      # sees build/webapp/index.html and skips vite entirely
```

`phone.sh` then serves the app and the pak from the SAME static origin, so there is no CORS, no second port
and no dev server.

## Rebuild it

**Anywhere except the phone.** `npm run build` is `tsc -b && vite build`, so refreshing this archive on the
device it exists for is a contradiction: vite is the thing that cannot run there. It looks like a hang rather
than an error — `tsc -b` over the monorepo grinds for minutes on phone-scale RAM, and rolldown's SIGILL kills
the process without printing a line. Build it on a machine that can, commit the archive, and let the phone
`git pull`.

```bash
npm run build -- --base=./
tar -czf prebuilt/opensa-webapp.tar.gz -C dist .
```

**`--base=./` is not optional**: without it the asset paths are absolute (`/assets/…`) and every one of them
404s when the app is served from a subfolder.

## What this costs, and when to delete it

A binary in git is permanent — every refresh adds another ~1.4 MB to the history that no later commit can
remove. So it is refreshed **rarely and deliberately** (a phone run needs the app's behaviour, not the newest
commit), and it is stale by nature: it does not follow the source. If a device that cannot run vite stops
being a target, delete the folder and this file with it — nothing in the build or the test lanes reads them.
