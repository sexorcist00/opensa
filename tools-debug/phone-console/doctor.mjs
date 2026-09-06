/**
 * Preflight: one screen that says why a run will not start.
 *
 * This is the half of the panel that pays for itself. On a phone the answer to "nothing opened" lives at the
 * bottom of a log in a terminal with no scrollback worth the name, and the causes repeat: a pull brought
 * dependencies the tree does not have, `tsx` is missing, the game files are not where the convert looks, a
 * port is still held by the last run, `GAME` and `OUT` resolve to the same folder (2026-08-09: the convert
 * ate the archives it was reading), or shared storage is full while internal storage is not.
 *
 * Every check is a pure decision over an injected probe, so the interesting half is tested without a device.
 */

/** Node the repo is developed against. Below this, `npm run phone` fails in ways that read as unrelated. */
const MIN_NODE_MAJOR = 20;
/** Under this much free space a convert will die partway — a district pak is hundreds of MB. */
const LOW_DISK_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * @param {object} probe - injected filesystem/network/process access
 * @param {{game: string, out: string, ports: number[]}} target - what this run is aimed at
 */
export async function runChecks(probe, target) {
  const checks = [];
  const add = (check) => checks.push(check);

  const major = Number((probe.nodeVersion ?? '').replace(/^v/, '').split('.')[0]);
  add({
    detail: `${probe.nodeVersion} · ${probe.arch}${probe.termux ? ' · Termux' : ''}`,
    id: 'node',
    label: 'node',
    state: Number.isFinite(major) && major >= MIN_NODE_MAJOR ? 'ok' : 'fail',
    ...(major < MIN_NODE_MAJOR ? { fix: 'pkg install nodejs-lts' } : {}),
  });

  // STALENESS, not existence — the rule `scripts/phone-setup.sh` learned the hard way: a tree that exists
  // but predates a pull is a tree the convert dies in, minutes later, inside the stage that needed the new
  // dependency. That rule stands; what changed on 2026-09-06 is HOW staleness is decided.
  //
  // **It compared MTIMES and then asserted a cause.** Any git operation that rewrote `package-lock.json`
  // without changing a byte of it — a revert, a checkout, a branch switch — made the file newer than the
  // tree, and the check failed the device while stating "a pull added dependencies", which had not
  // happened. The offered fix is a reinstall costing minutes on this phone, so the false alarm is not free.
  // The lesson was already in this repo one check over: the served-app check compares CONTENT because
  // "a timestamp comparison is guaranteed to lie here" (`webapp.mjs`). Same answer here.
  //
  // npm's hidden lockfile records what is actually installed, so the honest question is whether the
  // versions it carries are the ones `package-lock.json` asks for. Immune to mtime, and immune to the
  // `"peer": true` markers an install rewrites without moving a version.
  const wanted = await probe.readJson('package-lock.json');
  const installed = await probe.readJson('node_modules/.package-lock.json');
  const drift = lockDrift(wanted, installed);
  const depsStale = drift !== null && drift.length > 0;
  add({
    detail:
      installed === null
        ? 'node_modules is not installed'
        : depsStale
          ? `${drift.length} package(s) differ from package-lock.json (e.g. ${drift.slice(0, 3).join(', ')})`
          : 'installed and current with package-lock.json',
    id: 'deps',
    label: 'dependencies',
    state: installed === null || depsStale ? 'fail' : 'ok',
    // `job` is what makes a fix a BUTTON on the page rather than a command to retype on a phone. Only the
    // safe ones carry it: nothing that discards a file is one tap away.
    ...(installed === null || depsStale ? { fix: 'npm run phone:setup', job: 'setup' } : {}),
  });

  add({
    detail: (await probe.exists('node_modules/tsx')) ? 'present' : 'missing — every .ts entry point needs it',
    id: 'tsx',
    label: 'tsx',
    state: (await probe.exists('node_modules/tsx')) ? 'ok' : 'fail',
    ...((await probe.exists('node_modules/tsx')) ? {} : { fix: 'npm run phone:setup', job: 'setup' }),
  });

  // `scripts/serve-static.ts` imports sirv, and sirv is a devDependency reachable only through the dev tree
  // that `phone:setup` deliberately omits. Without it the static server never opens :3001 — and :3001 is
  // what serves the pak, so the symptom is a map that loads nothing at all.
  const sirv = await probe.exists('node_modules/sirv');
  add({
    detail: sirv ? 'present — the static server can start' : 'MISSING — the static server cannot serve the pak',
    id: 'sirv',
    label: 'sirv (static server)',
    state: sirv ? 'ok' : 'fail',
    ...(sirv ? {} : { fix: 'npm i sirv --no-save --no-audit --no-fund', job: 'sirv' }),
  });

  // The prebuilt app is a COMMITTED archive, and `build/webapp` is the unpacked copy — gitignored, so a pull
  // updates the archive and never the thing being served. `prebuilt/README.md` warns about it in prose; this
  // is the same warning as a check, because the symptom is a device running last week's app while its
  // operator reads this week's release notes (2026-08-23: an 11-day-old build, so the flat map did not exist
  // on a phone that had just pulled it).
  //
  // Compared by CONTENT — see `webapp.mjs` for why a timestamp comparison is guaranteed to lie here.
  const app = await probe.app();
  if (app !== null) {
    const stale = app.archived !== app.served;
    add({
      detail: stale
        ? 'NOT the app in the repo — a pull updates the archive, never the unpacked copy'
        : 'the same build as the archive in the repo',
      id: 'webapp',
      label: 'the served app',
      state: stale ? 'fail' : 'ok',
      ...(stale ? { fix: 're-unpack the app', job: 'webapp' } : {}),
    });
  }

  const gameDat = await probe.exists(`${target.game}/data/gta.dat`);
  add({
    detail: gameDat ? `${target.game}` : `no ${target.game}/data/gta.dat — the converter reads the PC game`,
    id: 'game',
    label: 'game files',
    state: gameDat ? 'ok' : 'fail',
  });

  // The 2026-08-09 disaster, as a check: both are routinely symlinks into shared storage, and when they
  // land on one folder the convert rewrites the archives it is reading. `guardOut` refuses it now — but it
  // refuses AFTER the run has started, and this says so before anything is deleted.
  const [gameReal, outReal] = [await probe.realpath(target.game), await probe.realpath(target.out)];
  add({
    detail:
      gameReal !== null && gameReal === outReal
        ? `both resolve to ${gameReal} — the convert would eat its own source`
        : `${target.game} → ${gameReal ?? '(absent)'} · ${target.out} → ${outReal ?? '(not built yet)'}`,
    id: 'paths',
    label: 'GAME vs OUT',
    state: gameReal !== null && gameReal === outReal ? 'fail' : 'ok',
  });

  const manifest = await probe.readJson(`${target.out}/pak/manifest.json`);
  const report = await probe.readJson(`${target.out}/pak/report.json`);
  const tiles = await probe.tilesArchive(target.out);
  add({
    detail:
      manifest === null
        ? 'no pak yet — the next run converts one (minutes to hours)'
        : `built ${report?.build?.at ?? 'unknown'} · textures ${report?.build?.textures ?? 'unstated'} · ${
            tiles === null ? 'no tiles.pmtiles beside it' : `tiles.pmtiles ${(tiles / 1024 / 1024).toFixed(2)} MB`
          }`,
    id: 'pak',
    label: 'pak',
    state: manifest === null ? 'warn' : 'ok',
  });

  // A convert this device did not get to finish. Android kills Termux with the screen ON and the app merely
  // backgrounded, so a run dying part-way is the normal case here rather than the exceptional one — and the
  // question an operator has after it is "did I lose the forty minutes". This answers it before they ask.
  const journal = await probe.exists(`${target.out}/.pack-checkpoints`);
  if (journal && manifest === null) {
    add({
      detail: 'a convert was interrupted and its finished chunks are journalled — the next run RESUMES it',
      fix: 'Convert & serve picks up where it stopped; REBUILD=1 starts over instead',
      id: 'resume',
      label: 'unfinished convert',
      state: 'warn',
    });
  }

  for (const port of target.ports) {
    const open = await probe.portOpen(port);
    add({
      detail: open ? 'already serving — a run reuses it' : 'free',
      id: `port-${port}`,
      label: `port ${port}`,
      state: 'ok',
      ...(open ? { serving: true } : {}),
    });
  }

  // Two filesystems on this device — the repo is on internal storage and build output is routinely a
  // symlink into shared storage — so one free-space number would answer the wrong question half the time.
  for (const [id, path] of [
    ['disk-repo', '.'],
    ['disk-out', target.out],
  ]) {
    const free = await probe.freeBytes(path);
    add({
      detail: free === null ? `${path}: unknown` : `${path}: ${(free / 1024 ** 3).toFixed(1)} GB free`,
      id,
      label: id === 'disk-repo' ? 'space (repo)' : 'space (build output)',
      state: free !== null && free < LOW_DISK_BYTES ? 'warn' : 'ok',
    });
  }

  // A commit needs an author, and git says so only when one is attempted: "Author identity unknown". On a
  // phone that has only ever PULLED, it never is — which is how a capture that was written, filed and
  // committed by one tap turned out to have gone nowhere (2026-08-24).
  const identity = await probe.identity();
  add({
    detail:
      identity.email === '' || identity.name === ''
        ? 'not set — every commit will fail with "Author identity unknown"'
        : `commits as ${identity.name} <${identity.email}>`,
    id: 'identity',
    label: 'git identity',
    state: identity.email === '' || identity.name === '' ? 'fail' : 'ok',
    // Derived from the remote this repository actually has, never invented: GitHub accepts the account's
    // noreply address, so a capture from the phone is attributed without publishing a personal one.
    ...(identity.email === '' || identity.name === ''
      ? {
          fix: `git config user.name "${identity.owner || 'your name'}" && git config user.email "${identity.owner || 'you'}@users.noreply.github.com"`,
        }
      : {}),
  });

  // A push needs a way to authenticate, and an https remote with no helper anywhere fails with "could not
  // read Username" — which git only says when a push is attempted, and which this panel makes it say fast
  // rather than hang on a prompt nobody sees.
  const credentials = await probe.credentials();
  add({
    detail: credentials.ok
      ? `push authenticates through ${credentials.helper}`
      : 'no credential helper — a push will fail with "could not read Username"',
    id: 'push-auth',
    label: 'push credentials',
    state: credentials.ok ? 'ok' : 'warn',
    ...(credentials.ok ? {} : { fix: 'pkg install gh && gh auth login   (or: git config credential.helper store)' }),
  });

  // A branch that has both sides ahead is what a phone that COMMITS meets the first time the other end
  // pushes too (2026-08-24): `git pull --ff-only` refuses, correctly, and says so in words that read like a
  // failure rather than a decision. The decision is one command, and the panel can run it.
  if (await probe.rebasing()) {
    add({
      detail: 'a rebase stopped part-way — the tree is mid-history until it is finished or abandoned',
      fix: 'git rebase --continue   (or: git rebase --abort to put it back)',
      id: 'rebasing',
      label: 'a rebase is in progress',
      state: 'fail',
    });
  }

  const git = await probe.git();
  if (git !== null && git.ahead > 0 && git.behind > 0) {
    add({
      detail: `${git.ahead} here and ${git.behind} there — a fast-forward pull cannot take both`,
      fix: 'git pull --rebase',
      id: 'diverged',
      job: 'rebase',
      label: 'the branch has diverged',
      state: 'fail',
    });
  }
  // The failure this device actually met on 2026-08-30, and the one the checks above could not see: the
  // branch the phone was sitting on had been merged and deleted from origin, so `pull` answered "no such ref
  // was fetched" and every job kept running the code the checkout froze at three days earlier — including a
  // pak gate whose fix was already in `main`. The branch row said `clean`, because a missing `origin/<branch>`
  // read as "no upstream yet". It is a fail rather than a warn: nothing here can be updated until it is
  // resolved, so every other green light is a light on stale code.
  if (git !== null && git.upstream === 'gone') {
    add({
      detail: `origin/${git.branch} is gone — merged and deleted, so a pull has no ref to fetch and every job runs the code this checkout froze at`,
      fix: 'git checkout main   (then pull)',
      id: 'branch-gone',
      job: 'main',
      label: 'the branch no longer exists on the remote',
      state: 'fail',
    });
  }
  // A count nobody refreshed is not a count. `behind` is measured against the LOCAL `origin/<branch>`, so
  // until the probe started fetching (2026-09-05) this row said `main · clean` on a device three app
  // archives behind — the check that exists to catch stale code reporting the device current. The fetch is
  // throttled and bounded, so it can fail; when it does, the age of the last good one is the qualifier that
  // makes the number readable instead of merely reassuring.
  const stale = git !== null && git.fetched !== undefined && !git.fetched.ok;
  add({
    detail:
      git === null
        ? 'not a git worktree'
        : `${git.branch}${git.dirty > 0 ? ` · ${git.dirty} changed files` : ' · clean'}${git.ahead > 0 ? ` · ${git.ahead} to push` : ''}${git.behind > 0 ? ` · ${git.behind} behind` : ''}${stale ? ` · origin unreachable${git.fetched.ageMs === null ? ', never fetched this run' : `, last read ${since(git.fetched.ageMs)} ago`}` : ''}`,
    id: 'git',
    label: 'branch',
    state: git === null || stale ? 'warn' : 'ok',
    ...(git !== null && git.behind > 0 ? { fix: 'git pull --ff-only', job: 'pull' } : {}),
  });

  // A pull that cannot run is the failure that reaches the user as "the panel does not exist": the update
  // carrying it never lands. It has a specific cause on this device — `npm i <pkg>` writes the package into
  // package.json — so the check names the file and the way back rather than saying "worktree dirty".
  if (git !== null && git.dirtyPaths.some((path) => path === 'package.json' || path === 'package-lock.json')) {
    add({
      detail: 'package.json is modified, so `git pull` will refuse — usually npm writing a package it installed',
      fix: 'git checkout -- package.json package-lock.json',
      id: 'pull-blocked',
      label: 'a pull will refuse',
      state: 'fail',
    });
  }

  add({
    detail: probe.wakeLock
      ? 'termux-wake-lock is available — a long convert survives the screen going off'
      : 'no termux-wake-lock: Android will suspend a long convert when the screen sleeps',
    id: 'wake',
    label: 'wake lock',
    state: probe.wakeLock ? 'ok' : 'warn',
  });

  // Without it the panel can hand out a link but never open one, so `map_open` — the tool that clears "no
  // map is attached" — has nothing to launch with. A warn rather than a fail: every link still works under
  // a thumb.
  //
  // Present is not the same as working, and this check cannot tell the difference: Android drops an activity
  // started by a background app, `termux-open-url` exits 0 when it does, and the permission that lifts it is
  // not readable from an app's own uid. So the detail names the condition rather than promising the launch —
  // the phone run on 2026-08-28 found the binary here and every launch silently discarded.
  add({
    detail: probe.openUrl
      ? 'termux-open-url is available — a launch from here also needs Termux allowed to display over other ' +
        'apps, or Android drops it with no error'
      : 'no termux-open-url: only a tap can open the console (`pkg install termux-tools`)',
    id: 'open-url',
    label: 'opening the console',
    state: probe.openUrl ? 'ok' : 'warn',
    ...(probe.openUrl ? {} : { fix: 'pkg install termux-tools' }),
  });

  // Whether `map_release` can reach the OPERATOR rather than the agent. Termux:API is a separate add-on app,
  // so its absence is ordinary — and the console's own band still says the run is over, which is why this is
  // a warn and why the detail says what is lost rather than what is broken.
  add({
    detail: probe.signal
      ? 'termux-vibrate is available — the phone buzzes when an agent finishes with the console'
      : 'no Termux:API: the console still shows when a run ends, but the phone cannot buzz for it',
    id: 'signal',
    label: 'telling you the run ended',
    state: probe.signal ? 'ok' : 'warn',
    ...(probe.signal ? {} : { fix: 'pkg install termux-api' }),
  });

  return checks;
}

