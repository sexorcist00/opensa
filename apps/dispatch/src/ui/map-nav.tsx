/**
 * The map's own controls (201/7-06): a compass that says which way north is and puts it back, plus zoom,
 * turn and tilt.
 *
 * Every one of them is a key as well, and that is the point rather than duplication: an operator on a phone
 * has no keyboard, an operator who has never read the key sheet has no keys, and a compass is the only thing
 * on screen that answers "which way am I facing" at all. They all go through the same handle methods the
 * keys go through, so the two cannot drift.
 *
 * The needle is an SVG rather than a glyph because it has to ROTATE with the view, and it is redrawn from
 * the readout — four times a second, off the frame path, like everything else in this tree.
 */
import type { ReactElement } from 'react';

import type { DispatchHandle } from '../world/boot';

import { MAP_YAW } from '../map/map-camera';
import { styles } from './styles';

/** One press of turn or tilt. An eighth of a turn is the smallest step that reads as a deliberate move. */
const TURN_STEP = Math.PI / 4;
const TILT_STEP = Math.PI / 12;

export function MapNav({ handle, yaw }: { handle: DispatchHandle | null; yaw: number }): ReactElement {
  const disabled = handle === null;

  return (
    <div style={styles.mapNav}>
      <button
        aria-label="Face north"
        disabled={disabled}
        onClick={() => handle?.faceNorth()}
        style={styles.mapNavCompass}
        title="Face north"
        type="button"
      >
        <Compass yaw={yaw} />
      </button>

      <div style={styles.mapNavRow}>
        <button
          aria-label="Turn left"
          disabled={disabled}
          onClick={() => handle?.turnBy(-TURN_STEP)}
          style={styles.mapNavKey}
          type="button"
        >
          ⟲
        </button>
        <button
          aria-label="Turn right"
          disabled={disabled}
          onClick={() => handle?.turnBy(TURN_STEP)}
          style={styles.mapNavKey}
          type="button"
        >
          ⟳
        </button>
      </div>

      <div style={styles.mapNavRow}>
        <button
          aria-label="Tilt towards the horizon"
          disabled={disabled}
          onClick={() => handle?.tiltBy(TILT_STEP)}
          style={styles.mapNavKey}
          type="button"
        >
          ▲
        </button>
        <button
          aria-label="Tilt towards the ground"
          disabled={disabled}
          onClick={() => handle?.tiltBy(-TILT_STEP)}
          style={styles.mapNavKey}
          type="button"
        >
          ▼
        </button>
      </div>

      <div style={styles.mapNavRow}>
        <button
          aria-label="Zoom in"
          disabled={disabled}
          onClick={() => handle?.zoomBySteps(1)}
          style={styles.mapNavKey}
          type="button"
        >
          +
        </button>
        <button
          aria-label="Zoom out"
          disabled={disabled}
          onClick={() => handle?.zoomBySteps(-1)}
          style={styles.mapNavKey}
          type="button"
        >
          −
        </button>
      </div>
    </div>
  );
}

/**
 * The rose. `MAP_YAW` is north-up, so what the needle shows is the view's departure from it — turn the map
 * east and the N ticks round to the left, which is the only reading that matches what is under it.
 */
function Compass({ yaw }: { yaw: number }): ReactElement {
  const degrees = ((MAP_YAW - yaw) * 180) / Math.PI;

  return (
    <svg height="34" viewBox="-20 -20 40 40" width="34">
      <circle cx="0" cy="0" fill="none" r="17" stroke="#2a3a4d" strokeWidth="1.5" />
      <g transform={`rotate(${degrees.toFixed(2)})`}>
        <polygon fill="#e5534b" points="0,-14 4.5,0 0,3 -4.5,0" />
        <polygon fill="#7d8ea1" points="0,14 4.5,0 0,-3 -4.5,0" />
        <text fill="#c9d6e4" fontSize="7" textAnchor="middle" y="-15.5">
          N
        </text>
      </g>
    </svg>
  );
}
