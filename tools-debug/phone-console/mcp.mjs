/**
 * The phone as a TOOL: MCP over the panel (plan 002 beside this file).
 *
 * The loop this replaces is the expensive one. An agent writes code in a container, the phone runs it, and
 * everything in between — did the convert start, what did preflight refuse, what did the capture say — is a
 * person reading a screen and typing it back. Every round trip costs a message and loses the detail nobody
 * thought to copy.
 *
 * So the panel's own capabilities become MCP tools. **It is a CLIENT of the running panel, never a second
 * copy of it**, and that is the load-bearing decision: `JobRunner` allows one job at a time, and two runners
 * on one phone is two converts fighting over the same folder. If the panel is not up, every tool here says
 * so instead of starting anything.
 *
 * **What it can do is exactly what the panel's buttons can do**, and that is deliberate. The jobs are an
 * allowlist (`jobs.mjs`), not a shell: `pull`, `setup`, the three converts, the share build, the tile bake's
 * link, the capture inbox and `commit & push`. An `exec` tool exists for the case the allowlist cannot cover
 * and is **off unless `PANEL_MCP_EXEC=1`** — a remote shell on somebody's phone is a thing they turn on
 * deliberately, never a default that arrives with an update.
 *
 * Two transports, one handler:
 *
 * - **stdio** (default) — for a Claude running ON the phone. Nothing is exposed to any network.
 * - **`--http [--port N]`** — JSON-RPC over POST, for a Claude that is somewhere else. It binds `127.0.0.1`
 *   like the panel, so reaching it from off-device is a tunnel the operator sets up on purpose, and it
 *   REQUIRES a bearer token (`PANEL_MCP_TOKEN`, or one generated and printed at startup). A tunnel plus no
 *   token is a shell on the open internet.
 *
 *   node tools-debug/phone-console/mcp.mjs            # stdio
 *   node tools-debug/phone-console/mcp.mjs --http     # POST http://127.0.0.1:8788/mcp
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Where the panel is. Same default as the panel's own, so neither has to be configured in the usual case. */
const PANEL = process.env.PANEL_URL ?? `http://127.0.0.1:${Number(process.env.PANEL_PORT) || 8787}`;

/** The MCP protocol version this server speaks. */
const PROTOCOL = '2024-11-05';

/**
 * The tools, and their whole surface. Every one of them is something the panel's page can already do — the
 * point is that an agent can do it without a person relaying the screen.
 */
export const TOOLS = [
  {
    description:
      'What the phone is: preflight checks and their verdict, the pak on disk and what it was built from, ' +
      'the running job, the ports, and the captures waiting to be committed. Read this before anything else.',
    inputSchema: { properties: {}, type: 'object' },
    name: 'phone_state',
  },
  {
    description:
      'The jobs this phone can run, with the knobs each accepts. An allowlist, not a shell: ' +
      'converts, the setup/pull rituals, the shareable build.',
    inputSchema: { properties: {}, type: 'object' },
    name: 'phone_jobs',
  },
  {
    description:
      'Start one job. Refuses while another is running — a phone runs one convert at a time. ' +
      'Returns immediately; watch it with phone_log.',
    inputSchema: {
      properties: {
        env: {
          description: 'Knobs the job accepts (DISTRICT, OUT, TEXTURES, MODELS). Anything else is dropped and named.',
          type: 'object',
        },
        id: { description: 'Job id — see phone_jobs.', type: 'string' },
      },
      required: ['id'],
      type: 'object',
    },
    name: 'phone_run',
  },
  {
    description: 'The tail of the job log — what the running (or last) job printed. Survives the panel being killed.',
    inputSchema: {
      properties: { lines: { description: 'How many lines from the end (default 80).', type: 'number' } },
      type: 'object',
    },
    name: 'phone_log',
  },
  {
    description: 'Stop the running job.',
    inputSchema: { properties: {}, type: 'object' },
    name: 'phone_stop',
  },
  {
    description:
      'Commit and push what the map has filed under docs/benchmarks. The captures themselves arrive from ' +
      'the console itself (its readout posts them), so this is the second half of that round trip.',
    inputSchema: {
      properties: {
        message: { description: 'Commit subject; a sensible one is derived when absent.', type: 'string' },
      },
      type: 'object',
    },
    name: 'phone_commit',
  },
];

/** The `exec` tool, added only when the operator turned it on. */
const EXEC_TOOL = {
  description:
    'Run a shell command in the repository on the phone. Off unless PANEL_MCP_EXEC=1 — this is the one ' +
    'tool that is not an allowlist, and it exists for what the allowlist cannot cover.',
  inputSchema: {
    properties: {
      command: { description: 'The command line to run, in the repo root.', type: 'string' },
      timeoutMs: { description: 'How long to wait before killing it (default 120000).', type: 'number' },
    },
    required: ['command'],
    type: 'object',
  },
  name: 'phone_exec',
};

/**
 * One JSON-RPC request → its response, or null for a notification.
 *
 * Pure over `deps` so the whole protocol is testable without a panel, a phone or a socket: `panel` is how it
 * reaches the panel's HTTP API, `exec` how it runs a command when that is enabled.
 */
