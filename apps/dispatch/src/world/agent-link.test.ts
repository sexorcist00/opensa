/**
 * The status half of the link, which is the half an OPERATOR reads.
 *
 * The rest of this module is exercised by driving a real page from the panel; what a test has to hold is the
 * part that is silent when it is wrong. A band that claims an agent is attached when no panel answered would
 * tell somebody to hold their phone still for nothing, and a release that stopped sticking would flip them
 * back to "hold still" on the panel's very next idle poll — both look like a working console.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentStatus, AgentSurface } from './agent-link';

import { startAgentLink } from './agent-link';

/** A surface that answers everything with nothing: this suite is about the link, not the console. */
const SURFACE: AgentSurface = {
  errors: (): readonly string[] => [],
  image: (): Promise<Blob | null> => Promise.resolve(null),
  inventory: (): unknown => null,
  mode: () => null,
  moveTo: (): void => undefined,
  ops: (): unknown => null,
  readout: (): unknown => null,
  setMode: (): void => undefined,
};

/** One instruction, as the panel hands it over. */
interface Queued {
  readonly args?: Record<string, unknown>;
  readonly kind: string;
}

/** What the operator would be looking at when the loop stopped. */
function last(seen: readonly AgentStatus[]): AgentStatus | undefined {
  return seen[seen.length - 1];
}

/**
 * A panel that hands out `commands` in order and then stays quiet, the way a real long-poll does when nobody
 * is asking for anything.
 */
function panel(commands: readonly Queued[]): typeof fetch {
  let next = 0;

  return vi.fn((input: unknown): Promise<unknown> => {
    if (String(input).includes('/api/map/poll')) {
      const command = commands[next];
      next += 1;

      return Promise.resolve({
        json: () => Promise.resolve({ command: command ? { args: {}, id: next, ...command } : null }),
      });
    }

    return Promise.resolve({ json: () => Promise.resolve({ accepted: true }) });
  }) as unknown as typeof fetch;
}

/** Let the link's loop run until it has settled — every hop in it is a resolved promise, never a timer. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.stubGlobal('window', { location: { href: 'http://localhost:3001/dispatch.html?agent=1' } });
});

describe('startAgentLink', () => {
  describe('negative cases', () => {
    it('reports nothing at all while no panel answers, so a shared link never claims an agent', async () => {
      const seen: AgentStatus[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('connection refused'))),
      );

      const link = startAgentLink('http://localhost:8787', SURFACE, (status) => seen.push(status));
      await settle();
      link.stop();

      expect(seen).toEqual([]);
    });

    it('does not fall back to "hold still" on the idle poll after a release', async () => {
      const seen: AgentStatus[] = [];
      vi.stubGlobal('fetch', panel([{ args: { note: 'capture filed' }, kind: 'release' }]));

      const link = startAgentLink('http://localhost:8787', SURFACE, (status) => seen.push(status));
      await settle();
      link.stop();

      expect(last(seen)).toEqual({ activity: 'released', note: 'capture filed' });
      expect(seen.filter((status) => status.activity === 'held')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('says the tab is held once a panel has answered a poll', async () => {
      const seen: AgentStatus[] = [];
      vi.stubGlobal('fetch', panel([]));

      const link = startAgentLink('http://localhost:8787', SURFACE, (status) => seen.push(status));
      await settle();
      link.stop();

      expect(seen[0]).toEqual({ activity: 'held', note: '' });
    });

    it('marks the page busy while a command is being answered', async () => {
      const seen: AgentStatus[] = [];
      vi.stubGlobal('fetch', panel([{ kind: 'errors' }]));

      const link = startAgentLink('http://localhost:8787', SURFACE, (status) => seen.push(status));
      await settle();
      link.stop();

      expect(seen.map((status) => status.activity)).toContain('busy');
    });

    it('takes the page back when the agent asks for something after releasing it', async () => {
      const seen: AgentStatus[] = [];
      vi.stubGlobal('fetch', panel([{ kind: 'release' }, { kind: 'errors' }]));

      const link = startAgentLink('http://localhost:8787', SURFACE, (status) => seen.push(status));
      await settle();
      link.stop();

      expect(last(seen)).toEqual({ activity: 'held', note: '' });
    });
  });
});
