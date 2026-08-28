/**
 * One command that puts this phone in front of an agent: the MCP server, a tunnel, and the two values to
 * paste — printed together, once, in the shape they are pasted in.
 *
 * Without it the ritual is three Termux sessions and a token copied out of a scrollback, on a device where
 * switching sessions is a swipe and copying is a long-press. The panel exists because that class of friction
 * is what stops a measurement being taken; this is the same fix applied to its own setup.
 *
 *   npm run panel:tunnel        # after `npm run panel`, in a second session
 *
 * **The token is generated ONCE and kept** (`build/.phone/mcp-token`, owner-read-only). A tunnel address
 * changes on every restart and there is nothing to be done about that; a token that also changed would mean
 * re-pasting two values every time instead of one.
 *
 * **More than one provider, because the network gets a vote.** 2026-08-28, on this phone: cloudflared's own
 * pre-check failed both ways — `UDP Connectivity … QUIC connection failed` and `TCP Connectivity … HTTP/2 is
 * blocked` — while `api.cloudflare.com:443` passed. The carrier allows 443 and blocks **7844**, which is the
 * only port cloudflared reaches the edge on, in either protocol. Nothing about that is fixable in the
 * config, so the script tries the next provider instead of leaving a wall of retries on the screen.
 *
 * **An address is not a tunnel**, and that distinction cost a paste block that was a lie: 2026-08-28
 * cloudflared printed `Your quick Tunnel has been created!` with a `trycloudflare.com` address, then failed
 * every dial to the edge — the URL never worked. So a provider is announced only when it says it is
 * CONNECTED, and one whose own diagnostics say it cannot connect here is dropped immediately.
 *
 * `TUNNEL=localhost.run` (or `ngrok`, `pinggy`, `serveo`, `cloudflared`) forces one; otherwise every
 * installed provider is tried in order and one that is not up within {@link URL_TIMEOUT_MS} is given up on
 * by name.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');
const TOKEN_FILE = join(REPO, 'build/.phone/mcp-token');
const PORT = Number(process.env.PANEL_MCP_PORT) || 8788;

/** The token this phone uses, made once and kept — see the header for why it does not rotate. */
export function readToken(file = TOKEN_FILE, make = () => randomBytes(24).toString('hex')) {
  if (existsSync(file)) {
    const kept = readFileSync(file, 'utf8').trim();
    if (kept !== '') {
      return kept;
    }
  }
  const token = make();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${token}\n`, 'utf8');
  try {
    chmodSync(file, 0o600);
  } catch {
    // A filesystem without POSIX modes (shared storage on Android) still holds the file; the token is not
    // worth refusing to start over, and the tunnel is the thing that actually exposes anything.
  }

  return token;
}

/** What to paste, in the order the settings page asks for it. */
export function summary(url, token) {
  return [
    '',
    '─────────────────────────────────────────────',
    ' Paste these two into the Claude Code environment,',
    ' then START A NEW SESSION (MCP servers load at start):',
    '',
    `   OPENSA_PHONE_URL    ${url}`,
    `   OPENSA_PHONE_TOKEN  ${token}`,
    '',
    ' Keep this session open — closing it closes the tunnel.',
    '─────────────────────────────────────────────',
    '',
  ].join('\n');
}

/** How long a provider gets to prove it is UP before the next one is tried. */
export const URL_TIMEOUT_MS = 45_000;

/** The SSH options every ssh-based provider wants: no host-key prompt, and a connection that stays up. */
const SSH = [
  '-o',
  'StrictHostKeyChecking=no',
  '-o',
  'UserKnownHostsFile=/dev/null',
  '-o',
  'ServerAliveInterval=30',
  // Never let a provider stop at a password prompt. pinggy did, on a phone with no ssh key
  // (`u0_a210@a.pinggy.io's password:`), and the whole 45s timeout was then spent waiting for a person to
  // type something into a prompt they could not see was a prompt. BatchMode turns that into an immediate
  // refusal, which is the next provider.
  '-o',
  'BatchMode=yes',
];

