import { styles } from '@opensa/web/ui/debug/debug-styles';
import { type ReactElement, useMemo } from 'react';

import type { MapSourceController } from '../source/use-map-source';

import { mapStats, RENDER_CELL_SIZE } from '../source/map-source';

/**
 * The permanent left panel's SOURCE section (plan 094, phase 0): pick the folder to read, then read back what
 * was resolved. The source line is the important one — it is what makes a capture from this tool self-describing.
 * Phase 2 mounts the cell grid (`MapInspector`) underneath it.
 */
export function SourcePanel({ controller }: { controller: MapSourceController }): ReactElement {
  const { open, state } = controller;
  const stats = useMemo(() => (state.kind === 'ready' ? mapStats(state.map) : null), [state]);

  return (
    <div style={styles.panel}>
      <div style={styles.title}>SA-MAP-VIEWER</div>

      {state.kind === 'idle' && (
        <>
          <button onClick={() => open({ kind: 'folder' })} style={styles.actionButton} type="button">
            OPEN GAME FOLDER
          </button>
          <div style={styles.hint}>
            A raw GTA SA install (or a built game dir). Chromium only. A served dir loads without the picker:{' '}
            <code>?src=http://localhost:3001/game-src/original</code>
          </div>
        </>
      )}

      {state.kind === 'loading' && <div style={styles.hint}>reading gta.dat + IDE/IPL…</div>}

      {state.kind === 'error' && (
        <>
          <div style={styles.info}>{state.message}</div>
          <button onClick={() => open({ kind: 'folder' })} style={styles.actionButton} type="button">
            TRY ANOTHER FOLDER
          </button>
        </>
      )}

      {state.kind === 'ready' && stats && (
        <>
          <div style={styles.hint}>SOURCE</div>
          <div style={styles.info}>{state.map.label}</div>
          <div style={styles.divider} />
          <Stat label="cells" value={`${stats.cells} @ ${RENDER_CELL_SIZE}`} />
          <Stat label="instances" value={stats.instances} />
          <Stat label="hd / lod" value={`${stats.hd} / ${stats.lod}`} />
          <Stat label="models" value={stats.models} />
          <Stat label="resolve" value={`${state.ms} ms`} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }): ReactElement {
  return (
    <div style={styles.statRow}>
      <span style={styles.hint}>{label}</span>
      <span style={styles.info}>{value}</span>
    </div>
  );
}
