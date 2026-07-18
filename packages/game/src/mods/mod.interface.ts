/**
 * A game "mod" (plan 039): a self-contained feature layered over the vanilla pipeline, the way the
 * source community mods layer over SA (vegetation wind, PS2 trails, traffic-light cycling, …).
 *
 * NB on layering: `game/mods/**` is — together with `game/adapters/**` — allowed to import
 * renderware. Mods are GTA-specific by nature (they patch world materials and read object defs),
 * so hiding renderware types behind duplicate game-level interfaces would add indirection for no
 * generality. The engine core (`game/**` elsewhere) stays renderware-free.
 *
 * Wiring: `game.installMod(mod)` registers the per-frame `update`; the world adapter receives the
 * mods via its config. The `decoratePart` cell-build hook died with the three cell builder (074/13 C2).
 */
export interface WorldMod {
  name: string;
  /** Per-frame update — drive the mod's shader uniforms. */
  update?(context: WorldModUpdateContext): void;
}

/** Per-frame context for {@link WorldMod.update}. */
export interface WorldModUpdateContext {
  /** In-game time of day in fractional hours (0–24). */
  hours: number;
  /** Wall-clock seconds (monotonic) — for animation clocks. */
  seconds: number;
}