/**
 * The providers, in the order they are tried.
 *
 * Ordered by what survives a restrictive network rather than by preference. The carrier here allows 443 and
 * blocks **7844**, which is the only port cloudflared reaches its edge on — so everything that speaks 443
 * comes first and cloudflared is last, kept only for a network where it does work.
 *
 * `ready` is the point of this table. A provider that PRINTS an address has not necessarily got a working
 * tunnel: cloudflared prints `Your quick Tunnel has been created!` before it has dialled the edge at all,
 * and on 2026-08-28 it printed one, failed every dial after it, and the address was dead — which is worse
 * than no address, because the paste block said it was ready. So an address is announced only once the
 * provider says it is CONNECTED, and `fatal` lets one that has proved it cannot connect be dropped without
 * waiting out the timeout.
 */
export const PROVIDERS = [
  { args: (port) => ['http', String(port), '--log', 'stdout'], command: 'ngrok', name: 'ngrok' },
  {
    // The one that actually worked on this phone, 2026-08-28: anonymous, no key, and its address line
    // arrives on an SSH connection that is by then established — so printing it IS the proof of a tunnel.
    // Same for every ssh-based provider below.
    args: (port) => [...SSH, '-R', `80:localhost:${port}`, 'nokey@localhost.run'],
    command: 'ssh',
    name: 'localhost.run',
  },
  { args: (port) => [...SSH, '-p', '443', '-R', `0:localhost:${port}`, 'a.pinggy.io'], command: 'ssh', name: 'pinggy' },
  { args: (port) => [...SSH, '-p', '443', '-R', `80:localhost:${port}`, 'serveo.net'], command: 'ssh', name: 'serveo' },
  {
    args: (port) => ['tunnel', '--url', `http://127.0.0.1:${port}`],
    command: 'cloudflared',
    fatal: (line) => /hard_fail=true|Environment has critical failures/.test(String(line)),
    name: 'cloudflared',
    ready: (line) => /Registered tunnel connection/.test(String(line)),
  },
];

/** Which providers are installed here, in the order above; `TUNNEL=` narrows it to one. */
export function chooseProviders(wanted, has) {
  const named = wanted ? PROVIDERS.filter((provider) => provider.name === wanted) : PROVIDERS;

  return named.filter((provider) => has(provider.command));
}

/** Whether this line means the provider has proved it cannot connect here. */
export function isFatal(provider, line) {
  return provider.fatal ? provider.fatal(String(line)) : false;
}

/** Whether this line means the tunnel is actually carrying traffic — the address alone is not that. */
export function isReady(provider, line, url) {
  return url !== null && (provider.ready ? provider.ready(line) : true);
}

/** The public address a tunnel printed, or null when the line is something else. */
export function tunnelUrl(line) {
  const match =
    /https:\/\/[a-z0-9][a-z0-9.-]*\.(?:trycloudflare\.com|ngrok-free\.app|ngrok\.app|ngrok\.io|serveo\.net|pinggy\.link|lhr\.life)/.exec(
      String(line),
    );

  return match ? match[0] : null;
}

