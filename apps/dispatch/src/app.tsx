/**
 * The console. Three columns — calls, map, roster — with the selection panel floating over the map and the
 * renderer's own numbers along the bottom.
 *
 * The split that matters is between this tree and `world/boot.ts`: React owns the board and the chrome and
 * re-renders when the board changes; the engine owns the frame loop and never re-renders anything. They meet
 * at two stable getters and a readout pushed four times a second.
 */
import { type ReactElement, useCallback, useRef, useState } from 'react';

import type { GtaGround } from './map/coords';
import type { DispatchHandle, DispatchReadout } from './world/boot';

import { useOperations } from './ops/use-operations';
import { DetailPanel } from './ui/detail-panel';
import { IncidentsPanel } from './ui/incidents-panel';
import { MapCanvas } from './ui/map-canvas';
import { StatusBar } from './ui/status-bar';
import { styles } from './ui/styles';
import { TopBar } from './ui/top-bar';
import { UnitsPanel } from './ui/units-panel';

export function App(): ReactElement {
  const { actions, autoDispatch, ops, read, selection } = useOperations();
  const [readout, setReadout] = useState<DispatchReadout | null>(null);
  const handleRef = useRef<DispatchHandle | null>(null);

  const onReady = useCallback((next: DispatchHandle) => {
    handleRef.current = next;
  }, []);
  const locate = useCallback((at: GtaGround) => handleRef.current?.locate(at), []);
  const setHour = useCallback((hour: number) => handleRef.current?.setHour(hour), []);

  return (
    <div style={styles.app}>
      <TopBar
        autoDispatch={autoDispatch}
        hour={readout?.hour ?? 10}
        latest={ops.log[0]}
        onAutoDispatch={actions.setAutoDispatch}
        onHour={setHour}
      />

      <IncidentsPanel
        incidents={ops.incidents}
        now={ops.now}
        onLocate={(incident) => {
          actions.select({ id: incident.id, kind: 'incident' });
          locate(incident.at);
        }}
        onSelect={actions.select}
        selection={selection}
      />

      <MapCanvas actions={actions} onReadout={setReadout} onReady={onReady} read={read}>
        <DetailPanel actions={actions} onLocate={locate} ops={ops} selection={selection} />
      </MapCanvas>

      <UnitsPanel
        incidents={ops.incidents}
        onLocate={(unit) => {
          actions.select({ id: unit.id, kind: 'unit' });
          locate(unit.at);
        }}
        onSelect={actions.select}
        selection={selection}
        units={ops.units}
      />

      <StatusBar readout={readout} />
    </div>
  );
}
