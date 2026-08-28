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
 */
import { spawn } from 'node:child_process';
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

/** The public address a tunnel printed, or null when the line is something else. */
export function tunnelUrl(line) {
  const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(line);

  return match ? match[0] : null;
}

if (process.argv[1] && process.argv[1].endsWith('tunnel.mjs')) {
  const token = readToken();
  const children = [];
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
  children.push(mcp);
  mcp.stdout.on('data', (chunk) => process.stdout.write(`[mcp] ${chunk}`));

  const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(tunnel);
  let announced = false;
  const watch = (chunk) => {
    const text = String(chunk);
    process.stdout.write(`[tunnel] ${text}`);
    const url = tunnelUrl(text);
    if (url && !announced) {
      announced = true;
      process.stdout.write(summary(`${url}/mcp`, token));
    }
  };
  tunnel.stdout.on('data', watch);
  tunnel.stderr.on('data', watch); // cloudflared prints its address on stderr
  tunnel.on('error', () => {
    // No tunnel: still useful, and saying which half is missing beats a stack trace on a phone.
    process.stdout.write(
      `\ncloudflared is not installed — \`pkg install cloudflared\`.\n` +
        `The MCP server is up all the same, for a Claude running ON this phone:\n` +
        summary(`http://127.0.0.1:${PORT}/mcp`, token),
    );
  });
}
