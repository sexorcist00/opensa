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
  /**
   * Sinks that THREW while being handed an event.
   *
   * A count rather than a rethrow, because the sinks are independent channels and one of them is a speaker:
   * a dead `AudioContext` may not take the notice off the screen with it, which is the whole of
   * [DESIGN.md](../../DESIGN.md)'s redundancy rule applied to the wiring rather than to the pixels. It is
   * reported because a silently swallowed throw is how a channel stops working without anyone noticing.
   */
  readonly failed: number;
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

/** Somewhere an event goes. A sound is one of these; so is a line on the screen. */
export type PanelSink = (name: string, atMs?: number) => void;

/**
 * The console's end of the CAD link: messages in, event names out to every sink, and a report of what
 * arrived.
 *
 * **It belongs to the console rather than to its audio**, and that is the 3/03 rule in the object graph: an
 * event has to reach the SCREEN on a surface with no Web Audio, with the mix muted, and in plan mode, where
 * there is no audio object at all. A link owned by the speaker is a link a deaf console does not have.
 */
export class CadLink {
  private assumed = 0;
  private delivered = 0;
  private failed = 0;
  private online: boolean | null = null;
  private readonly sinks = new Set<PanelSink>();

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
    this.raise(sound.name, atMs);
  }

  /** Subscribe. The returned function unsubscribes, which is what a React effect hands back. */
  listen(sink: PanelSink): () => void {
    this.sinks.add(sink);

    return (): void => {
      this.sinks.delete(sink);
    };
  }

  report(): CadLinkReport {
    return { assumed: this.assumed, delivered: this.delivered, failed: this.failed, online: this.online };
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
    this.raise(online ? 'link_back' : 'link_lost');
  }

  private raise(name: string, atMs?: number): void {
    for (const sink of this.sinks) {
      try {
        sink(name, atMs);
      } catch {
        this.failed += 1;
      }
    }
  }
}

/** Which sound a message asks for, and whether it actually asked. */
export function cadSound(message: CadMessage): CadSound {
  const named = message.sound?.trim() ?? '';

  return named === '' ? { assumed: true, name: ASSUMED_SOUND } : { assumed: false, name: named };
}
