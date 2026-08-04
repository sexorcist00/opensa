/**
 * The board, as React owns it. The simulation ticks here; the map loop reads the same snapshot through the
 * stable getters in `read`, so the 60 fps loop never subscribes to React and React never re-renders per frame.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GtaGround } from '../map/coords';
import type { Operations, Selection } from './types';

import { initialOperations } from './seed';
import { assignUnit, clearUnit, createIncidentAt, stepOperations } from './sim';

/** Simulation tick. 20 Hz is smooth on the map and cheap for the panels; the render loop is independent. */
const TICK_MS = 50;

export interface DispatchActions {
  assign: (unitId: string, incidentId: string) => void;
  clear: (unitId: string) => void;
  createAt: (at: GtaGround) => void;
  select: (selection: Selection) => void;
  setAutoDispatch: (enabled: boolean) => void;
}

export interface DispatchStore {
  readonly actions: DispatchActions;
  readonly autoDispatch: boolean;
  readonly ops: Operations;
  /** Stable getters for the render loop — identity never changes, so the host binds them once. */
  readonly read: { ops: () => Operations; selection: () => Selection };
  readonly selection: Selection;
}

export function useOperations(): DispatchStore {
  const [ops, setOps] = useState<Operations>(() => initialOperations(performance.now()));
  const [selection, setSelection] = useState<Selection>(null);
  const [autoDispatch, setAutoDispatch] = useState(true);

  const opsRef = useRef(ops);
  const selectionRef = useRef(selection);
  const autoRef = useRef(autoDispatch);
  opsRef.current = ops;
  selectionRef.current = selection;
  autoRef.current = autoDispatch;

  useEffect(() => {
    const timer = window.setInterval(() => {
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
  }, []);

  const createAt = useCallback((at: GtaGround): void => {
    setOps((previous) => createIncidentAt(previous, at, performance.now(), Math.random));
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
    () => ({ ops: (): Operations => opsRef.current, selection: (): Selection => selectionRef.current }),
    [],
  );

  return { actions, autoDispatch, ops, read, selection };
}
