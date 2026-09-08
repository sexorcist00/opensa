/**
 * The phone sheet: the two side panels as a drawer OVER the map, behind a tab strip.
 *
 * A dispatcher on a phone is looking at ONE list at a time — the queue when calls are coming in, the roster
 * when deciding who rolls. Showing both at a third of the height each would make neither readable, so the tab
 * carries the count and the operator picks.
 *
 * **And sometimes neither.** The strip collapses to its own tabs, which keeps both counts on screen — the
 * two numbers a dispatcher actually watches — and gives the rest of the map back to look at.
 *
 * **It floats over the map rather than sitting under it, since 2026-09-08** (the operator's report). As a
 * grid row it took its height out of the map's track, so every open and close resized the map: the camera
 * reframed, the render targets were rebuilt, and the CSS box the symbology is drawn in moved — one toggle
 * moving both the picture and the measurement (`world/capture-box.ts`, `ui/styles.ts` → `sheet`). Now the
 * map keeps its whole height and an open list covers its lower part, which is what the desk's floating
 * windows have always done to it.
 */
import { type ReactElement, useState } from 'react';

import type { Incident, Selection, Unit } from '../ops/types';

import { IncidentsPanel } from './incidents-panel';
import { styles, TOUCH_TARGET } from './styles';
import { UnitsPanel } from './units-panel';

type Tab = 'calls' | 'units';

export function Sheet({
  incidents,
  now,
  onLocateIncident,
  onLocateUnit,
  onSelect,
  selection,
  short = false,
  touch = false,
  units,
}: {
  incidents: readonly Incident[];
  now: number;
  onLocateIncident: (incident: Incident) => void;
  onLocateUnit: (unit: Unit) => void;
  onSelect: (selection: Selection) => void;
  selection: Selection;
  /** The viewport is too short to open on a list: start collapsed, with the counts still on screen. Since
   *  the sheet floats it no longer starves the map, but at its cap in landscape it covers most of it — so
   *  the rule holds for what an operator SEES rather than for what the map is given. */
  short?: boolean;
  /** The pointer is a finger: the tab strip takes a finger-sized target. */
  touch?: boolean;
  units: readonly Unit[];
}): ReactElement {
  const [tab, setTab] = useState<Tab>('calls');
  const [open, setOpen] = useState(!short);
  const tabStyle = touch ? styles.sheetTabTouch : styles.sheetTab;
  /** Tapping the tab you are already on closes the list; tapping the other one switches and opens it. */
  const pick = (next: Tab): void => {
    setOpen(next === tab ? !open : true);
    setTab(next);
  };
  const openCalls = incidents.filter((incident) => incident.status !== 'closed').length;
  const free = units.filter((unit) => unit.status === 'available').length;

  return (
    <div style={styles.sheet}>
      <div style={styles.sheetTabs}>
        <button
          aria-expanded={open && tab === 'calls'}
          onClick={() => pick('calls')}
          style={{ ...tabStyle, ...(tab === 'calls' ? styles.sheetTabActive : {}) }}
          type="button"
        >
          CALLS · {openCalls}
        </button>
        <button
          aria-expanded={open && tab === 'units'}
          onClick={() => pick('units')}
          style={{ ...tabStyle, ...(tab === 'units' ? styles.sheetTabActive : {}) }}
          type="button"
        >
          UNITS · {free}/{units.length}
        </button>
        <button
          aria-label={open ? 'Hide the list' : 'Show the list'}
          onClick={() => setOpen(!open)}
          style={{ ...tabStyle, flex: 'none', minWidth: TOUCH_TARGET }}
          type="button"
        >
          {open ? '▾' : '▴'}
        </button>
      </div>
      {!open ? null : tab === 'calls' ? (
        <IncidentsPanel
          incidents={incidents}
          now={now}
          onLocate={onLocateIncident}
          onSelect={onSelect}
          selection={selection}
        />
      ) : (
        <UnitsPanel
          incidents={incidents}
          onLocate={onLocateUnit}
          onSelect={onSelect}
          selection={selection}
          units={units}
        />
      )}
    </div>
  );
}
