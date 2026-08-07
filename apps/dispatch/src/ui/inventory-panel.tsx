/**
 * The 098/1-01 readout: a small panel that says how much has been sampled and hands the table over.
 *
 * It exists because the development machine is a phone ([`docs/development/termux.md`]) — there is no
 * headless browser to capture from, so the capture has to leave through something a thumb can press.
 *
 * Two things it does not do. It does not re-render on the frame loop: it polls a getter twice a second, and
 * the numbers it shows are only enough to tell that collection is alive. And it does not assume the
 * clipboard: `navigator.clipboard` needs a secure context, which `http://localhost` is and a LAN address is
 * NOT — so a phone reaching a dev server at `192.168.x.x` falls back to a selected textarea to long-press.
 */
import { type ReactElement, useEffect, useRef, useState } from 'react';

import type { InventoryReport } from '../world/inventory';

import { styles } from './styles';

const POLL_MS = 500;

export function InventoryPanel({ read }: { read: () => InventoryReport | null }): null | ReactElement {
  const [report, setReport] = useState<InventoryReport | null>(null);
  const [copied, setCopied] = useState('');
  const [fallback, setFallback] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = setInterval((): void => setReport(read()), POLL_MS);

    return (): void => clearInterval(id);
  }, [read]);

  useEffect(() => {
    if (fallback && areaRef.current) {
      areaRef.current.select();
    }
  }, [fallback]);

  if (!report) {
    return null;
  }

  const json = JSON.stringify(report, null, 2);
  const copy = (): void => {
    void navigator.clipboard
      ?.writeText(json)
      .then(() => {
        setCopied('copied');
        setTimeout(() => setCopied(''), 1500);
      })
      .catch(() => setFallback(json));
    if (!navigator.clipboard) {
      setFallback(json);
    }
  };

  return (
    <div style={styles.inventoryPanel}>
      <div>
        <strong>inventory</strong> · {report.frames} frames · {(report.windowMs / 1000).toFixed(0)}s
      </div>
      <div>
        dt p50 {report.frame.dtP50Ms.toFixed(1)} · p95 {report.frame.dtP95Ms.toFixed(1)} · max{' '}
        {report.frame.dtMaxMs.toFixed(0)} ms
      </div>
      <div>
        {report.world.cellsVisible}/{report.world.cellsTotal} cells · {report.world.draws} draws ·{' '}
        {report.world.residencyMb.toFixed(0)} MB
      </div>
      {report.unavailable.length > 0 && <div style={styles.inventoryWarn}>GPU timings unavailable on this adapter</div>}
      {report.warnings.map((warning) => (
        <div key={warning} style={styles.inventoryWarn}>
          {warning}
        </div>
      ))}
      <button onClick={copy} style={styles.inventoryButton} type="button">
        {copied || 'copy JSON'}
      </button>
      {fallback && <textarea readOnly ref={areaRef} style={styles.inventoryFallback} value={fallback} />}
    </div>
  );
}
