/**
 * Run one of the repository's registered debug scripts on this phone.
 *
 * **Why this exists.** 62 of the 100 scripts in `scripts/debug/` read GAME DATA, and the phone is the only
 * machine that has any — so until now the majority of this repo's diagnostic power was unreachable from a
 * session. The panel runs a fixed job list rather than a command, and that is a security boundary rather
 * than an oversight: it answers on a tunnel one bearer token from the open internet, and a job taking a
 * command off the wire would be a shell on somebody's phone.
 *
 * **So this widens the reach without widening the boundary.** The script NAME arrives as a knob, matched
 * against `^[a-z0-9-]+$` by `buildJob` before it gets here, and then checked against the real directory —
 * a name that is not a file in `scripts/debug/` is refused by name rather than guessed at. The child is
 * spawned with an ARGUMENT ARRAY and no shell, so nothing in a name or an argument can be interpreted as
 * one: a `;` is a semicolon, not a separator.
 *
 * The tools it reaches are diagnostics by construction — they read the game and print. The ones that write
 * do so into this repository's own tree, which is the same place every job here already writes.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DEBUG_DIR = 'scripts/debug';
/** What a script name may be. `buildJob` has already applied this; re-applied here because this file is
 *  also runnable by hand, and a check that only exists upstream is a check that moves when callers do. */
const NAME = /^[a-z0-9-]+$/;

const asked = (process.env.SCRIPT ?? '').trim();
if (asked === '' || !NAME.test(asked)) {
  console.error(`SCRIPT must be a debug script name matching ${String(NAME)} — got '${asked}'`);
  process.exit(2);
}

/** Every registered script, by bare name, so a refusal can list what WAS available rather than only refuse. */
const available = readdirSync(DEBUG_DIR)
  .filter((file) => file.endsWith('.ts') || file.endsWith('.mjs'))
  .filter((file) => !file.startsWith('.'))
  .map((file) => file.replace(/\.(ts|mjs)$/u, ''));

if (!available.includes(asked)) {
  console.error(`no debug script '${asked}'. ${available.length} available:\n  ${available.join('\n  ')}`);
  process.exit(2);
}

const file = existsSync(join(DEBUG_DIR, `${asked}.ts`)) ? `${asked}.ts` : `${asked}.mjs`;
// Split on whitespace into an ARRAY. Safe because there is no shell below this line: every element becomes
// one literal argv entry, so a quote or a semicolon inside one is a character and never a separator.
const extra = (process.env.ARGS ?? '').trim().split(/\s+/u).filter(Boolean);
const target = join(DEBUG_DIR, file);

console.log(`[debug] ${target}${extra.length > 0 ? ` ${extra.join(' ')}` : ''}`);
const child = file.endsWith('.ts')
  ? spawn('node', ['node_modules/tsx/dist/cli.mjs', target, ...extra], { stdio: 'inherit' })
  : spawn('node', [target, ...extra], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
