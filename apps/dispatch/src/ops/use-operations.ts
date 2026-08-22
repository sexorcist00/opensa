/**
 * The board, as React owns it. The simulation ticks here; the map loop reads the same snapshot through the
 * stable getters in `read`, so the 60 fps loop never subscribes to React and React never re-renders per frame.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GtaGround } from '../map/coords';
import type { TrackStats } from './tracks';
import type { Operations, Selection } from './types';

import { dispatchParams } from '../world/boot';
import { seedSize } from './budget';
import { initialOperations } from './seed';
import { assignUnit, clearUnit, createIncidentAt, stepOperations } from './sim';
import { UnitTracks } from './tracks';

/** Simulation tick. 20 Hz is smooth on the map and cheap for the panels; the render loop is independent. */
const TICK_MS = 50;

export interface DispatchActions {
  assign: (unitId: string, incidentId: string) => void;
  clear: (unitId: string) => void;
  /** Open a call at a point. `district` is the world's own name for it (201/5-03), or null when the world
   *  ships none — the board then falls back to its landmark table. */
  createAt: (at: GtaGround, district?: null | string) => void;
  select: (selection: Selection) => void;
  setAutoDispatch: (enabled: boolean) => void;
}

export interface DispatchStore {
  readonly actions: DispatchActions;
  readonly autoDispatch: boolean;
  readonly ops: Operations;
  /** Stable getters for the render loop — identity never changes, so the host binds them once. */
  readonly read: { ops: () => Operations; selection: () => Selection; trackStats: () => TrackStats };
  readonly selection: Selection;
}

export function useOperations(): DispatchStore {
  // `?units=150&calls=40` opens the board at the declared worst case — the load 201/5-02's numbers are
  // taken at. Read once, in the initializer, so a re-render never reseeds the shift.
  const [ops, setOps] = useState<Operations>(() => initialOperations(performance.now(), seedSize(dispatchParams())));
  const [selection, setSelection] = useState<Selection>(null);
  const [autoDispatch, setAutoDispatch] = useState(true);

  // The time axis, owned beside the board rather than inside it: `Operations` is an immutable snapshot and
  // a ring buffer cannot be (see `tracks.ts`). One writer — the tick below.
  const tracksRef = useRef<null | UnitTracks>(null);
  tracksRef.current ??= new UnitTracks();
  const tracks = tracksRef.current;

  const opsRef = useRef(ops);
  const selectionRef = useRef(selection);
  const autoRef = useRef(autoDispatch);
  opsRef.current = ops;
  selectionRef.current = selection;
  autoRef.current = autoDispatch;

  useEffect(() => {
    const timer = window.setInterval(() => {
      // The time axis (201/8-01) observes the board OUTSIDE the state updater. A side effect inside one is
      // run twice by StrictMode and again by any React retry, and a track written twice is a track that
      // cannot be scrubbed. What it reads is the snapshot React last rendered — one tick behind, which for
      // an observation at 20 Hz against a 4 s sampling policy is nothing.
      tracks.record(opsRef.current);
      setOps((previous) =>
        stepOperations(previous, {
          autoDispatch: autoRef.current,
          dtSeconds: TICK_MS / 1000,
          now: performance.now(),
          random: Math.random,
        }),
      );
    }, TICK_MS);

    return (): void => window.clearInterval(timer);
  }, [tracks]);

  const createAt = useCallback((at: GtaGround, district: null | string = null): void => {
    setOps((previous) => createIncidentAt(previous, at, performance.now(), Math.random, district));
  }, []);

  const actions = useMemo<DispatchActions>(
    () => ({
      assign: (unitId, incidentId): void => setOps((previous) => assignUnit(previous, unitId, incidentId)),
      clear: (unitId): void => setOps((previous) => clearUnit(previous, unitId)),
      createAt,
      select: setSelection,
      setAutoDispatch,
    }),
    [createAt],
  );

  const read = useMemo(
    () => ({
      ops: (): Operations => opsRef.current,
      selection: (): Selection => selectionRef.current,
      trackStats: (): TrackStats => tracks.stats(),
    }),
    [tracks],
  );

  return { actions, autoDispatch, ops, read, selection };
}
