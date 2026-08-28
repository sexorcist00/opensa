/**
 * "Somebody else is holding your phone" — the console saying, on itself, that an agent is driving it.
 *
 * This exists because of a device fact rather than a design one. Android freezes a tab that is not in front:
 * the map stops polling, the panel calls it detached after 15 s, and a command already handed over is never
 * answered (measured 2026-08-28 — two screenshots died that way, minutes after a snapshot had gone through).
 * So while an agent reads this console the operator has to hold still, and before this band the only way to
 * learn that the run was over was to ask the agent in a chat and be told.
 *
 * Three states and one job each: `held` says do not leave, `busy` says something is being answered right
 * now, and `released` says the phone is yours again — which is the one the operator is actually waiting for,
 * so it is the accent rather than the warning, and it buzzes the device where the browser allows it.
 */
import { type ReactElement, useEffect } from 'react';

import type { AgentStatus } from '../world/agent-link';

import { styles } from './styles';

/** Long enough to feel deliberate against a notification's single tick, short enough not to read as an alarm. */
const RELEASE_BUZZ_MS = [120, 60, 120];

export function AgentBand({ compact, status }: { compact: boolean; status: AgentStatus }): ReactElement {
  const done = status.activity === 'released';

  // Best effort by nature: `navigator.vibrate` needs the page to have been interacted with in some browsers,
  // and a page an agent opened may never have been touched at all. The band is the signal that always works;
  // this is the one that reaches a phone lying face down.
  useEffect(() => {
    if (!done) {
      return;
    }
    try {
      navigator.vibrate?.(RELEASE_BUZZ_MS);
    } catch {
      // A browser that refuses to buzz is not a reason to stop showing the line that says the run is over.
    }
  }, [done]);

  return (
    <div style={done ? { ...styles.agentBand, ...styles.agentBandDone } : styles.agentBand}>
      {label(status, compact)}
    </div>
  );
}

/** What the band reads. Shorter on a phone — the same sentence, not a second component. */
function label(status: AgentStatus, compact: boolean): string {
  switch (status.activity) {
    case 'busy':
      return compact ? 'AGENT READING…' : 'AGENT READING THIS CONSOLE…';
    case 'released':
      return status.note === ''
        ? compact
          ? 'DONE — you can switch away'
          : 'DONE — the agent has finished, you can switch away'
        : `DONE — ${status.note}`;
    default:
      return compact ? 'AGENT ATTACHED — keep this tab in front' : 'AN AGENT IS ATTACHED — keep this tab in front';
  }
}