/**
 * The paths out of `git status --porcelain`.
 *
 * **Do not `.trim()` the output first.** Every porcelain line starts with a two-character status field, and
 * for an unstaged modification the first of those characters is a SPACE — so trimming the whole block eats
 * one character of the first line only, and `slice(3)` then returns `ackage.json`. One entry wrong, always
 * the first, silently: the check reads healthy exactly when the file it is about is the only thing changed.
 */
export function statusPaths(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.slice(3).split(' -> ').pop());
}

/** The one-line verdict a page shows before anything is tapped. */
export function verdict(checks) {
  const failed = checks.filter((check) => check.state === 'fail');
  if (failed.length > 0) {
    return { headline: `${failed.length} blocking: ${failed.map((check) => check.label).join(', ')}`, state: 'fail' };
  }
  const warned = checks.filter((check) => check.state === 'warn');

  return warned.length > 0
    ? { headline: `ready · ${warned.length} to know about`, state: 'warn' }
    : { headline: 'ready', state: 'ok' };
}

/** A duration a person reads at a glance — this is a status line on a phone, not a log. */
function since(ms) {
  if (ms < 90_000) {
    return `${Math.round(ms / 1000)}s`;
  }

  return ms < 5_400_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 3_600_000)}h`;
}

/**
 * Which packages `package-lock.json` asks for that the installed tree does not carry AT THE SAME VERSION.
 *
 * `null` when there is no installed tree to compare against — that is "not installed", a different verdict.
 * Only `node_modules/` keys are compared: the lockfile's root entry describes the workspace itself and npm's
 * hidden lockfile does not carry it, so including it would report drift on every machine forever.
 *
 * **`optional` entries are skipped, and that is not a loophole.** A lockfile lists every platform build of a
 * package — `@esbuild/aix-ppc64`, `@esbuild/android-arm`, `darwin-x64` and so on — each `optional` with its
 * own `os`/`cpu`, and npm installs only the one this machine needs. Comparing them reported **172 packages
 * differ** on the phone the first time this check ran, none of which will ever be installed there: a false
 * alarm that, unlike the mtime one it replaced, would never clear. Deciding WHICH platform build is owed is
 * npm's job and re-deriving it here would be a second copy of that rule, wrong the day a package changes its
 * matrix. What the check is for — a REQUIRED dependency a pull added and the tree has not got — is unaffected.
 */
function lockDrift(wanted, installed) {
  if (installed === null || installed === undefined) {
    return null;
  }
  const want = wanted?.packages ?? {};
  const have = installed?.packages ?? {};

  return Object.keys(want)
    .filter((key) => key.startsWith('node_modules/') && want[key]?.version !== undefined)
    .filter((key) => want[key].optional !== true)
    .filter((key) => want[key].version !== have[key]?.version);
}
