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
  // dependency.
  const installed = await probe.mtime('node_modules/.package-lock.json');
  const lock = await probe.mtime('package-lock.json');
  add({
    detail:
      installed === null
        ? 'node_modules is not installed'
        : lock !== null && lock > installed
          ? 'package-lock.json is NEWER than the installed tree — a pull added dependencies'
          : 'installed and current with package-lock.json',
    id: 'deps',
    label: 'dependencies',
    state: installed === null ? 'fail' : lock !== null && lock > installed ? 'fail' : 'ok',
    ...(installed === null || (lock !== null && lock > installed) ? { fix: 'npm run phone:setup' } : {}),
  });

  add({
    detail: (await probe.exists('node_modules/tsx')) ? 'present' : 'missing — every .ts entry point needs it',
    id: 'tsx',
    label: 'tsx',
    state: (await probe.exists('node_modules/tsx')) ? 'ok' : 'fail',
    ...((await probe.exists('node_modules/tsx')) ? {} : { fix: 'npm run phone:setup' }),
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
    ...(sirv ? {} : { fix: 'npm i sirv --no-audit --no-fund' }),
  });

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
  add({
    detail:
      manifest === null
        ? 'no pak yet — the next run converts one (minutes to hours)'
        : `built ${report?.build?.at ?? 'unknown'} · textures ${report?.build?.textures ?? 'unstated'}`,
    id: 'pak',
    label: 'pak',
    state: manifest === null ? 'warn' : 'ok',
  });

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

  const git = await probe.git();
  add({
    detail:
      git === null
        ? 'not a git worktree'
        : `${git.branch}${git.dirty > 0 ? ` · ${git.dirty} changed files` : ' · clean'}${git.behind > 0 ? ` · ${git.behind} behind` : ''}`,
    id: 'git',
    label: 'branch',
    state: git === null ? 'warn' : 'ok',
    ...(git !== null && git.behind > 0 ? { fix: 'git pull --ff-only' } : {}),
  });

  add({
    detail: probe.wakeLock
      ? 'termux-wake-lock is available — a long convert survives the screen going off'
      : 'no termux-wake-lock: Android will suspend a long convert when the screen sleeps',
    id: 'wake',
    label: 'wake lock',
    state: probe.wakeLock ? 'ok' : 'warn',
  });

  return checks;
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
