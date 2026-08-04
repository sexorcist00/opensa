/**
 * The phone sheet: the two side panels, stacked under the map behind a tab strip.
 *
 * A dispatcher on a phone is looking at ONE list at a time — the queue when calls are coming in, the roster
 * when deciding who rolls. Showing both at a third of the height each would make neither readable, so the tab
 * carries the count and the operator picks.
 */
import { type ReactElement, useState } from 'react';

import type { Incident, Selection, Unit } from '../ops/types';

import { IncidentsPanel } from './incidents-panel';
import { styles } from './styles';
import { UnitsPanel } from './units-panel';

type Tab = 'calls' | 'units';

export function Sheet({
  incidents,
  now,
  onLocateIncident,
  onLocateUnit,
  onSelect,
  selection,
  units,
}: {
  incidents: readonly Incident[];
  now: number;
  onLocateIncident: (incident: Incident) => void;
  onLocateUnit: (unit: Unit) => void;
  onSelect: (selection: Selection) => void;
  selection: Selection;
  units: readonly Unit[];
}): ReactElement {
  const [tab, setTab] = useState<Tab>('calls');
  const open = incidents.filter((incident) => incident.status !== 'closed').length;
  const free = units.filter((unit) => unit.status === 'available').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={styles.sheetTabs}>
        <button
          onClick={() => setTab('calls')}
          style={{ ...styles.sheetTab, ...(tab === 'calls' ? styles.sheetTabActive : {}) }}
          type="button"
        >
          CALLS · {open}
        </button>
        <button
          onClick={() => setTab('units')}
          style={{ ...styles.sheetTab, ...(tab === 'units' ? styles.sheetTabActive : {}) }}
          type="button"
        >
          UNITS · {free}/{units.length}
        </button>
      </div>
      {tab === 'calls' ? (
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