if (process.argv[1] && process.argv[1].endsWith('tunnel.mjs')) {
  const token = readToken();
  const children = new Set();
  const stop = () => {
    for (const child of children) {
      child.kill();
    }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const mcp = spawn(process.execPath, [join(HERE, 'mcp.mjs'), '--http', '--port', String(PORT)], {
    env: { ...process.env, PANEL_MCP_TOKEN: token },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.add(mcp);
  mcp.stdout.on('data', (chunk) => process.stdout.write(`[mcp] ${chunk}`));

  const installed = (command) => {
    try {
      return spawnSync('sh', ['-c', `command -v ${command}`]).status === 0;
    } catch {
      return false;
    }
  };
  const providers = chooseProviders(process.env.TUNNEL, installed);
  if (providers.length === 0) {
    process.stdout.write(
      `\nNo tunnel is installed. This network blocks cloudflared's port (7844), so install one that ` +
        `reaches its edge over 443:\n` +
        `  openssh — \`pkg install openssh\`, and three account-less providers become available\n` +
        `  ngrok   — most reliable, free account: put the linux-arm64 binary in $PREFIX/bin, then ` +
        `\`ngrok config add-authtoken <yours>\`\n` +
        `The MCP server is up regardless, for a Claude running ON this phone:\n` +
        summary(`http://127.0.0.1:${PORT}/mcp`, token),
    );
  }

  /** Try each provider until one is UP; say by name when one is not, and never announce an address early. */
  const tryProvider = (index) => {
    const provider = providers[index];
    if (!provider) {
      process.stdout.write(
        `\nNo provider got a working tunnel. This network blocks cloudflared's only port (7844), and the ` +
          `account-less ones are up and down — the reliable answer here is ngrok: put the linux-arm64 binary ` +
          `in $PREFIX/bin and run \`ngrok config add-authtoken <yours>\` (free account), then re-run this.\n` +
          `The MCP server is up regardless, for a Claude running ON this phone:\n` +
          summary(`http://127.0.0.1:${PORT}/mcp`, token),
      );

      return;
    }
    process.stdout.write(`\n[tunnel] trying ${provider.name}…\n`);
    const child = spawn(provider.command, provider.args(PORT), { stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let settled = false; // announced as up, or given up on — either way this provider is out of the race
    let announced = false; // a block was printed for it, so a later address change has to correct that block
    let url = null;
    const next = (why) => {
      if (settled) {
        return;
      }
      settled = true; // stop this provider's own later lines from re-entering
      clearTimeout(giveUp);
      clearInterval(beat);
      child.kill();
      children.delete(child);
      process.stdout.write(`\n[tunnel] ${provider.name} ${why} — trying the next one.\n`);
      tryProvider(index + 1);
    };
    const giveUp = setTimeout(() => next(`printed no working address in ${URL_TIMEOUT_MS / 1000}s`), URL_TIMEOUT_MS);
    // A provider that says nothing for 45s is indistinguishable from a hang on a phone screen, and the
    // operator's only move then is to kill a script that was about to work. Say the clock is running.
    const started = Date.now();
    const beat = setInterval(() => {
      if (!settled) {
        const left = Math.round((URL_TIMEOUT_MS - (Date.now() - started)) / 1000);
        process.stdout.write(
          `[tunnel] ${provider.name}: ${url ? 'address seen, waiting for it to connect' : 'waiting for an address'} — ${left}s left\n`,
        );
      }
    }, 10_000);
    beat.unref?.();
    const watch = (chunk) => {
      process.stdout.write(`[${provider.name}] ${chunk}`);
      const seen = tunnelUrl(chunk);
      if (settled) {
        // An anonymous localhost.run tunnel is handed a NEW address every time it reconnects, and the block
        // printed minutes ago then names a dead one — which the operator has no way to notice, because the
        // new address arrives as one more line in a log they have already stopped reading. Say it loudly.
        if (announced && seen !== null && seen !== url) {
          url = seen;
          process.stdout.write(`\n[tunnel] ${provider.name} RECONNECTED ON A NEW ADDRESS — the one above is dead.\n`);
          process.stdout.write(summary(`${url}/mcp`, token));
        }

        return;
      }
      url = seen ?? url;
      if (isFatal(provider, chunk)) {
        return next('reported it cannot connect from this network');
      }
      if (isReady(provider, chunk, url)) {
        settled = true;
        announced = true;
        clearTimeout(giveUp);
        clearInterval(beat);
        process.stdout.write(summary(`${url}/mcp`, token));
      }
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch); // cloudflared and ssh both announce on stderr
    child.on('error', () => next('would not start'));
    child.on('exit', (code) => next(`exited (${code}) before giving a working address`));
  };
  tryProvider(0);
}
