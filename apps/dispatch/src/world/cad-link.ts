/**
 * The seam a CAD talks to the console through (204/3-02).
 *
 * **This is the `cad` category, and the console does not own it**
 * ([the contract](../../../../docs/contracts/panel-audio.md)): a panic button, an assistance request, a
 * plate read and a simplex exchange are all things the CAD knows and the board does not carry. They arrive
 * as MESSAGES, and this is where a message becomes a sound.
 *
 * **The sound is an explicit field and never the title's text.** PCAD picks its sound today by searching the
 * notification's title, so rewording, translating or fixing a typo in it stops the sound — silently, with
 * the notification still appearing exactly as before. The contract replaces that with a `sound` field, and
 * this side holds up its half: a message that carries one is played by NAME, and one that does not falls
 * back to `notification` and is COUNTED, because *the CAD stopped naming its sounds* and *the CAD went quiet*
 * look identical from here otherwise.
 *
 * **The link's own two events are derived rather than sent**, for the reason a dropped link cannot send
 * anything: `link_lost` and `link_back` come from this side noticing. And nothing is announced until a CAD
 * has actually connected once — the same rule [the agent link](./agent-link.ts) learned, where a state
 * claimed before anyone answered is a claim rather than a reading. A console that has never had a CAD is not
 * a console whose CAD is down.
 */

/** What a capture says about the link. */
export interface CadLinkReport {
  /**
   * Messages that arrived with no `sound` field and were played as `notification`.
   *
   * A rising count is a CAD on the old wiring, which is worth knowing precisely because everything still
   * makes a sound — the failure it hides is *every event now chimes the same*.
   */
  readonly assumed: number;
  readonly delivered: number;
  /** Whether a CAD is currently answering. `null` before one ever has. */
  readonly online: boolean | null;
}

/** A message from the CAD, in the contract's shape. Anything else it carries is not this layer's business. */
export interface CadMessage {
  readonly body?: string;
  /** The event name, from the contract's table. Absent is a CAD that has not adopted the field yet. */
  readonly sound?: string;
  readonly title: string;
}

/** What a message resolved to, and whether the name was carried or assumed. */
export interface CadSound {
  readonly assumed: boolean;
  readonly name: string;
}

/** The name a message with no `sound` field is played under — the contract's own fallback. */
export const ASSUMED_SOUND = 'notification';

/** Whatever raises panel events; `DispatchAudio` is the one that does. */
export interface PanelSurface {
  event: (name: string, atMs?: number) => void;
}

/** The console's end of the CAD link: messages in, panel events out, and a report of what arrived. */
export class CadLink {
  private assumed = 0;
  private delivered = 0;
  private online: boolean | null = null;
  private readonly surface: PanelSurface;

  constructor(surface: PanelSurface) {
    this.surface = surface;
  }

  /**
   * Play one message.
   *
   * @param atMs when the CAD RAISED it, if the message carries that. Absent, now — which makes the latency
   *   number the time from arrival rather than from the event, and understates it by the wire.
   */
  deliver(message: CadMessage, atMs?: number): void {
    const sound = cadSound(message);
    this.delivered += 1;
    if (sound.assumed) {
      this.assumed += 1;
    }
    this.surface.event(sound.name, atMs);
  }

  report(): CadLinkReport {
    return { assumed: this.assumed, delivered: this.delivered, online: this.online };
  }

  /** Tell the link whether a CAD is answering. The first call only records; a CHANGE is what sounds. */
  setOnline(online: boolean): void {
    if (this.online === online) {
      return;
    }
    const first = this.online === null;
    this.online = online;
    if (first) {
      // Connecting for the first time is not "the link came back", and failing to connect at all is not
      // "the link dropped" — there was no link to drop.
      return;
    }
    this.surface.event(online ? 'link_back' : 'link_lost');
  }
}

/** Which sound a message asks for, and whether it actually asked. */
export function cadSound(message: CadMessage): CadSound {
  const named = message.sound?.trim() ?? '';

  return named === '' ? { assumed: true, name: ASSUMED_SOUND } : { assumed: false, name: named };
}
