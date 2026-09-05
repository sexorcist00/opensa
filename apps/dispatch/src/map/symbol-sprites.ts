/**
 * Symbols rasterized ONCE and blitted per instance (201/9-01, the operator's report of 2026-09-05).
 *
 * The 2D layer built every symbol as a fresh path every frame: a unit is a filled-and-stroked `arc` plus a
 * filled triangle, an incident a rotated rect, and at the declared board that is **190 path rasterizations
 * per frame** — with `overlay-2d` measured at 6.17 ms of an 11.65 ms CPU body, the largest single line in
 * the frame and nearly twice `engine-frame`.
 *
 * **This is the answer every map engine has already taken**, and it is taken here for their reason rather
 * than by analogy: MapLibre rasterizes its icons into an atlas and draws instances from it, and deck.gl's
 * `IconLayer` is the same idea with the atlas handed in ([docs/links.md](../../../../docs/links.md)). A
 * symbol on an operations map is a fixed picture in a handful of variants — it is exactly what a sprite is
 * for. Tessellating and filling it again for every unit, sixty times a second, is paying for a decision that
 * was made once.
 *
 * **What varies, and therefore what a key is made of.** A unit's mark varies by status colour, selection and
 * whether its fix is aging; an incident's by colour, selection and the smaller size a closed call takes.
 * Nothing else — the ANGLE is a transform, not a variant, so the sprite is baked pointing along +x and the
 * caller rotates the blit. A disc is rotation-invariant, so baking the whole mark and rotating it is
 * identical to the layer's old order of "draw the disc, then rotate, then draw the arrow".
 *
 * **The one thing that had to be quantized is the aging fade**, which is continuous by design: the alpha is
 * rounded to {@link ALPHA_STEPS} before it reaches a colour string, so a cache key is one of a bounded set
 * rather than one per unit per second. A 1/16 step of an alpha that travels from 1.0 to 0.35 over five
 * minutes is not a look change anybody can see; an unbounded cache is a leak anybody can measure.
 *
 * **Lazily built and bounded by construction.** A sprite exists once something asks for it, so a shift where
 * every unit is available and fresh holds two of them. The whole variant space is 4 statuses x 2 selected x
 * (1 fresh + 16 fade steps), and each sprite is ~34x34 device pixels.
 *
 * **A missing canvas is not an error.** Where no canvas can be created — a test, a worker, any host without
 * a document — {@link SymbolSprites.chevron} answers `null` and the layer draws the path it always drew. The
 * picture is the same either way, which is what makes the fallback safe to keep rather than a second
 * renderer to maintain.
 */

/** What the layer needs back: the bitmap, and the CSS-pixel box to blit it into, centred on the anchor. */
export interface Sprite {
  readonly halfSize: number;
  readonly image: CanvasImageSource;
  readonly size: number;
}

/** Steps the aging fade is rounded to before it becomes a cache key. */
export const ALPHA_STEPS = 16;

/**
 * How a sprite canvas is made. Injectable for one reason only: a test has no `document`, and a fallback that
 * is never exercised is a fallback nobody knows is broken.
 */
export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

export class SymbolSprites {
  /**
   * How many distinct sprites were actually RASTERIZED — the claim that the cache bounds itself, as a number.
   *
   * Refusals are not counted, which is what makes `spriteVariants: 0` in a capture read as *this run drew
   * every mark as a path*: the control arm below and a host with no canvas produce the same honest zero.
   */
  get size(): number {
    let built = 0;
    for (const sprite of this.cache.values()) {
      if (sprite !== null) {
        built += 1;
      }
    }

    return built;
  }

  /** Sprites built this session, by variant key. */
  private readonly cache = new Map<string, null | Sprite>();

  constructor(
    private readonly dpr: number,
    private readonly create: CanvasFactory = defaultCanvas,
  ) {}

  /** A unit's mark, baked pointing along +x. `null` when this host cannot rasterize one. */
  chevron(color: string, selected: boolean, stale: boolean): null | Sprite {
    return this.sprite(`u|${color}|${selected ? 1 : 0}|${stale ? 1 : 0}`, CHEVRON_HALF, (ctx, centre) => {
      ctx.translate(centre, centre);
      ctx.beginPath();
      ctx.arc(0, 0, selected ? 9 : 7, 0, Math.PI * 2);
      ctx.fillStyle = stale ? 'rgba(8, 12, 18, 0.7)' : color;
      ctx.fill();
      ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0, 0, 0, 0.65)';
      ctx.lineWidth = selected ? 2 : 1.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(13, 0);
      ctx.lineTo(5, -5);
      ctx.lineTo(5, 5);
      ctx.closePath();
      if (stale) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
    });
  }

  /** A call's mark — the diamond every CAD map draws, with its 45° baked in. */
  diamond(color: string, selected: boolean, size: number): null | Sprite {
    return this.sprite(`i|${color}|${selected ? 1 : 0}|${size}`, DIAMOND_HALF, (ctx, centre) => {
      ctx.translate(centre, centre);
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.rect(-size, -size, size * 2, size * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = selected ? 2 : 1.4;
      ctx.stroke();
    });
  }

  private sprite(
    key: string,
    half: number,
    draw: (ctx: CanvasRenderingContext2D, centre: number) => void,
  ): null | Sprite {
    const held = this.cache.get(key);
    if (held !== undefined) {
      return held;
    }
    const size = half * 2;
    const canvas = this.create(Math.ceil(size * this.dpr), Math.ceil(size * this.dpr));
    const ctx = canvas?.getContext('2d') ?? null;
    if (canvas === null || ctx === null) {
      this.cache.set(key, null);

      return null;
    }
    // The sprite is authored in CSS pixels and stored at device resolution, so a blit is crisp on the phone
    // and the layer's own coordinates never have to know the ratio.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    draw(ctx, half);
    const made = { halfSize: half, image: canvas, size };
    this.cache.set(key, made);

    return made;
  }
}

/** Round an alpha onto {@link ALPHA_STEPS}, so a continuous fade cannot make an unbounded cache. */
export function quantizeAlpha(alpha: number): number {
  return Math.round(alpha * ALPHA_STEPS) / ALPHA_STEPS;
}

/** Half the box a unit's mark is baked into, CSS px: the arrow reaches 13 and a selected disc strokes to 10. */
const CHEVRON_HALF = 16;
/** The same for a call: a diamond of half-diagonal 8 strokes to 9, rotated to ~12.7 across. */
const DIAMOND_HALF = 15;

/**
 * The sprite cache a surface should use, and the control arm that switches it off (`?sprites=0`).
 *
 * A blit is only faster than a path if somebody measured it, and this device has no `timestamp-query` — so
 * the price is read the way every other pass here is priced (`capture-ablation.ts`): run the same route with
 * ONE thing different. The arm is the layer's own fallback rather than a second code path written for the
 * measurement, so what it measures is exactly what shipped before.
 *
 * Any value other than `0` leaves sprites on, deliberately: an arm that silently ran as the default is a
 * measurement of the default filed under another name.
 */
export function spritesFrom(params: URLSearchParams, dpr: number): SymbolSprites {
  return params.get('sprites') === '0' ? new SymbolSprites(dpr, () => null) : new SymbolSprites(dpr);
}

function defaultCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  return canvas;
}
