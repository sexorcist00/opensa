/**
 * Draw a frame when something changed, and not otherwise (201/4-01).
 *
 * A game's loop runs flat out because a game is always moving. A dispatch map is **idle for most of a
 * shift**, on a phone that runs hot and goes flat, and nothing in the engine knew the difference: the
 * console redrew a static city sixty times a second to show a queue that changed once a minute.
 *
 * **"Nothing changed" is a STATE this reads, never an event it can miss** — the trap the restrictions
 * already name in another form ([a framing decision taken on a threshold gets retaken next
 * frame](../../../../docs/restrictions/architecture.md)). Every wake compares the whole picture's inputs
 * against the ones the last DRAWN frame used; a signal that arrives while the loop is asleep is still there
 * when it looks, because it is a value rather than a notification. Waking on input only makes the answer
 * arrive sooner — it is never how the answer is found.
 *
 * **The latency budget, named before it was built:** the first frame after an operator's input is presented
 * in the next animation frame — one frame at the display's rate, not one idle period. That is what
 * {@link RenderGate.wake} is for: a pointer, a wheel or a key re-arms the fast schedule in its own handler,
 * so the idle period never sits between a thumb and the picture. A map that saves battery and feels sticky
 * under the thumb has failed.
 *
 * **What idle means for the world.** While nothing changes the picture is frozen — the palms stop swaying
 * and the scrollers stop scrolling, because the frame that would advance them is the frame we are choosing
 * not to spend. Nothing is CUT (the [protected list](../../../../docs/plans/201-dispatch-console/1-the-map-profile/protected-list.md)
 * is about what the build and the frame carry, not about a still map), and the first input resumes all of
 * it. If a field verdict says a frozen world reads as a hung one, the lever is an idle RATE rather than an
 * idle stop — recorded rather than assumed.
 */
import type { MapPose } from '../map/map-camera';
import type { Operations, Selection } from '../ops/types';

/**
 * Everything the picture depends on, gathered once a wake. Values only: two frames with equal signals are
 * two frames that would draw the same pixels.
 */
export interface FrameSignals {
  /** Drawing-buffer size, so a resize redraws even when nothing else moved. */
  readonly canvas: number;
  /** Cells created since boot (a running total) — the world is still filling in. */
  readonly created: number;
  /** Cells evicted since boot — geometry left the picture. */
  readonly evicted: number;
  /** The world hour the environment is showing. */
  readonly hour: number;
  /** The board, by identity: it is replaced whole on every tick and never mutated. */
  readonly ops: Operations;
  /** Cells still in flight — the picture is not finished while this is above zero. */
  readonly pending: number;
  readonly pose: MapPose;
  readonly selection: Selection;
  /** The sketch store's revision (201/7-05) — a tap that adds a point changes the picture. */
  readonly sketch: number;
  /**
   * Wind-animated geometry is in frame, so TIME changes the picture (201/4-04).
   *
   * **The one signal here that is not a value**, and the reason this gate needed a new kind of input at all.
   * Every field above is compared against the last drawn frame's; two equal frames draw equal pixels. Sway
   * is a clock — the world shader displaces a vertex against engine uptime — so nothing above ever changes
   * because the wind blew, and the palms moved only when something ELSE woke the frame. The operator's words
   * for that (2026-09-04) were *"once in a while rather than continuously, and that is critical"*, and the
   * user's were that it killed the world's liveliness.
   *
   * `Engine.stats.swayVisible` answers it: the wind is blowing AND a visible cell carries geometry it moves.
   * A view of a car park is still air and still rests.
   */
  readonly sways: boolean;
}

export class RenderGate {
  /**
   * Whether the BOARD changed for the decision this gate last took (201/9-03).
   *
   * The board layer — the beacons' twelve line buffers and the unit models' 150 root matrices — depends on
   * `ops` and `selection` and reads no camera, so panning an unchanged roster repeated all of it at the
   * display's rate. The gate already knows: it compared those two values one line earlier to decide whether
   * to draw at all, and this is that comparison kept rather than thrown away.
   *
   * **A FORCED frame counts as changed**, and that is not caution. {@link RenderGate.wake} is what a host
   * calls for a change the signals do not carry, and a unit model finishing its load is one: the type
   * arrives between frames and only the board layer's next pass claims an instance for it. Without this the
   * car would appear whenever the board next ticked, which after [9/02](../../../../docs/plans/201-dispatch-console/9-the-mobile-frame/readme.md)
   * is up to four seconds later.
   *
   * Read it AFTER {@link RenderGate.shouldDraw}: it describes that call's decision, and it is only
   * meaningful on a frame that drew.
   */
  get boardChanged(): boolean {
    return this.boardDirty;
  }

