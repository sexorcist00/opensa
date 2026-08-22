/**
 * The map surface: the WebGPU canvas the engine draws the city on, and the 2D canvas the symbology is drawn
 * on, stacked. The 2D layer is `pointer-events: none` — every gesture belongs to the engine canvas underneath,
 * which is also what hit-tests the symbology, so there is exactly one input owner.
 */
import { type ReactElement, useEffect, useRef, useState } from 'react';

import type { GtaGround } from '../map/coords';
import type { TrackStats } from '../ops/tracks';
import type { Operations, Selection } from '../ops/types';
import type { DispatchActions } from '../ops/use-operations';
import type { BootOptions, DispatchHandle, DispatchReadout } from '../world/boot';

import { bootDispatch } from '../world/boot';
import { dispatchParams } from '../world/boot';
import { bootPlanMode } from '../world/plan-mode';
import { InventoryPanel } from './inventory-panel';
import { styles } from './styles';

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
  read: { ops: () => Operations; selection: () => Selection; trackStats: () => TrackStats };
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  /** Why the 3D map is absent, when it is — shown as a banner over a WORKING plan-mode board. */
  const [degraded, setDegraded] = useState('');
  /** Held for the inventory panel only (201/1-01) — it reads the collector, it does not drive the loop. */
  const handleRef = useRef<DispatchHandle | null>(null);

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
    const boot: BootOptions = {
      canvas,
      onClick: (click) => {
        const { select } = liveRef.current.actions;
        if (click.kind === 'ground') {
          select(null);
        } else if (click.kind === 'world') {
          select({ at: click.at, district: click.district, kind: 'world', model: click.model, txd: click.txd });
        } else {
          select({ id: click.id, kind: click.kind });
        }
      },
      onGround: (at: GtaGround, district: null | string) => liveRef.current.actions.createAt(at, district),
      onReadout: (readout) => liveRef.current.onReadout(readout),
      ops: () => liveRef.current.read.ops(),
      overlay,
      selection: () => liveRef.current.read.selection(),
      trackStats: () => liveRef.current.read.trackStats(),
    };
    // The 3D map is the preferred surface, not a requirement: a browser without WebGPU (or a world this GPU
    // cannot read) falls back to the 2D plan, which keeps every unit, call and gesture working.
    booted ??= bootDispatch(boot).catch((error: unknown) => {
      // eslint-disable-next-line no-console -- a degraded map must say why, in the console as well as on it
      console.warn('[dispatch] 3D map unavailable, falling back to plan mode:', error);
      setDegraded(reason(error));

      return bootPlanMode(boot, reason(error));
    });
    void booted.then((handle) => {
      if (handle) {
        handleRef.current = handle;
        onReady(handle);
      }
    });
  }, [onReady]);

  return (
    <div style={styles.canvasWrap}>
      <canvas ref={canvasRef} style={styles.canvas} />
      <canvas ref={overlayRef} style={{ ...styles.fill, pointerEvents: 'none', zIndex: 2 }} />
      {children}
      {degraded && <DegradedBanner message={degraded} />}
      {dispatchParams().get('inventory') === '1' && (
        <InventoryPanel read={() => handleRef.current?.inventory() ?? null} />
      )}
    </div>
  );
}

/** The board still works; say what is missing and why, without covering it. */
function DegradedBanner({ message }: { message: string }): ReactElement {
  return (
    <div style={styles.degradedBanner}>
      <strong>2D plan mode</strong> — no 3D world: {message}
    </div>
  );
}

/** The short version of a boot error, for a banner that has one line. */
function reason(error: unknown): string {
  const text = String(error);
  // These two look alike and are fixed differently, so they must not share a message: no `navigator.gpu` is a
  // browser that never shipped WebGPU, while a null adapter is a browser that HAS it and refused this GPU
  // (Android below 12, no Vulkan 1.1, or a blocklisted device — the last of which a flag can override).
  if (text.includes('WebGPU is not available')) {
    return 'this browser has no WebGPU at all';
  }
  if (text.includes('adapter request failed')) {
    return 'this browser has WebGPU but no usable GPU adapter (blocklisted, or the OS/driver is too old)';
  }
  if (text.includes('texture-compression-bc')) {
    return "this GPU cannot read the world's BC textures (rebuild the pak with --rgba8)";
  }
  if (text.includes('no pak manifest')) {
    return 'no built game to stream (pass ?src=, or ?demo=1 for the synthetic city)';
  }

  return text.replace(/^Error:\s*/, '').slice(0, 160);
}
