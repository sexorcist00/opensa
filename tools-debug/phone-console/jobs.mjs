/**
 * The rituals the panel can run, and the one rule that they run ONE at a time.
 *
 * Every job here is an existing command — `npm run phone`, `npm run phone:setup`, `git pull`. The panel adds
 * no build steps of its own and reimplements nothing: `scripts/phone.sh` is 369 lines of measured knowledge
 * about this device, and a second copy of it inside a web server would be a second thing to keep true.
 *
 * **One job at a time, and the refusal names what is running.** Two converts at once on a phone is an OOM
 * and two paks welded into one folder — the failure that cost a session on 2026-08-09. The queue depth is
 * one because the alternative is a queue nobody watches on a screen that sleeps.
 */
import { spawn } from 'node:child_process';

/** Env a `phone` run may carry, with what each accepts. Anything else the form sends is DROPPED rather than
 *  passed on: this is the list `scripts/phone.sh` documents, and an unknown key is a typo that would
 *  otherwise be silently ignored by the shell script instead of reported here. */
export const PHONE_ENV = {
  ASTC_THREADS: /^\d{1,2}$/,
  BAKE: /^[01]$/,
  DISTRICT: /^[a-z0-9-]{1,40}$/,
  HEAP: /^\d{3,5}$/,
  MAPOBJ: /^[01]$/,
  MODELS: /^[01]$/,
  OUT: /^\.?\/?[\w./-]{1,80}$/,
  PEDS: /^[\w,]{1,200}$/,
  REBUILD: /^[01]$/,
  RECT: /^-?\d{1,4},-?\d{1,4},-?\d{1,4},-?\d{1,4}$/,
  SPAWN: /^-?\d{1,5},-?\d{1,5},-?\d{1,5}$/,
  TEXTURES: /^(astc|rgba8|bc)$/,
  VEHICLES: /^[\w,]{1,200}$/,
};

/** What the panel can run. `long` jobs hold the terminal (they serve), so the page shows a stop button. */
export const JOBS = {
  districts: {
    args: ['node_modules/tsx/dist/cli.mjs', 'scripts/district.ts'],
    command: 'node',
    label: 'list the measurement districts',
    long: false,
  },
  phone: {
    args: ['run', 'phone'],
    command: 'npm',
    label: 'convert if needed, verify the pak, serve, print the URLs',
    long: true,
  },
  pull: {
    // --ff-only: a panel that can produce a merge commit on a phone is a panel that can produce a conflict
    // nobody can resolve on a phone.
    args: ['pull', '--ff-only'],
    command: 'git',
    label: 'git pull --ff-only',
    long: false,
  },
  setup: {
    args: ['run', 'phone:setup'],
    command: 'npm',
    label: 'install what a run needs (idempotent)',
    long: false,
  },
};

/**
 * The one running job, its ring buffer, and the listeners watching it.
 *
 * The buffer is why a phone can watch a convert at all: the screen sleeps, the browser drops the connection,
 * and on reconnect the page must show what happened rather than an empty box waiting for the next line.
 */
export class JobRunner {
  /** @param {{cwd: string, onLine: (line: string) => void, ringLines?: number}} options */
  constructor(options) {
    this.cwd = options.cwd;
    this.onLine = options.onLine;
    this.ringLines = options.ringLines ?? 400;
    this.lines = [];
    this.current = null;
  }

  /** Everything the buffer still holds, for a page that just connected. */
  backlog() {
    return this.lines;
  }

  push(line) {
    this.lines.push(line);
    if (this.lines.length > this.ringLines) {
      this.lines.splice(0, this.lines.length - this.ringLines);
    }
    this.onLine(line);
  }

  /** Start a job. Throws — by name — when one is already running. */
  start(plan) {
    if (this.current !== null) {
      throw new Error(`'${this.current.id}' is still running — stop it first`);
    }
    this.push('');
    this.push(`$ ${plan.command} ${plan.args.join(' ')}${describeEnv(plan.env)}`);
    for (const note of plan.dropped) {
      this.push(`  dropped ${note}`);
    }
    // `detached` puts the job in its own process group, so stopping it reaches every child — npm's shell,
    // the convert, vite and the static server. Killing the parent alone leaves a server holding its port,
    // which is the difference between a next run that works and one that says the port is busy.
    const child = spawn(plan.command, plan.args, {
      cwd: this.cwd,
      detached: true,
      env: { ...process.env, ...plan.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.current = { child, id: plan.id, since: Date.now() };
    const read = (stream) => {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        const parts = (rest + chunk).split('\n');
        rest = parts.pop() ?? '';
        for (const line of parts) {
          this.push(line);
        }
      });
    };
    read(child.stdout);
    read(child.stderr);
    child.on('close', (code, signal) => {
      this.push(`— ${plan.id} finished (${signal ?? `exit ${code}`})`);
      this.current = null;
    });
    child.on('error', (error) => {
      this.push(`— ${plan.id} could not start: ${error.message}`);
      this.current = null;
    });

    return this.status();
  }

  /** What is running, or null — the page polls this so a reopened panel knows the state. */
  status() {
    return this.current === null
      ? { running: false }
      : { id: this.current.id, running: true, since: this.current.since };
  }

  /** Stop the running job and everything it started. */
  stop() {
    if (this.current === null) {
      return { running: false };
    }
    const { child, id } = this.current;
    this.push(`— stopping ${id}…`);
    try {
      // Negative pid = the whole process group, which is what `detached` above bought.
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }

    return { running: true, stopping: true };
  }
}

/**
 * Turn a job id and the page's form into the exact process to spawn.
 *
 * Pure, so the interesting half — which env survives, and what a bad value does — is tested without starting
 * anything.
 */
export function buildJob(id, form = {}) {
  const job = JOBS[id];
  if (!job) {
    throw new Error(`unknown job '${id}' — known: ${Object.keys(JOBS).join(', ')}`);
  }
  const env = {};
  const dropped = [];
  for (const [key, raw] of Object.entries(form)) {
    const value = String(raw).trim();
    if (value === '') {
      continue;
    }
    const allowed = id === 'phone' ? PHONE_ENV[key] : undefined;
    if (allowed === undefined) {
      dropped.push(`${key} (not a knob of this job)`);
    } else if (!allowed.test(value)) {
      dropped.push(`${key}=${value} (not the shape ${key} takes)`);
    } else {
      env[key] = value;
    }
  }

  return { args: job.args, command: job.command, dropped, env, id, label: job.label, long: job.long };
}

function describeEnv(env) {
  const keys = Object.keys(env);

  return keys.length === 0 ? '' : `   [${keys.map((key) => `${key}=${env[key]}`).join(' ')}]`;
}
