# Developing on a phone (Termux)

**The development machine for this project is an Android phone running Termux.** Not a preference — the
working setup. Recorded 2026-08-06 so that instructions, scripts and plan steps are written for it instead of
for a desktop that is not there.

The user **has the game files and can build paks**, so nothing here is blocked on assets. What is different
is the machine.

## What changes

| Assumption a desktop makes | What is true here |
| --- | --- |
| `sudo`, `apt` | neither — `pkg install <x>`, everything runs as the single Termux user |
| stable paths (`/usr`, `/tmp`) | `$PREFIX` (`/data/data/com.termux/files/usr`); `$TMPDIR` is inside it |
| a long command keeps running | Android suspends the process — hold it with `termux-wake-lock` |
| files are just there | shared storage needs `termux-setup-storage` once |
| RAM is not a variable | it is the binding constraint on every build |
| a headless browser exists | **Playwright/Chromium headless is effectively unavailable** |

## The two that actually bite

**The build scripts ask for a 12 GB heap.** Every `build:game:*` script in `package.json` carries
`NODE_OPTIONS=--max-old-space-size=12288`. That is a desktop number and no phone will honour it. If a pak
build runs on the device, the flag has to come down to what the phone has and the build has to be sized to
fit — a district rather than the whole state is the obvious lever, and it is the same district
[201/1-01](../plans/201-dispatch-console/1-the-map-profile/readme.md) pins for measurement anyway.

**There is no headless capture path.** Much of `scripts/debug/` and all of `e2e/` drive a browser through
Playwright. Here the equivalent is: run `npm run dev` in Termux and open the page in the phone's own browser
(`http://localhost:5173/…`). That covers anything a human can read off the screen, and does not cover
scripted input or an automated screenshot diff. A step that owes a scripted check has to say so and find
another way rather than assume `npx playwright` will run.

## What this does to the measurement plan

[201](../plans/201-dispatch-console/readme.md) is written as *desktop baseline first, phone second* — chain 1
takes its before/after on a desktop and chain 2 re-takes it on a phone. **With no desktop, that ordering does
not hold as written.** Two honest ways out, and the chain says which it took rather than quietly producing
one column:

1. **The phone is the baseline.** Everything is measured on the one machine there is. The numbers stop being
   comparable to the repo's existing desktop rows — which the mobile benchmark schema
   ([200/1-02](../plans/200-platform-reach/1-device-truth/readme.md)) already declares as a rule — and in
   exchange every number is taken on the device the product actually targets.
2. **A desktop is borrowed** for the baseline only, and the phone rows stay the ones that decide anything.

Option 1 is the more honest default here: the console's whole point is that it runs on a phone, and a
baseline taken somewhere the product will never run is a baseline that flatters it.

## Practical notes

- **The whole setup is `pkg install nodejs-lts git` and then `npm run phone:setup`** — once per device. A
  plain `npm install` is NOT the normal path here: the full tree pulls 1171 packages whose prebuilt binaries
  are `linux-x64-gnu`, and it is the step most likely to fail on arm64. Setup passes `--omit=dev` (173
  packages, none of which the convert path touches) and `HUSKY=0`, and it is idempotent, so re-running it
  after a failure or a reboot repeats nothing. Then `npm run phone` for every run
  ([mobile-pak.md](./mobile-pak.md)).
- `termux-wake-lock` before a build, `termux-wake-unlock` after — without it a long pak build dies when the
  screen sleeps. `npm run phone:setup` takes the lock when Termux offers one, so a convert started right
  after it is already covered.
- The dev server binds fine; reach it from the phone's browser at `localhost`, and from another device on the
  same network with `npm run dev -- --host`.
- Storage: the built game lives under `build/<game>/opensa`, and a field run reads that and nothing else
  ([restrictions/architecture.md](../restrictions/architecture.md)). Keep it on internal storage — shared
  storage via `termux-setup-storage` is slower and has different permission behaviour.
