/**
 * The 2D symbology layer: icons, callsigns, call chips, leader lines and the scale bar, drawn on a plain
 * canvas stacked over the WebGPU one.
 *
 * This is where the engine's missing text stops mattering. Everything a dispatcher reads is 2D by nature —
 * it must stay upright, stay legible at any zoom and never be occluded — so putting it in the 3D scene would
 * be the wrong call even if the renderer had a font. The only thing that has to live in the world is the
 * beacon, and that is `beacons.ts`.
 *
 * The layer also OWNS hit-testing: it remembers the screen rect of everything it drew, so a click resolves
 * against exactly the pixels the operator aimed at, chip included.
 */
import type { Incident, Operations, Selection, Unit } from '../ops/types';
import type { ScreenProjector } from './projection';

import { incidentKey, type Rgba, SET_COLORS } from './beacons';
import { gtaToEngine } from './coords';

/** What the last draw put on screen, and what a click at those pixels selects. */
export interface HitArea {
  readonly height: number;
  readonly id: string;
  readonly kind: 'incident' | 'unit';
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

/** What one frame of symbology drew, so a capture can be read against the load it was under. */
export interface SymbologyCounts {
  /** Label chips drawn. */
  readonly chips: number;
  /** Symbols whose chip was dropped for being past {@link CHIP_MAX_DEPTH} — the decluttering, counted. */
  readonly chipsDropped: number;
  /** `measureText` calls this frame. It is the claim of the width cache, stated rather than asserted: with
   *  the cache warm this is 0 however many symbols are on screen, and every new label costs exactly one. */
  readonly measures: number;
  /** Icons drawn — units plus calls that projected onto the canvas. */
  readonly symbols: number;
}

/** Height above ground the unit/call icons are anchored at, so they clear the road surface. */
const ICON_LIFT = 4;
/** How far above the anchor the chip floats, in screen pixels. */
const CHIP_RISE = 26;
const CHIP_HEIGHT = 18;
/** Keep a clamped chip this far off the canvas edge. */
const CHIP_MARGIN = 4;
const FONT = '600 11px ui-sans-serif, system-ui, -apple-system, sans-serif';
const FONT_SMALL = '500 10px ui-sans-serif, system-ui, -apple-system, sans-serif';
/** Past this distance from the eye a chip is dropped — a city view would otherwise be a wall of text. */
const CHIP_MAX_DEPTH = 2600;
/** Below this canvas width a call chip drops its title and keeps the code — the list carries the rest. */
const NARROW_CANVAS = 620;
/** Horizontal padding inside a chip, added to the measured text width. */
const CHIP_PADDING = 14;
/** Distinct labels the width cache holds before it is dropped whole. */
const WIDTH_CACHE_CAP = 512;
/** Round distances the scale bar is allowed to show. */
const SCALE_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const;

export class SymbologyLayer {
  private areas: HitArea[] = [];
  private counts = { chips: 0, chipsDropped: 0, measures: 0, symbols: 0 };
  /**
   * Chip width by label text, because `measureText` is the layer's per-symbol cost and the labels do not
   * change: a callsign is a callsign for a whole shift. Before this, every chip re-set `ctx.font` (a font
   * re-parse) and re-measured its own text EVERY FRAME — at the nine units the 2026-08-09 capture ran,
   * `overlay-2d` was already the largest item in the body at 2.44 ms, more than `engine-frame`'s 2.10, and
   * the declared worst case is 150.
   *
   * Bounded by construction — a label is a callsign or a call code, both drawn from a fixed board — but
   * cleared past {@link WIDTH_CACHE_CAP} so a very long shift cannot turn it into a leak.
   */
  private readonly widths = new Map<string, number>();

  /** What the last {@link render} drew — the inventory report's `symbology` block. */
  counted(): SymbologyCounts {
    return { ...this.counts };
  }

  /** What sits at a CSS-pixel position, topmost first. Chips count — they are half the click target. */
  hitTest(x: number, y: number): null | { id: string; kind: 'incident' | 'unit' } {
    for (let i = this.areas.length - 1; i >= 0; i -= 1) {
      const area = this.areas[i];
      if (x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height) {
        return { id: area.id, kind: area.kind };
      }
    }

    return null;
  }

