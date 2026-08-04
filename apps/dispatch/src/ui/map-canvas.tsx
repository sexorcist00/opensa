/**
 * The map surface: the WebGPU canvas the engine draws the city on, and the 2D canvas the symbology is drawn
 * on, stacked. The 2D layer is `pointer-events: none` — every gesture belongs to the engine canvas underneath,
 * which is also what hit-tests the symbology, so there is exactly one input owner.
 */
import { type ReactElement, useEffect, useRef, useState } from 'react';

import type { GtaGround } from '../map/coords';
import type { Operations, Selection } from '../ops/types';
import type { DispatchActions } from '../ops/use-operations';
import type { DispatchHandle, DispatchReadout } from '../world/boot';

import { bootDispatch } from '../world/boot';
import { COLORS, styles } from './styles';

/** Module scope, so StrictMode's dev double-mount boots the engine on the canvas exactly once. */
let booted: null | Promise<DispatchHandle | void> = null;

export function MapCanvas({
  actions,
  children,
  onReadout,
  onReady,
  read,
}: {
  actions: DispatchActions;
  /** Rendered inside the map's positioned wrapper — the selection panel floats over the canvas. */
  children?: React.ReactNode;
  onReadout: (readout: DispatchReadout) => void;
  onReady: (handle: DispatchHandle) => void;
  read: { ops: () => Operations; selection: () => Selection };
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState('');

  // Callbacks reach the loop through a ref so the boot effect never re-runs: re-booting the engine on a
  // re-render would leak a device and a streaming worker per render.
  const liveRef = useRef({ actions, onReadout, read });
  liveRef.current = { actions, onReadout, read };

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) {
      return;
    }
    booted ??= bootDispatch({
      canvas,
      onClick: (click) => {
        const { select } = liveRef.current.actions;
        if (click.kind === 'ground') {
          select(null);
        } else if (click.kind === 'world') {
          select({ at: click.at, kind: 'world', model: click.model, txd: click.txd });
        } else {
          select({ id: click.id, kind: click.kind });
        }
      },
      onGround: (at: GtaGround) => liveRef.current.actions.createAt(at),
      onReadout: (readout) => liveRef.current.onReadout(readout),
      ops: () => liveRef.current.read.ops(),
      overlay,
      selection: () => liveRef.current.read.selection(),
    }).catch((error: unknown) => {
      // eslint-disable-next-line no-console -- a dead canvas must say why, in the console as well as on it
      console.error('[dispatch] boot failed', error);
      setFailed(String(error));
    });
    void booted.then((handle) => {
      if (handle) {
        onReady(handle);
      }
    });
  }, [onReady]);

  return (
    <div style={styles.canvasWrap}>
      <canvas ref={canvasRef} style={styles.canvas} />
      <canvas ref={overlayRef} style={{ ...styles.fill, pointerEvents: 'none', zIndex: 2 }} />
      {children}
      {failed && <BootFailure message={failed} />}
    </div>
  );
}

/** A dead map explains itself: the two things that actually go wrong are no WebGPU and no built pak. */
function BootFailure({ message }: { message: string }): ReactElement {
  return (
    <div style={{ ...styles.fill, display: 'grid', placeItems: 'center', zIndex: 4 }}>
      <div style={{ ...styles.detail, maxWidth: 560, position: 'static' }}>
        <div style={{ color: COLORS.danger, fontSize: 13, fontWeight: 700, paddingBottom: 8 }}>Map unavailable</div>
        <div style={{ ...styles.mono, fontSize: 11, lineHeight: 1.6, wordBreak: 'break-word' }}>{message}</div>
        <div style={{ color: COLORS.muted, lineHeight: 1.7, paddingTop: 10 }}>
          This surface needs two things: a browser with <strong>WebGPU</strong> (there is no fallback renderer), and a{' '}
          <strong>built game</strong> to stream. Build one with <code>npm run build:game:original:opensa</code>, or
          point the app at an existing build with <code>?src=build/&lt;game&gt;</code>.
        </div>
      </div>
    </div>
  );
}
