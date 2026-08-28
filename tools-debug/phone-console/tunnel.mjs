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
 * `TUNNEL=ngrok` (or `cloudflared`, `serveo`) forces one; otherwise every installed provider is tried in
 * order and one that prints no address within {@link URL_TIMEOUT_MS} is given up on by name.
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

/** How long a provider gets to print an address before the next one is tried. */
export const URL_TIMEOUT_MS = 30_000;

/**
 * The providers, in the order they are tried.
 *
 * Ordered by what survives a restrictive network rather than by preference: ngrok reaches its edge over TLS
 * on 443, serveo is SSH and is asked for 443 explicitly, and cloudflared — which needs 7844 — is last
 * because that is the port a carrier blocks.
 */
export const PROVIDERS = [
  { args: (port) => ['http', String(port), '--log', 'stdout'], command: 'ngrok', name: 'ngrok' },
  {
    args: (port) => [
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'ServerAliveInterval=30',
      '-p',
      '443',
      '-R',
      `80:localhost:${port}`,
      'serveo.net',
    ],
    command: 'ssh',
    name: 'serveo',
  },
  { args: (port) => ['tunnel', '--url', `http://127.0.0.1:${port}`], command: 'cloudflared', name: 'cloudflared' },
];

/** Which providers are installed here, in the order above; `TUNNEL=` narrows it to one. */
export function chooseProviders(wanted, has) {
  const named = wanted ? PROVIDERS.filter((provider) => provider.name === wanted) : PROVIDERS;

  return named.filter((provider) => has(provider.command));
}

/** The public address a tunnel printed, or null when the line is something else. */
export function tunnelUrl(line) {
  const match =
    /https:\/\/[a-z0-9][a-z0-9-]*\.(?:trycloudflare\.com|ngrok-free\.app|ngrok\.app|ngrok\.io|serveo\.net)/.exec(
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
        `  ngrok   — most reliable, free account: put the linux-arm64 binary in $PREFIX/bin, then ` +
        `\`ngrok config add-authtoken <yours>\`\n` +
        `  serveo  — no account: \`pkg install openssh\` (this script asks it for port 443)\n` +
        `The MCP server is up regardless, for a Claude running ON this phone:\n` +
        summary(`http://127.0.0.1:${PORT}/mcp`, token),
    );
  }

  /** Try each provider until one prints an address; say by name when one does not. */
  const tryProvider = (index) => {
    const provider = providers[index];
    if (!provider) {
      process.stdout.write(
        `\nNo provider produced an address. The MCP server is still up on ` +
          `http://127.0.0.1:${PORT}/mcp for a Claude running on this phone.\n`,
      );

      return;
    }
    process.stdout.write(`\n[tunnel] trying ${provider.name}…\n`);
    const child = spawn(provider.command, provider.args(PORT), { stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let announced = false;
    const giveUp = setTimeout(() => {
      if (!announced) {
        process.stdout.write(`\n[tunnel] ${provider.name} printed no address in 30s — trying the next one.\n`);
        child.kill();
        children.delete(child);
        tryProvider(index + 1);
      }
    }, URL_TIMEOUT_MS);
    const watch = (chunk) => {
      process.stdout.write(`[${provider.name}] ${chunk}`);
      const url = tunnelUrl(chunk);
      if (url && !announced) {
        announced = true;
        clearTimeout(giveUp);
        process.stdout.write(summary(`${url}/mcp`, token));
      }
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch); // cloudflared and ssh both announce on stderr
    child.on('error', () => {
      clearTimeout(giveUp);
      children.delete(child);
      process.stdout.write(`\n[tunnel] ${provider.name} would not start — trying the next one.\n`);
      tryProvider(index + 1);
    });
    child.on('exit', (code) => {
      children.delete(child);
      if (!announced) {
        clearTimeout(giveUp);
        process.stdout.write(`\n[tunnel] ${provider.name} exited (${code}) before giving an address.\n`);
        tryProvider(index + 1);
      }
    });
  };
  tryProvider(0);
}
