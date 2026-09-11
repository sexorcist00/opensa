/**
 * What every panel event looks like (204/3-03).
 *
 * **This is the other half of [DESIGN.md](../../DESIGN.md)'s redundancy rule** — *any one channel read
 * alone is enough* — applied to sound, which is the channel most likely to be missing. An operator may have
 * muted the console, be on a browser with no Web Audio, be wearing no headphones in a room where sound is
 * rude, or be in plan mode with no audio object at all. **A dispatch event that exists only as a tone is an
 * event those four operators never receive**, and that is also the whole defence of making sound ON by
 * default: it adds a channel rather than carrying one alone.
 *
 * **The `map` events already have their counterpart and it is not here.** A call appearing, a unit
 * committing, a unit reaching its scene and a call clearing are all drawn by the board itself — the queue
 * row, the map symbol, the unit's status, the call log — so a second line saying so would be chrome over the
 * thing it is reporting. What had NO visual at all was the `cad` category, because nothing on the console
 * knows those events except the sound they made.
 *
 * **The words live here rather than beside the names** ([`panel-events.ts`](../../../../packages/audio/src/panel-events.ts)):
 * that table maps a name to a BUS, which is engine-level and has no business holding an operator's sentence
 * in one language. A name with no sentence still shows — as the name — because a vocabulary the console has
 * not caught up with is exactly the case an operator should be able to see and report.
 */
import type { ReactElement } from 'react';

import { FLOORED } from '@opensa/audio';

import type { PanelNotice } from '../ops/use-cad';

import { styles } from './styles';

/* eslint-disable camelcase -- CONTRACT names, shared verbatim with PCAD's trigger table. Renaming one here
   silently stops matching the other repository, which is what the contract exists to prevent. */

/** What each event says on screen. A name absent from this table is shown as itself rather than swallowed. */
const WORDS: Readonly<Record<string, string>> = {
  alpr_hit: 'ALPR hit',
  assist_request: 'Assistance requested',
  bolo_new: 'New BOLO',
  link_back: 'CAD link restored',
  link_lost: 'CAD LINK LOST',
  notification: 'CAD notification',
  panic_button: 'PANIC BUTTON',
  simplex_accepted: 'Simplex accepted',
  simplex_declined: 'Simplex declined',
  simplex_request: 'Simplex requested',
};

/* eslint-enable camelcase */

/** The sentence for an event name, or the name itself. Exported because it is the whole of the text path. */
export function noticeText(name: string): string {
  return WORDS[name] ?? name;
}

export function PanelNotices({ notices }: { readonly notices: readonly PanelNotice[] }): null | ReactElement {
  if (notices.length === 0) {
    return null;
  }

  return (
    <div style={styles.panelNotices}>
      {notices.map((notice) => (
        <div key={notice.id} style={FLOORED.has(notice.name) ? styles.agentNoticeFailed : styles.agentNotice}>
          {noticeText(notice.name)}
        </div>
      ))}
    </div>
  );
}
