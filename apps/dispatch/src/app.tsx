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
import { readView } from './map/view-link';
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
import { useCoarsePointer, useCompactLayout, useShortViewport } from './ui/use-compact';
import { dispatchParams } from './world/boot';

export function App(): ReactElement {
  const { actions, autoDispatch, clock, historyWindow, ops, read, selection } = useOperations();
  const [readout, setReadout] = useState<DispatchReadout | null>(null);
  const handleRef = useRef<DispatchHandle | null>(null);
  const compact = useCompactLayout();
  // Two different questions: how much room there is, and what is pointing at it. A phone in landscape is
  // wide and coarse; a small window on a desk is narrow and fine.
  const touch = useCoarsePointer();
  // A third question, and width cannot answer it: a phone in LANDSCAPE is wide enough to look roomy and too
  // short to spend any of it on a list nobody is reading.
  const short = useShortViewport();

  const [handle, setHandle] = useState<DispatchHandle | null>(null);
  const [bindings, setBindings] = useState<KeyBindings>(() => loadBindings());
  const [keysOpen, setKeysOpen] = useState(false);
  /**
   * An embedded console (`?embed=1`) is the MAP and its own controls, and nothing else: the host has its own
   * queue, roster and clock, and a second set of them inside an iframe is two boards disagreeing on one
   * screen. What it may do is stated in `docs/features/dispatch-console.md` rather than discovered by an
   * embedder — most of all that it never writes the address bar, which is not its to write.
   */
  const embedded = dispatchParams().get('embed') === '1';
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

  // A link that carried a moment opens on that moment (201/7-07). Once, on mount: a link is an OPENING
  // state, and re-applying it later would fight the operator every time they touched the timeline.
  useEffect(() => {
    const behindLive = readView(dispatchParams()).behindLive;
    if (behindLive !== undefined && behindLive > 0) {
      // `performance.now()`, not `Date.now()`: the shift clock runs on the monotonic timeline
      // (`use-operations.ts`), and mixing the two puts the scrub 57 years off with nothing to show for it
      // but an empty board.
      actions.scrub(performance.now() - behindLive * 1000);
    }
  }, [actions]);

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
    <MapCanvas actions={actions} compact={compact} onReadout={setReadout} onReady={onReady} read={read}>
      <MapTools
        behindLive={clock.mode === 'live' ? 0 : Math.max(0, Math.round((performance.now() - clock.t) / 1000))}
        compact={compact}
        following={readout?.following ?? false}
        handle={handle}
        measurement={readout?.measurement ?? null}
        selection={selection}
        tool={readout?.tool ?? 'none'}
        touch={touch}
      />
      <MapNav compact={compact} handle={handle} touch={touch} yaw={readout?.pose.yaw ?? MAP_YAW} />
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
      touch={touch}
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
      touch={touch}
    />
  );

  if (embedded) {
    return <div style={styles.appEmbedded}>{map}</div>;
  }

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
          short={short}
          touch={touch}
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
