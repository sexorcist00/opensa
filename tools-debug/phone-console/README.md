# phone-console

**The field-run panel for the phone the work is done on.** One page, served from Termux, that runs the
rituals `scripts/phone.sh` already knows, says why a run will not start before it is started, and files what
the run measures straight into `docs/benchmarks/`.

```bash
npm run panel          # → http://localhost:8787
```

Open that on the phone and add it to the home screen — it carries a manifest, so Android installs it as an
app and it opens full-screen. Nothing else has to be typed after that.

## Why it exists

The development machine is a phone ([termux.md](../../docs/development/termux.md)). Every number 201 still
owes is gated on a ritual typed into a terminal with no keyboard worth the name, and two things went wrong
there over and over: a run that did not start for a reason buried in a log, and a measurement that reached
the next session as a chat paste with its conditions missing — the case
[`docs/benchmarks/readme.md`](../../docs/benchmarks/readme.md) opens by warning about.

So the panel does exactly two jobs: **make a run one tap**, and **make its result a committed file**.

## What it is made of

| File                | What it does                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `server.mjs`        | the HTTP server: the page, the state endpoint, the log stream, the job routes, the capture inbox |
| `doctor.mjs`        | the preflight checks, as pure decisions over an injected probe                                   |
| `jobs.mjs`          | which commands may run, which env each accepts, and the one-at-a-time rule                       |
| `captures.mjs`      | the naming, the note stamping and the commit plan — pure, and the tested half                    |
| `capture-store.mjs` | the filesystem half: where a capture and a tile archive may land                                 |
| `app/`              | the page, its manifest, a pass-through service worker and the icon                               |

**Plain `.mjs`, no dependencies, no build step — deliberately.** This is the thing that must come up when the
tree is broken, since its first job is to report that `node_modules` is stale or `tsx` is missing. A panel
that needed either to boot could not say so. Same reasoning as [`bench-harness`](../bench-harness), which is
plain node scripts for the same class of reason.

## What it runs

Nothing of its own: `git pull --ff-only`, `npm run phone:setup`, `npm run phone` (with the knobs the page
offers — district, output folder, texture format, whether models are converted) and `scripts/district.ts`.
`scripts/phone.sh` is 369 lines of measured knowledge about this device, and a second copy of it inside a web
server would be a second thing to keep true.

**`Map only` is the same ritual with the model half taken out**, because "just the ground" is the run that is
wanted most and the one nobody remembers how to ask for. It forces `MODELS=0` (no vehicles, no peds, no model
archives rewritten — the pak the map reads contains none of them) and `BAKE=0` (with no models there is
nothing to run physics, so the collision bake is work whose product this run cannot reach), and the page
cannot buy either back: the forced values are applied last, after the form.

It also converts into its **own** folder — the one in the field with `-map` appended, and the field follows
along so the links below open the right pak. That is not tidiness either: `phone.sh` checks an existing pak
against the recipe it was asked for and refuses when they differ, so a map-only run pointed at a full pak's
folder would serve nothing, and forcing a rebuild instead would throw the full pak away on every press.

**One job at a time**, and the refusal names what is running. Two converts at once on a phone is an OOM and
two paks welded into one folder.

## What it checks before you start

`node` · **git identity** (a phone that has only ever pulled has none, and every commit then dies with
_"Author identity unknown"_ — which git says only when one is attempted) · dependency **staleness** (a pull that added deps, the rule `phone-setup.sh` learned the hard way) ·
`tsx` · **`sirv`** (the static server's dependency, and therefore whether the pak can be served at all) ·
the game files · **GAME vs OUT resolving to one folder** (2026-08-09: the convert rewrote the archives it was
reading) · the pak and what it was built from · the two run ports · free space on **both** filesystems (the
repo is on internal storage, build output is routinely a symlink into shared) · the branch · the wake lock.

**push credentials** — an https remote with no credential helper anywhere fails with _"could not read
Username"_, and only when a push is attempted. Read from configuration, never by asking the network.

Each check says what to do about it. The verdict is one line at the top.

## The capture inbox

Paste the JSON the console's `copy JSON` button produced, name it, say in one line why the run exists — the
panel writes `docs/benchmarks/opensa-engine/<date>-<name>.json`, **stamping the conditions it can prove**
(device, node, the pak's own recipe and the commit that built it) into the note rather than trusting them to
memory. `Commit & push` then files it on the current branch.

**What is waiting to be committed comes from git, not from this page.** The panel used to remember what it
had filed in the browser's own memory, so a reload, a restarted server or a phone that put the browser to
sleep left a written capture the panel then refused to commit — because it had forgotten writing it. The
section lists whatever is uncommitted under `docs/benchmarks/opensa-engine/`, whoever wrote it and whenever.

**A push that failed is not a dead end.** `Push` sends what is already committed — after a push that died
for its own reasons (no credentials, no network), the capture is in the repository and the remote is not,
and the commit button has nothing new to file. Preflight counts what is unpushed; so does the button.

Two refusals, both on purpose:

- **a capture with no note is refused** — a row nobody can place is a row nobody can compare;
- **the commit names only the files the panel wrote**, and only under `docs/benchmarks/opensa-engine/`. This
  panel files data, never code, and a dirty worktree on a phone cannot ride along.

A baked `tiles.pmtiles` ([201/6-02](../../docs/plans/201-dispatch-console/6-display-modes/readme.md)) goes
through the same section and lands beside the pak — checked for the format's magic first, because an HTML
error page saved under that name makes the flat map draw nothing, which looks exactly like a map that has not
loaded.

## What it does NOT do

- **It does not expose anything.** The server binds `127.0.0.1`; a page that runs commands is a shell, and a
  shell must not appear on the LAN because it was convenient. `PANEL_HOST=0.0.0.0` opts in and the startup
  line says what that means.
- **It is not reachable from outside the phone**, so nobody's session connects to it. The loop with an agent
  closes through the repository: the panel commits and pushes, the next session reads the branch.
- **It caches nothing.** The service worker exists so Android offers "install"; a cached shell showing
  yesterday's preflight would be worse than no icon.

Plans for the panel itself: [`docs/plans/`](./docs/plans/).
