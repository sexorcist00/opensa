/**
 * The console. On a desk: three columns — calls, map, roster — with the selection panel floating over the map
 * and the renderer's own numbers along the bottom. On a phone: the map fills the screen and the two lists move
 * into a tabbed sheet beneath it.
 *
 * The split that matters is between this tree and `world/boot.ts`: React owns the board and the chrome and
 * re-renders when the board changes; the engine owns the frame loop and never re-renders anything. They meet
 * at two stable getters and a readout pushed four times a second — which is also why the layout can flip
 * without the map noticing: nothing here is on the frame path.
 */
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';

import type { GtaGround } from './map/coords';
import type { KeyBindings } from './map/keymap';
import type { MapProjection } from './map/map-camera';
import type { Incident, Unit } from './ops/types';
import type { DispatchHandle, DispatchReadout } from './world/boot';

import { keyOf, loadBindings } from './map/keymap';
import { MAP_YAW } from './map/map-camera';
import { useOperations } from './ops/use-operations';
import { DetailPanel } from './ui/detail-panel';
import { IncidentsPanel } from './ui/incidents-panel';
import { KeyHelp } from './ui/key-help';
import { MapCanvas } from './ui/map-canvas';
import { MapNav } from './ui/map-nav';
import { MapTools } from './ui/map-tools';
import { Sheet } from './ui/sheet';
import { StatusBar } from './ui/status-bar';
import { styles } from './ui/styles';
import { TimelineBar } from './ui/timeline-bar';
import { TopBar } from './ui/top-bar';
import { UnitsPanel } from './ui/units-panel';
import { useCompactLayout } from './ui/use-compact';

export function App(): ReactElement {
  const { actions, autoDispatch, clock, historyWindow, ops, read, selection } = useOperations();
  const [readout, setReadout] = useState<DispatchReadout | null>(null);
  const handleRef = useRef<DispatchHandle | null>(null);
  const compact = useCompactLayout();

  const [handle, setHandle] = useState<DispatchHandle | null>(null);
  const [bindings, setBindings] = useState<KeyBindings>(() => loadBindings());
  const [keysOpen, setKeysOpen] = useState(false);
  const onReady = useCallback((next: DispatchHandle) => {
    handleRef.current = next;
    // The map tools need the handle as STATE, not a ref: they mount before the engine boots, and a ref does
    // not re-render them when it arrives (restrictions/architecture.md — the chrome mounts after boot).
    setHandle(next);
  }, []);
  const locate = useCallback((at: GtaGround) => handleRef.current?.locate(at), []);
  const setHour = useCallback((hour: number) => handleRef.current?.setHour(hour), []);
  // The sheet's key is the one command React owns: the map has no panel to open, and the input layer would
  // have to reach back into this tree to do it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as null | { isContentEditable?: boolean; tagName?: string };
      const typing =
        target?.isContentEditable === true || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName ?? '');
      if (
        !typing &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        bindings.toggleHelp.keys.includes(keyOf(event))
      ) {
        setKeysOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bindings]);

  const applyBindings = useCallback(
    (next: KeyBindings) => {
      setBindings(next);
      handle?.setBindings(next);
    },
    [handle],
  );
  const setProjection = useCallback((projection: MapProjection) => handleRef.current?.setProjection(projection), []);

  const locateIncident = (incident: Incident): void => {
    actions.select({ id: incident.id, kind: 'incident' });
    locate(incident.at);
  };
  const locateUnit = (unit: Unit): void => {
    actions.select({ id: unit.id, kind: 'unit' });
    locate(unit.at);
  };

  const map = (
    <MapCanvas actions={actions} onReadout={setReadout} onReady={onReady} read={read}>
      <MapTools compact={compact} following={readout?.following ?? false} handle={handle} selection={selection} />
      <MapNav handle={handle} yaw={readout?.pose.yaw ?? MAP_YAW} />
      <DetailPanel actions={actions} compact={compact} onLocate={locate} ops={ops} selection={selection} />
      {keysOpen && <KeyHelp bindings={bindings} onBindings={applyBindings} onClose={() => setKeysOpen(false)} />}
    </MapCanvas>
  );
  const timeline = (
    <TimelineBar
      clock={clock}
      compact={compact}
      onBookmark={() => actions.bookmark(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}
      onLive={actions.live}
      onRate={actions.setRate}
      onScrub={actions.scrub}
      window={historyWindow}
    />
  );
  const top = (
    <TopBar
      autoDispatch={autoDispatch}
      compact={compact}
      hour={readout?.hour ?? 10}
      latest={ops.log[0]}
      onAutoDispatch={actions.setAutoDispatch}
      onHour={setHour}
      onProjection={setProjection}
      projection={readout?.pose.projection ?? 'perspective'}
    />
  );

  if (compact) {
    return (
      <div style={styles.appCompact}>
        {top}
        {map}
        <Sheet
          incidents={ops.incidents}
          now={ops.now}
          onLocateIncident={locateIncident}
          onLocateUnit={locateUnit}
          onSelect={actions.select}
          selection={selection}
          units={ops.units}
        />
        {timeline}
        <StatusBar compact readout={readout} />
      </div>
    );
  }

  return (
    <div style={styles.app}>
      {top}

      <IncidentsPanel
        incidents={ops.incidents}
        now={ops.now}
        onLocate={locateIncident}
        onSelect={actions.select}
        selection={selection}
      />

      {map}

      <UnitsPanel
        incidents={ops.incidents}
        onLocate={locateUnit}
        onSelect={actions.select}
        selection={selection}
        units={ops.units}
      />

      {timeline}
      <StatusBar readout={readout} />
    </div>
  );
}
