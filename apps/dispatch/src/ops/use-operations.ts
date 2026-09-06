/**
 * The board, as React owns it. The simulation ticks here; the map loop reads the same snapshot through the
 * stable getters in `read`, so the 60 fps loop never subscribes to React and React never re-renders per frame.
 *
 * Since 201/8-03 there are TWO boards in here and only one of them leaves: `live` is what the feed is doing
 * right now and what the history records, and `ops` is the board AT THE CLOCK — the same object while live,
 * and the reconstructed past while the operator is scrubbing. Everything downstream takes `ops` and cannot
 * tell which it was handed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GtaGround } from '../map/coords';
import type { Clock, PlaybackRate } from './clock';
import type { HistoryStats } from './history';
import type { Operations, Selection } from './types';

import { dispatchParams } from '../world/boot';
import { seedSize } from './budget';
import { addBookmark, advance, createClock, goLive, removeBookmark, scrubTo, setRate } from './clock';
import { boardTickMs, REPLAY_TICK_MS } from './feed-rate';
import { BoardHistory } from './history';
import { initialOperations } from './seed';
import { assignUnit, clearUnit, createIncidentAt, stepOperations } from './sim';
import { DEFAULT_HOUR, SA_HOURS_PER_SECOND, wrapHour } from './world-clock';

/**
 * The board's tick — the feed's publish rate, not a simulation rate (201/9-02).
 *
 * It was 50 ms with the comment *"20 Hz is smooth on the map and cheap for the panels; the render loop is
 * independent"*, and the render loop is NOT independent: `RenderGate` compares the board by identity and
 * `stepOperations` returns a fresh object every tick, so 20 Hz was a floor under render-on-demand. See
 * {@link boardTickMs}.
 */
const TICK_MS = boardTickMs(dispatchParams());

export interface DispatchActions {
  assign: (unitId: string, incidentId: string) => void;
  /** Mark the moment on screen so it can be returned to (201/8-03). */
  bookmark: (label: string) => void;
  clear: (unitId: string) => void;
  /** Open a call at a point. `district` is the world's own name for it (201/5-03), or null when the world
   *  ships none — the board then falls back to its landmark table. */
  createAt: (at: GtaGround, district?: null | string) => void;
  /** Back to following the wall clock. */
  live: () => void;
  removeBookmark: (t: number) => void;
  /** Drag the shift clock to a moment. Enters replay. */
  scrub: (t: number) => void;
  select: (selection: Selection) => void;
  setAutoDispatch: (enabled: boolean) => void;
  setRate: (rate: PlaybackRate) => void;
}

export interface DispatchStore {
  readonly actions: DispatchActions;
  readonly autoDispatch: boolean;
  readonly clock: Clock;
  /** The span a scrub may ask for, or null before anything was recorded. */
  readonly historyWindow: null | { newest: number; oldest: number };
  /** The board AT THE CLOCK — live while live, the reconstructed one while replaying. Nothing downstream
   *  knows the difference, which is the whole shape of 201/8-03. */
  readonly ops: Operations;
  /** Stable getters for the render loop — identity never changes, so the host binds them once. */
  readonly read: {
    /** How old each unit's last fix is, ms (201/8-02). Same rate and same source as {@link trails}. */
    fixAges: () => ReadonlyMap<string, number>;
    ops: () => Operations;
    selection: () => Selection;
    trackStats: () => HistoryStats;
    /** Each unit's current leg, GTA `x, y` pairs (201/8-04). Resolved at the board's tick, not the frame's. */
    trails: () => ReadonlyMap<string, Float32Array>;
  };
  readonly selection: Selection;
  /**
   * What the feed says the WORLD's day is doing, or null while nothing has said (201, 2026-09-06).
   *
   * The mock publishes it so the path is EXERCISED rather than hypothetical — the lesson this chain paid
   * most for is that a change can ship completely inert with every test passing. When PCAD carries the
   * field, this is where its value arrives and nothing downstream changes.
   *
   * It is deliberately NOT inside {@link Operations}: that object is the board and it is what replay
   * reconstructs, so a world hour inside it would be dragged backwards by a scrub — the confusion 201/8-03
   * separated the two clocks to prevent.
   */
  readonly worldTime: null | { hour: number; hoursPerSecond: number };
}

