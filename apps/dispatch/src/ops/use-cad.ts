import { FLOORED } from '@opensa/audio';
/**
 * The CAD feed, as React owns it (204/3-02, 3-03).
 *
 * **It is here rather than inside the audio because an event has to reach the SCREEN**
 * ([DESIGN.md](../../DESIGN.md): *any one channel read alone is enough*). A link owned by the speaker is a
 * link a muted console, a browser with no Web Audio and plan mode all do without — and plan mode is a real
 * surface, the one every non-WebGPU browser falls back to. So the link lives beside the board, both the
 * sound and the notices subscribe to it, and neither can take the other down.
 *
 * **The stand-in runs on this tick too**, which is the same reason: stepped on the audio clock it would stop
 * existing under `?audio=0`, and a capture of the silent baseline would then also be a capture with no CAD
 * in it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import type { Operations } from './types';

import { dispatchParams } from '../world/boot';
import { CadLink } from '../world/cad-link';
import { cadArm, CadMock } from '../world/cad-mock';

/** How often the stand-in is offered a turn. The mock draws against elapsed SECONDS, so this is not its rate. */
const STEP_MS = 500;

/**
 * How long a line stays.
 *
 * Long enough to read one line, short enough to be gone before the next — the agent band's own number, and
 * for the same reason: a notice an operator has to dismiss is a notice in the way of the map, and the map is
 * the product.
 */
export const HOLD_MS = 4_000;

/**
 * How long the two FLOORED names stay.
 *
 * The same two events a mute leaves audible are the two the screen holds longest, and the rule is one rule
 * rather than two: an operator who looked away for four seconds during a panic has missed the only report
 * of it, because a `cad` event is not on the board and nothing else on this console remembers it.
 */
export const FLOORED_HOLD_MS = 15_000;

/** One event as the screen holds it: the name, when it arrived, and a key nothing else will reuse. */
export interface PanelNotice {
  readonly atMs: number;
  readonly id: number;
  readonly name: string;
}

/** At most this many at once — a stack taller than this covers the map it is reporting on. */
export const MAX_NOTICES = 3;

export interface CadFeed {
  readonly link: CadLink;
  readonly notices: readonly PanelNotice[];
}

/** Whether a line's time is up. The FLOORED two are held far longer — see {@link FLOORED_HOLD_MS}. */
export function expired(notice: PanelNotice, now: number): boolean {
  return now - notice.atMs >= (FLOORED.has(notice.name) ? FLOORED_HOLD_MS : HOLD_MS);
}

export function useCad(ops: () => Operations): CadFeed {
  const link = useMemo(() => new CadLink(), []);
  const mock = useMemo(() => (cadArm(dispatchParams()) === 'on' ? new CadMock() : null), []);
  const [notices, setNotices] = useState<readonly PanelNotice[]>([]);
  const nextId = useRef(0);

  useEffect(
    () =>
      link.listen((name) => {
        nextId.current += 1;
        const notice = { atMs: performance.now(), id: nextId.current, name };
        setNotices((current) => [...current, notice].slice(-MAX_NOTICES));
      }),
    [link],
  );

  // One interval for the whole stack rather than a timer per line: a timer per line is a cleanup per line,
  // and this list is rebuilt on every arrival.
  useEffect(() => {
    const id = setInterval(() => {
      setNotices((current) => {
        const kept = current.filter((notice) => !expired(notice, performance.now()));

        return kept.length === current.length ? current : kept;
      });
    }, 500);

    return (): void => clearInterval(id);
  }, []);

  useEffect(() => {
    if (mock === null) {
      return;
    }
    const id = setInterval(() => {
      const said = mock.step(ops(), STEP_MS / 1_000);
      if (said) {
        // A CAD that is talking is a CAD that is answering, so the stand-in marks the seam up as it speaks.
        // It never fakes a DROP: `link_lost` is the loudest thing this console says, and a stand-in that
        // cried it would teach an operator to disbelieve the real one.
        link.setOnline(true);
        link.deliver(said);
      }
    }, STEP_MS);

    return (): void => clearInterval(id);
  }, [link, mock, ops]);

  return { link, notices };
}
