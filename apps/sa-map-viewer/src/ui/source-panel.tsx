import { CELL_SIZE } from '@opensa/cell-weld/cell-size';
import { styles } from '@opensa/web/ui/debug/debug-styles';
import { type ReactElement, useMemo } from 'react';

import type { MapSourceController } from '../source/use-map-source';
import type { ViewerReadout } from '../world/viewer-host';

import { mapStats } from '../source/map-source';

/**
 * The permanent left panel (plan 094): pick the source, then read back what was resolved and what the camera
 * is looking at. The SOURCE line is the important one — it is what makes a capture from this tool
 * self-describing. Phase 2 mounts the cell grid (`MapInspector`) underneath it.
 */
export function SourcePanel({
  controller,
  readout,
}: {
  controller: MapSourceController;
  readout: null | ViewerReadout;
}): ReactElement {
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
          <Stat label="cells" value={`${stats.cells} @ ${CELL_SIZE}`} />
          <Stat label="instances" value={stats.instances} />
          <Stat label="hd / lod" value={`${stats.hd} / ${stats.lod}`} />
          <Stat label="models" value={stats.models} />
          <Stat label="resolve" value={`${state.ms} ms`} />
        </>
      )}

      {readout && (
        <>
          <div style={styles.divider} />
          <div style={styles.hint}>VIEW</div>
          <Stat label="cell" value={`${readout.cell.cx},${readout.cell.cy}`} />
          <Stat
            label="at"
            value={`${readout.pose.at[0].toFixed(0)},${readout.pose.at[1].toFixed(0)} · h ${readout.pose.height.toFixed(0)}`}
          />
          <Stat label="pitch / yaw" value={`${degrees(readout.pose.pitch)}° / ${degrees(readout.pose.yaw)}°`} />
          <Stat label="weld" value={`${readout.load.weldMs} ms`} />
          <Stat
            label="textures"
            value={`${readout.load.arrays} × ${(readout.load.textures / 1024 / 1024).toFixed(1)} MB`}
          />
          <Stat label="tris" value={readout.load.indices / 3} />
          <Stat label="fps" value={readout.fps} />
        </>
      )}
    </div>
  );
}

function degrees(radians: number): string {
  return ((radians * 180) / Math.PI).toFixed(0);
}

function Stat({ label, value }: { label: string; value: number | string }): ReactElement {
  return (
    <div style={styles.statRow}>
      <span style={styles.hint}>{label}</span>
      <span style={styles.info}>{value}</span>
    </div>
  );
}
