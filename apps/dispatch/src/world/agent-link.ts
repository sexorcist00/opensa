/**
 * The map, answerable (201 tooling / phone-console plan 002).
 *
 * The development machine is a phone with no headless browser, so everything an agent knows about this
 * console has been a person describing a screen. This closes that: with `?agent=1` the page asks the phone
 * panel for commands and answers them with what it can already produce — the inventory report, its own PNG
 * of the situation, the readout, the error log — and takes a camera or a mode instruction back.
 *
 * **It is opt-in by query, and that is not timidity.** A page that phoned home to a local port because one
 * happened to answer would be a surprise on a shared link and a wrong answer on a desk where something else
 * owns 8787. `&agent=1` is on the panel's own links; nothing else carries it.
 *
 * **The page is the instrument.** No DevTools protocol, no `adb`, no pairing — the numbers an agent wants
 * are the ones the console already computes for `?inventory=1`, and the picture is the one `exportImage`
 * already composes for a link. What this adds is a way to ask for them from somewhere else.
 *
 * Long-poll, never a socket: a phone locks, Android kills the tab, the tunnel drops. A poll that comes back
 * with nothing after twenty seconds and starts again survives all three without a reconnect protocol of its
 * own; a failure just means the next poll is a second later.
 */
import type { MapPose } from '../map/map-camera';
import type { MapMode } from './mode-switch';

/** What the link can reach. Deliberately small: everything here already existed for something else. */
export interface AgentSurface {
  /** Every error the page logged since boot — a failure an agent must not have to be told about. */
  errors: () => readonly string[];
  /** The situation as a PNG (201/7-07's export), or null when there is no canvas to read. */
  image: () => Promise<Blob | null>;
  /** The `?inventory=1` report, or null when the collector is off. */
  inventory: () => unknown;
  /** Which surface is drawing, and how to change it (201/6-03). */
  mode: () => MapMode | null;
  /** Fly the camera to a pose, the way a bookmark does. */
  moveTo: (pose: MapPose) => void;
  /** The board as the operator has it: units, calls, the selection. */
  ops: () => unknown;
  /** The per-frame readout the chrome shows — fps, draws, resident MB, the pose. */
  readout: () => unknown;
  setMode: (mode: MapMode) => void;
}

/** One instruction from the panel. */
interface AgentCommand {
  readonly args: Record<string, unknown>;
  readonly id: number;
  readonly kind: string;
}

/** How long to wait before polling again after a failure — the panel restarting, the tunnel blinking. */
const RETRY_MS = 2000;

/** Start answering, until `stop()`. Safe to call when no panel is there: it simply keeps failing quietly. */
export function startAgentLink(panel: string, surface: AgentSurface): { stop: () => void } {
  let running = true;
  const loop = async (): Promise<void> => {
    while (running) {
      try {
        const command = await nextCommand(panel, surface);
        if (command) {
          await answer(panel, command, surface);
        }
      } catch {
        // A poll that failed says nothing about the next one: the panel may be restarting, the phone may
        // have slept, the tunnel may have blinked. Wait a beat rather than spinning on a dead port.
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  };
  void loop();

  return {
    stop: (): void => {
      running = false;
    },
  };
}

/** Do what was asked and hand back the answer — a failure is an ANSWER, so the agent reads why. */
async function answer(panel: string, command: AgentCommand, surface: AgentSurface): Promise<void> {
  let result: unknown;
  try {
    result = { ok: true, value: await run(command, surface) };
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error), ok: false };
  }
  await fetch(`${panel}/api/map/result`, {
    body: JSON.stringify({ id: command.id, result }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

/** The PNG as a data URI, which is how a picture survives a JSON hop. */
async function encodeImage(blob: Blob | null): Promise<null | string> {
  if (!blob) {
    return null;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}

/** Ask for the next command, carrying the heartbeat that says a map is here and what it is showing. */
async function nextCommand(panel: string, surface: AgentSurface): Promise<AgentCommand | null> {
  const readout = surface.readout() as null | { fps?: number };
  const query = new URLSearchParams({
    fps: String(Math.round(readout?.fps ?? 0)),
    mode: surface.mode() ?? '',
    url: window.location.href,
  });
  const response = await fetch(`${panel}/api/map/poll?${query.toString()}`);
  const body = (await response.json()) as { command: AgentCommand | null };

  return body.command;
}

/** What each command means. Everything here is a capability the console already had. */
async function run(command: AgentCommand, surface: AgentSurface): Promise<unknown> {
  switch (command.kind) {
    case 'errors':
      return surface.errors();
    case 'mode': {
      const wanted = command.args.mode === 'flat' ? 'flat' : 'live';
      surface.setMode(wanted);

      return { asked: wanted };
    }
    case 'ops':
      return surface.ops();
    case 'pose': {
      const pose = command.args.pose as MapPose | undefined;
      if (!pose) {
        throw new Error('pose: no pose given');
      }
      surface.moveTo(pose);

      return { flyingTo: pose };
    }
    case 'screenshot':
      return { image: await encodeImage(await surface.image()) };
    case 'snapshot':
      return { errors: surface.errors(), inventory: surface.inventory(), readout: surface.readout() };
    default:
      throw new Error(`unknown command '${command.kind}'`);
  }
}