  /** One frame of symbology. `projector` must already carry this frame's camera, and the caller must have
   *  cleared the canvas — plan mode draws a ground grid under the symbols, so the clear cannot live here. */
  render(
    ctx: CanvasRenderingContext2D,
    projector: ScreenProjector,
    ops: Operations,
    selection: Selection,
    size: { readonly height: number; readonly width: number },
  ): void {
    this.areas = [];
    this.counts = { chips: 0, chipsDropped: 0, measures: 0, symbols: 0 };
    // Font and alignment are the chips' state and never vary, so they are set ONCE per frame rather than
    // once per chip: assigning `ctx.font` re-parses the shorthand every time.
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const incident of ops.incidents) {
      this.drawIncident(ctx, projector, incident, selection, size);
    }
    for (const unit of ops.units) {
      this.drawUnit(ctx, projector, unit, selection, size);
    }
    drawScaleBar(ctx, projector, ops, size);
  }

  /** The chip's width, measured once per distinct label and remembered. */
  private chipWidth(ctx: CanvasRenderingContext2D, text: string): number {
    const cached = this.widths.get(text);
    if (cached !== undefined) {
      return cached;
    }
    if (this.widths.size >= WIDTH_CACHE_CAP) {
      this.widths.clear();
    }
    const width = ctx.measureText(text).width + CHIP_PADDING;
    this.counts.measures += 1;
    this.widths.set(text, width);

    return width;
  }

  private drawIncident(
    ctx: CanvasRenderingContext2D,
    projector: ScreenProjector,
    incident: Incident,
    selection: Selection,
    size: { readonly height: number; readonly width: number },
  ): void {
    const point = projector.project(gtaToEngine(incident.at, ICON_LIFT));
    if (!point) {
      return;
    }
    const color = css(SET_COLORS[incidentKey(incident.status, incident.priority)]);
    const selected = selection?.kind === 'incident' && selection.id === incident.id;
    diamond(ctx, point.x, point.y, incident.status === 'closed' ? 5 : 8, color, selected);
    this.counts.symbols += 1;
    if (point.depth > CHIP_MAX_DEPTH && !selected) {
      this.counts.chipsDropped += 1;

      return;
    }
    const label = size.width < NARROW_CANVAS ? incident.code : `${incident.code} · ${incident.title}`;
    const rect = chip(
      ctx,
      point.x,
      point.y - CHIP_RISE,
      label,
      this.chipWidth(ctx, label),
      color,
      selected,
      size.width,
    );
    this.counts.chips += 1;
    this.areas.push({ ...rect, id: incident.id, kind: 'incident' });
    this.areas.push({ height: 20, id: incident.id, kind: 'incident', width: 20, x: point.x - 10, y: point.y - 10 });
  }

  private drawUnit(
    ctx: CanvasRenderingContext2D,
    projector: ScreenProjector,
    unit: Unit,
    selection: Selection,
    size: { readonly height: number; readonly width: number },
  ): void {
    const point = projector.project(gtaToEngine(unit.at, ICON_LIFT));
    if (!point) {
      return;
    }
    // The chevron's screen angle comes from projecting a point AHEAD of the unit, so it stays correct under
    // any camera yaw or tilt without the overlay having to know the camera's basis.
    const ahead = projector.project(
      gtaToEngine([unit.at[0] + Math.sin(unit.heading) * 14, unit.at[1] + Math.cos(unit.heading) * 14], ICON_LIFT),
    );
    const color = css(SET_COLORS[unit.status]);
    const selected = selection?.kind === 'unit' && selection.id === unit.id;
    chevron(ctx, point.x, point.y, ahead ? Math.atan2(ahead.y - point.y, ahead.x - point.x) : 0, color, selected);
    this.counts.symbols += 1;
    if (point.depth > CHIP_MAX_DEPTH && !selected) {
      this.counts.chipsDropped += 1;

      return;
    }
    const rect = chip(
      ctx,
      point.x,
      point.y - CHIP_RISE,
      unit.callsign,
      this.chipWidth(ctx, unit.callsign),
      color,
      selected,
      size.width,
    );
    this.counts.chips += 1;
    this.areas.push({ ...rect, id: unit.id, kind: 'unit' });
    this.areas.push({ height: 20, id: unit.id, kind: 'unit', width: 20, x: point.x - 10, y: point.y - 10 });
  }
}