export async function handleRpc(request, deps) {
  const { id, method, params } = request;
  const reply = (result) => (id === undefined ? null : { id, jsonrpc: '2.0', result });
  const fail = (code, message) => (id === undefined ? null : { error: { code, message }, id, jsonrpc: '2.0' });

  if (method === 'initialize') {
    return reply({
      capabilities: { tools: {} },
      protocolVersion: PROTOCOL,
      serverInfo: { name: 'opensa-phone', version: '1' },
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return null;
  }
  if (method === 'ping') {
    return reply({});
  }
  if (method === 'tools/list') {
    return reply({ tools: toolList(deps.env) });
  }
  if (method !== 'tools/call') {
    return fail(-32601, `unknown method '${method}'`);
  }

  const name = params?.name;
  const args = params?.arguments ?? {};
  try {
    return reply(await callTool(name, args, deps));
  } catch (error) {
    // A tool failure is a RESULT, not a protocol error: the agent must be able to read what went wrong and
    // act on it, and a JSON-RPC error is the shape reserved for "this request made no sense".
    return reply({ content: [{ text: `${name} failed: ${message(error)}`, type: 'text' }], isError: true });
  }
}

/** Every tool this process offers, which depends on what the operator turned on. */
export function toolList(env = process.env) {
  return env.PANEL_MCP_EXEC === '1' ? [...TOOLS, EXEC_TOOL] : TOOLS;
}

async function callTool(name, args, deps) {
  const { exec, panel } = deps;
  switch (name) {
    case 'phone_commit':
      return content(
        await panel('POST', '/api/commit', {
          paths: (await panel('GET', '/api/state')).pending ?? [],
          push: true,
          subject: args.message ?? 'a capture from the phone',
        }),
      );
    case 'phone_exec': {
      if (deps.env?.PANEL_MCP_EXEC !== '1') {
        throw new Error('phone_exec is off — start the server with PANEL_MCP_EXEC=1 to allow it');
      }

      return content(await exec(String(args.command), Number(args.timeoutMs) || 120_000));
    }
    case 'phone_jobs':
      return content(await panel('GET', '/api/jobs'));
    case 'phone_log': {
      const lines = Number(args.lines) || 80;
      const log = await panel('GET', `/api/log/tail?tail=${lines}`);

      return content(log);
    }
    case 'phone_run':
      return content(await panel('POST', `/api/job/${encodeURIComponent(String(args.id))}`, args.env ?? {}));
    case 'phone_state':
      return content(await panel('GET', '/api/state'));
    case 'phone_stop':
      return content(await panel('POST', '/api/stop', {}));
    default:
      throw new Error(`unknown tool '${name}'`);
  }
}

/** Text back to the caller, in the one shape MCP wants. */
function content(value) {
  return { content: [{ text: typeof value === 'string' ? value : JSON.stringify(value, null, 2), type: 'text' }] };
}

/** Run a command in the repo, capturing both streams — only reachable when `phone_exec` is on. */
async function execInRepo(command, timeoutMs) {
  try {
    const { stderr, stdout } = await run('bash', ['-lc', command], {
      cwd: new URL('../..', import.meta.url).pathname,
      maxBuffer: 8 * 1024 * 1024,
      timeout: timeoutMs,
    });

    return { code: 0, stderr, stdout };
  } catch (error) {
    return { code: error.code ?? 1, stderr: error.stderr ?? message(error), stdout: error.stdout ?? '' };
  }
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Reach the panel, and say plainly when it is not there — every tool depends on it being up. */
async function panelFetch(method, path, body) {
  let response;
  try {
    response = await fetch(`${PANEL}${path}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      method,
    });
  } catch (error) {
    throw new Error(`the panel is not answering at ${PANEL} — start it with \`npm run panel\``, { cause: error });
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const DEPS = { env: process.env, exec: execInRepo, panel: panelFetch };

/**
 * JSON-RPC over POST, for a Claude that is not on this phone.
 *
 * Localhost-bound and token-gated, both for the same reason: what this serves is the phone's build system,
 * and the moment it is reachable it is reachable by whoever finds the URL.
 */
function serveHttp(port) {
  const token = process.env.PANEL_MCP_TOKEN ?? randomBytes(24).toString('hex');
  createServer((request, response) => {
    const authorized = request.headers.authorization === `Bearer ${token}`;
    if (!authorized) {
      response.writeHead(401, { 'content-type': 'application/json' });

      return response.end(JSON.stringify({ error: 'bearer token required' }));
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { 'content-type': 'application/json' });

      return response.end(JSON.stringify({ error: 'POST JSON-RPC to /mcp' }));
    }
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      void handleRpc(JSON.parse(body), DEPS).then((answer) => {
        response.writeHead(answer ? 200 : 202, { 'content-type': 'application/json' });
        response.end(answer ? JSON.stringify(answer) : '');
      });
    });
  }).listen(port, '127.0.0.1', () => {
    process.stdout.write(`opensa phone MCP on http://127.0.0.1:${port}/mcp\n`);
    process.stdout.write(`token: ${token}\n`);
    process.stdout.write(`panel: ${PANEL}\n`);
  });
}

/** Line-delimited JSON-RPC on stdin/stdout — the transport a Claude on this phone speaks. */
function serveStdio() {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let cut = buffer.indexOf('\n');
    while (cut >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (line !== '') {
        void handleRpc(JSON.parse(line), DEPS).then((answer) => {
          if (answer) {
            process.stdout.write(`${JSON.stringify(answer)}\n`);
          }
        });
      }
      cut = buffer.indexOf('\n');
    }
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  if (process.argv.includes('--http')) {
    const flag = process.argv.indexOf('--port');
    serveHttp(flag > 0 ? Number(process.argv[flag + 1]) : 8788);
  } else {
    serveStdio();
  }
}