export function useOperations(): DispatchStore {
  // `?units=150&calls=40` opens the board at the declared worst case — the load 201/5-02's numbers are
  // taken at. Read once, in the initializer, so a re-render never reseeds the shift.
  const [live, setLive] = useState<Operations>(() => initialOperations(performance.now(), seedSize(dispatchParams())));
  const [selection, setSelection] = useState<Selection>(null);
  const [autoDispatch, setAutoDispatch] = useState(true);
  const [clock, setClock] = useState<Clock>(() => createClock(performance.now()));
  /**
   * The mock server's own day, republished on every board tick exactly as a real feed would.
   *
   * A fresh object per tick on purpose: the console anchors on the moment a message ARRIVED, so an
   * unchanged reference would be a server that never spoke again and a world that quietly stopped.
   */
  const [worldTime, setWorldTime] = useState<null | { hour: number; hoursPerSecond: number }>(null);

  // The time axis, owned beside the board rather than inside it: `Operations` is an immutable snapshot and
  // a ring buffer cannot be (see `tracks.ts`). One writer — the tick below.
  const historyRef = useRef<BoardHistory | null>(null);
  historyRef.current ??= new BoardHistory();
  const history = historyRef.current;

  // The board AT THE CLOCK. While live this IS the live board; while replaying it is the reconstructed one,
  // and every consumer below is handed it without knowing which — the whole substitution 8/03 is built on.
  const ops = useMemo(
    () => (clock.mode === 'live' ? live : history.at(clock.t, live)),
    [clock.mode, clock.t, history, live],
  );
  const historyWindow = history.window();
  // Resolved at the board's rate rather than the frame's: a trail only changes when a sample lands or the
  // clock moves, and the map redraws from the same object in between.
  const trails = useMemo(() => history.trails(ops.now), [history, ops]);
  const fixAges = useMemo(() => history.fixAges(ops.now), [history, ops]);

  const opsRef = useRef(ops);
  const trailsRef = useRef(trails);
  const fixAgesRef = useRef(fixAges);
  const liveRef = useRef(live);
  const selectionRef = useRef(selection);
  const autoRef = useRef(autoDispatch);
  opsRef.current = ops;
  trailsRef.current = trails;
  fixAgesRef.current = fixAges;
  liveRef.current = live;
  selectionRef.current = selection;
  autoRef.current = autoDispatch;

  // Two rates on one timer, and which one it runs at is the mode (201/9-02). The BOARD steps at the feed's
  // rate in both modes; the CLOCK needs a cadence of its own only while replaying, because playback is the
  // operator dragging time rather than the feed arriving. In `live` the clock is pinned to the wall clock by
  // `advance` and the timeline reads its span off the history window, so a slow tick costs it nothing.
  const replaying = clock.mode === 'replay';

  useEffect(() => {
    const tickMs = replaying ? Math.min(REPLAY_TICK_MS, TICK_MS) : TICK_MS;
    let lastBoard = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (now - lastBoard >= TICK_MS) {
        lastBoard = now;
        // The time axis (201/8-01) observes the board OUTSIDE the state updater. A side effect inside one is
        // run twice by StrictMode and again by any React retry, and a track written twice is a track that
        // cannot be scrubbed. What it reads is the snapshot React last rendered — one tick behind, which
        // against a 4 s sampling policy is nothing.
        // ALWAYS the live board, never the replayed one: recording what a scrub is showing would write the
        // past back into the history as if it had just happened.
        history.record(liveRef.current);
        // What a server would send WITH the board: the world hour and how fast its day runs. The mock keeps
        // SA's own — 24 hours in 24 real minutes — so the path a real feed will use is the path the console
        // actually runs today, rather than one that is only exercised when PCAD finally carries the field.
        setWorldTime({
          hour: wrapHour(DEFAULT_HOUR + (now / 1000) * SA_HOURS_PER_SECOND),
          hoursPerSecond: SA_HOURS_PER_SECOND,
        });
        setLive((previous) =>
          stepOperations(previous, {
            // The tick's NOMINAL length, never the measured gap: a tab Android froze for thirty seconds
            // would otherwise teleport every unit on the board when it came back.
            autoDispatch: autoRef.current,
            dtSeconds: TICK_MS / 1000,
            now,
            random: Math.random,
          }),
        );
      }
      setClock((previous) => advance(previous, now, tickMs, history.window()));
    }, tickMs);

    return (): void => window.clearInterval(timer);
  }, [history, replaying]);

  const createAt = useCallback((at: GtaGround, district: null | string = null): void => {
    setLive((previous) => createIncidentAt(previous, at, performance.now(), Math.random, district));
  }, []);

  const actions = useMemo<DispatchActions>(
    () => ({
      assign: (unitId, incidentId): void => setLive((previous) => assignUnit(previous, unitId, incidentId)),
      bookmark: (label): void => setClock((previous) => addBookmark(previous, label)),
      clear: (unitId): void => setLive((previous) => clearUnit(previous, unitId)),
      createAt,
      live: (): void => setClock((previous) => goLive(previous, performance.now())),
      removeBookmark: (t): void => setClock((previous) => removeBookmark(previous, t)),
      scrub: (t): void => setClock((previous) => scrubTo(previous, t, history.window())),
      select: setSelection,
      setAutoDispatch,
      setRate: (rate): void => setClock((previous) => setRate(previous, rate, history.window())),
    }),
    [createAt, history],
  );

  const read = useMemo(
    () => ({
      fixAges: (): ReadonlyMap<string, number> => fixAgesRef.current,
      ops: (): Operations => opsRef.current,
      selection: (): Selection => selectionRef.current,
      trackStats: (): HistoryStats => history.stats(),
      trails: (): ReadonlyMap<string, Float32Array> => trailsRef.current,
    }),
    [history],
  );

  return { actions, autoDispatch, clock, historyWindow, ops, read, selection, worldTime };
}