/** A colour from the shared table, as CSS. */
export function css(rgba: Rgba, alpha = rgba[3]): string {
  const to255 = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);

  return `rgba(${to255(rgba[0])}, ${to255(rgba[1])}, ${to255(rgba[2])}, ${alpha})`;
}

/** The unit symbol: a filled disc with a heading chevron, the way a moving-map AVL display draws one. */
function chevron(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  color: string,
  selected: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, selected ? 9 : 7, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0, 0, 0, 0.65)';
  ctx.lineWidth = selected ? 2 : 1.4;
  ctx.stroke();

  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(5, -5);
  ctx.lineTo(5, 5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/**
 * A label chip with its leader line back to the icon. Returns the rect it occupies, for hit-testing.
 *
 * `width` comes from the caller's cache and the font is the frame's — neither is re-established here,
 * because both are per-symbol costs at a count where the layer already dominates the frame.
 */
function chip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  width: number,
  color: string,
  selected: boolean,
  canvasWidth: number,
): { height: number; width: number; x: number; y: number } {
  // Clamp inside the canvas. A chip centred on an icon near the edge hangs half off screen, which on a phone
  // is most of them; the leader line stays on the icon, so the chip may slide without becoming ambiguous.
  const centre = Math.min(
    Math.max(x, width / 2 + CHIP_MARGIN),
    Math.max(width / 2 + CHIP_MARGIN, canvasWidth - width / 2 - CHIP_MARGIN),
  );
  const left = centre - width / 2;
  const top = y - CHIP_HEIGHT / 2;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + CHIP_HEIGHT / 2);
  ctx.lineTo(x, y + CHIP_RISE - 8);
  ctx.stroke();

  ctx.fillStyle = selected ? 'rgba(12, 18, 26, 0.96)' : 'rgba(8, 12, 18, 0.82)';
  roundRect(ctx, left, top, width, CHIP_HEIGHT, 4);
  ctx.fill();
  ctx.strokeStyle = selected ? '#ffffff' : color;
  ctx.lineWidth = selected ? 1.6 : 1;
  ctx.stroke();

  ctx.fillStyle = '#e8eef6';
  ctx.fillText(text, centre, y + 0.5);

  return { height: CHIP_HEIGHT, width, x: left, y: top };
}

/** The call symbol: a diamond, as every CAD map draws an incident. */
function diamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  selected: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.beginPath();
  ctx.rect(-size, -size, size * 2, size * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0, 0, 0, 0.7)';
  ctx.lineWidth = selected ? 2 : 1.4;
  ctx.stroke();
  ctx.restore();
}

/**
 * The scale bar, measured rather than assumed: project two ground points a known distance apart at the view
 * centre and read the pixels back. It stays honest under tilt, which a "pixels per unit" constant would not.
 */
function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  projector: ScreenProjector,
  ops: Operations,
  size: { readonly height: number; readonly width: number },
): void {
  const anchor = ops.units[0]?.at ?? [0, 0];
  const a = projector.project(gtaToEngine(anchor));
  const b = projector.project(gtaToEngine([anchor[0] + 100, anchor[1]]));
  if (!a || !b) {
    return;
  }
  const pixelsPer100 = Math.hypot(b.x - a.x, b.y - a.y);
  if (pixelsPer100 < 0.01) {
    return;
  }
  const metres = SCALE_STEPS.find((step) => (step / 100) * pixelsPer100 > 70) ?? SCALE_STEPS[SCALE_STEPS.length - 1];
  const width = (metres / 100) * pixelsPer100;
  const x = 18;
  const y = size.height - 26;

  ctx.strokeStyle = 'rgba(232, 238, 246, 0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y - 5);
  ctx.stroke();
  ctx.font = FONT_SMALL;
  ctx.fillStyle = 'rgba(232, 238, 246, 0.85)';
  ctx.textAlign = 'left';
  ctx.fillText(`${metres} m`, x, y - 12);
  // Drawn last, so putting the chip state back costs nothing — but a caller that adds a pass after this one
  // would otherwise inherit the scale bar's font and alignment.
  ctx.font = FONT;
  ctx.textAlign = 'center';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
