# phone-console 001 — a panel for the phone the work is done on

Opened 2026-08-23, on the user's call: phone testing is becoming the normal case, and every ritual it needs
is typed into a terminal on the device being tested.

## Why, in one paragraph

`scripts/phone.sh` already automates the run itself. What it has no answer for is the two failures around it.
**A run that does not start** fails for a reason at the bottom of a log, on a screen with no scrollback worth
the name — and the causes repeat (a pull added dependencies, `tsx` is missing, a port is held, `GAME` and
`OUT` resolve to one folder, shared storage is full while internal is not). **A run that does finish**
produces a number that has to survive the trip to the next session, and today it travels as a chat paste with
its conditions missing — which is exactly what [`docs/benchmarks/readme.md`](../../../../docs/benchmarks/readme.md)
opens by warning about, and what `CLAUDE.md` requires be committed before it is analysed.

## The decisions, taken with the user 2026-08-23

| Decision | What it rules in | What it rules out |
| --- | --- | --- |
| **A PWA panel, not a native app** | a page served from Termux with a manifest, installed to the home screen | an APK: a JDK + Gradle + SDK toolchain on a device with no PC, signing on every update, and `RUN_COMMAND` intents — for an icon and nothing else |
| **No agent connects to the phone** | the panel commits and pushes; the next session reads the branch | a public tunnel to a page that runs commands, which is a shell on the internet |
| **Zero dependencies, plain `.mjs`** | it boots on `node` alone, which is what lets it report a tree too broken to run TypeScript | a workspace, a build step, or a panel that needs `tsx` to say `tsx` is missing |
| **It runs the existing rituals** | `phone.sh`, `phone-setup.sh`, `district.ts`, `git pull --ff-only` | a second implementation of the convert, which would be a second thing to keep true |
| **It files data, never code** | commits under `docs/benchmarks/opensa-engine/` only, naming the paths on the commit | a panel that can sweep a dirty worktree into a commit from a phone |
| **127.0.0.1 by default** | `PANEL_HOST=0.0.0.0` as an explicit opt-in with a warning line | a command runner on the LAN by default |

## Steps

### 01 — Preflight, the rituals and the capture inbox

**DONE 2026-08-23.** The first slice, chosen by the user: the doctor and the run buttons, plus the capture
inbox and its commit — the two halves that pay for themselves immediately.

- **Preflight** (`doctor.mjs`): node · dependency STALENESS against `package-lock.json` (existence alone once
  reported a healthy tree that died minutes later inside the stage needing the new dependency) · `tsx` ·
  **`sirv`** · the game files · **GAME vs OUT resolving to one folder** · the pak and its recipe · the two
  run ports · free space on both filesystems · branch and behind-count · the wake lock. Each with what to do
  about it, rolled into one verdict line.
- **The rituals** (`jobs.mjs`): `git pull --ff-only`, `phone:setup`, `phone` with its knobs, `district.ts`.
  One at a time, refusal naming what is running; env is whitelisted per job and a dropped knob is REPORTED
  (a shell script ignores an env var it does not read, silently). Jobs run in their own process group, so
  stopping one reaches vite, the static server and the convert rather than orphaning a held port.
- **The log**: server-sent events with a 400-line ring buffer, so a phone that slept and reconnected sees
  what happened instead of an empty box.
- **The capture inbox** (`captures.mjs` + `capture-store.mjs`): the JSON is filed under the family's own
  naming rule with the provable conditions stamped into its note; a note under 12 characters is refused; the
  commit names only the paths the panel wrote and only under `docs/benchmarks/opensa-engine/`, with
  `HUSKY=0` because `--omit=dev` leaves the phone no hooks to run. A `tiles.pmtiles` is checked for the
  format's magic before it is written beside the pak.

**Verified 2026-08-23** in the container, end to end: 33 unit tests over the pure halves; the server serving
the page and the manifest; `/api/state` answering with real checks (including the districts read out of the
console's own table); a job started, streamed and finished; a capture refused for a thin note and then filed
with its note stamped; a commit refused for naming a source file; a tile upload refused for an HTML body and
accepted for a real header; and a `../../etc` output path refused as outside the repository.

**Owed:** the first run on the phone itself — the doctor's own verdict there is the measurement this step is
judged on.

### 02 — The console posts its own captures

Today the operator copies JSON and pastes it into the panel. `?inventory=1` could POST it to the panel
directly (`&post=http://localhost:8787/api/capture`), which removes the last manual step of a field run.
Small, and deliberately not in slice 1: it touches the app.

### 03 — The panel serves the pak itself

`scripts/serve-static.ts` imports `sirv`, a devDependency reachable only through the dev tree that
`phone:setup` deliberately omits (`@vitest/browser` is its only other route). On a device set up strictly by
the documented path, the static server therefore cannot start — and it is the server that hands out the pak,
so the symptom is a map that loads nothing. Slice 1 makes the doctor SAY so; the fix is either moving `sirv`
into `dependencies` or serving `build/` from the panel with Range, CORS and `__index`, which are the three
things the loader needs. **Trigger:** the doctor reporting `sirv` missing on a real device.

### 04 — A read-only window for an agent

Ruled out for now as a tunnel (a public URL to a command runner). If it comes back it is read-only, token
gated, off by default, and time-boxed — and even then the repository stays the handoff, because a session
that reads a log it cannot cite has learned nothing the next session can use.

## Status

| Step | State |
| --- | --- |
| 01 preflight + rituals + capture inbox | **DONE 2026-08-23** — verified in the container end to end (33 tests, every guard exercised). Owed: the first run on the phone |
| 02 the console posts its own captures | not started |
| 03 the panel serves the pak itself | not started — gated on the doctor reporting `sirv` missing on a real device |
| 04 a read-only window for an agent | ruled out 2026-08-23 |