  /** Frames this gate has skipped since boot — the number `idle draws → 0` is read off. */
  get idleFrames(): number {
    return this.skipped;
  }
  private boardDirty = true;
  /** When the last frame was drawn — the animation rate is measured from it, not from a wall-clock grid. */
  private drawnAt = 0;

  private forced = true;

  private last: FrameSignals | null = null;

  private skipped = 0;

  /**
   * @param animationIntervalMs the shortest gap between two frames drawn for the WIND alone. 0 is the
   *   display's rate — what the 2026-09-05 verdict asked for; a larger number trades smoothness for rest.
   */
  constructor(private readonly animationIntervalMs = 0) {}

  /**
   * Whether the frame that is about to run must draw. Records the signals when it says yes.
   *
   * **`pending` is a PREDICATE, not a value to compare, and reading it as a value deadlocked the map.**
   * A cell's texture arrays finish uploading in `drainUploads`, which is budgeted at 1.5 ms and runs inside
   * `world.follow()` — that is, only on a DRAWN frame; `textures.has(ref)` stays false until the last write
   * lands, so the cell is not created and `pendingCells` does not move. Every other signal is equally
   * unchanged, so `same()` said "nothing happened", the gate rested, and the frame that would have finished
   * the upload never ran. The console then sat on a black map holding four fetched cells for as long as
   * nobody touched it — 19 drawn frames against 851 skipped in 86 s on the phone, `errors` empty
   * ([the open issue](../../../../docs/open-issues/dispatch-map-void-no-cells-created.md)).
   *
   * {@link FrameSignals.pending}'s own comment already said it — *"the picture is not finished while this is
   * above zero"* — and this is the line that makes the code agree with it. The cost is honest and small: a
   * world that never finishes arriving keeps the loop awake instead of resting on a picture that is wrong,
   * which is the trade a map surface should take.
   */
  shouldDraw(signals: FrameSignals, now = performance.now()): boolean {
    if (
      !this.forced &&
      this.last !== null &&
      signals.pending === 0 &&
      !this.animationDue(signals, now) &&
      same(this.last, signals)
    ) {
      this.skipped += 1;

      return false;
    }
    this.drawnAt = now;
    this.boardDirty =
      this.forced || this.last === null || this.last.ops !== signals.ops || this.last.selection !== signals.selection;
    this.forced = false;
    this.last = signals;

    return true;
  }

  /**
   * Draw the next frame whatever the signals say. For an input the loop cannot see as a value — a pointer
   * going down before it has moved anything — and for a host that has changed something the signals do not
   * cover (a new bindings table, a projection swap).
   */
  wake(): void {
    this.forced = true;
  }

  /**
   * Whether the wind alone is reason enough to draw this frame (201/4-04).
   *
   * **The rate is a NUMBER the surface reads, never a branch** — the same rule the render budget follows
   * ([the restriction](../../../../docs/restrictions/architecture.md)). At `animationIntervalMs` 0 a frame
   * with sway in it draws every wake, which is the display's rate and the smooth continuous render the
   * verdict asked for; a surface that would rather trade smoothness for battery names a period instead and
   * gets sway at that rate.
   *
   * **What it costs is stated rather than discovered**: on a view with foliage in it this is the whole of
   * [4/01](../../../../docs/plans/201-dispatch-console/4-a-console-is-not-a-game/readme.md)'s win, because
   * most of this map has foliage in it. That is the trade the operator's verdict chose, and 4/01's battery
   * figure has to be re-taken under it.
   */
  private animationDue(signals: FrameSignals, now: number): boolean {
    if (!signals.sways) {
      return false;
    }

    return now - this.drawnAt >= this.animationIntervalMs;
  }
}

function same(a: FrameSignals, b: FrameSignals): boolean {
  return (
    a.ops === b.ops &&
    a.selection === b.selection &&
    a.canvas === b.canvas &&
    a.hour === b.hour &&
    a.sketch === b.sketch &&
    a.pending === b.pending &&
    a.created === b.created &&
    a.evicted === b.evicted &&
    a.pose.at[0] === b.pose.at[0] &&
    a.pose.at[1] === b.pose.at[1] &&
    a.pose.height === b.pose.height &&
    a.pose.pitch === b.pose.pitch &&
    a.pose.yaw === b.pose.yaw &&
    a.pose.projection === b.pose.projection
  );
}
