/**
 * One `.osm` per MODEL, not per asset class (plan opensa-pack/003 phase 5).
 *
 * A model belongs to as many classes as the data says: a cactus is a clutter species AND a breakable, a
 * crate is a topple prop AND a breakable. Each class contributes its own sections — `DESC`/`GEOM` from the
 * rigid build, `SHAT` from the shatter bake, collision from the COL — and they must land in ONE container.
 *
 * Emitting a file per class instead looks fine until two classes name the same model: the archive editor
 * dedupes inserts by name, so the second contribution is silently dropped and the model loses half its
 * sections. This accumulator is what makes that impossible.
 */
import type { OsmSection } from '@opensa/engine-formats';

import { encodeOsm } from '@opensa/engine-formats';

import type { ArchiveInsert } from './archive-edit';

export interface ModelBundles {
  /** Add a class's contribution to `model`. Repeated tags are rejected — two classes may not both claim one. */
  add(model: string, contribution: ModelContribution): void;
  /** Whether `model` already carries `tag` — a later class then contributes only what it adds. */
  hasSection(model: string, tag: number): boolean;
  /** Every accumulated model as archive inserts — ONE `.osm` each; the dictionary rides in `TEXS`. */
  inserts(): ArchiveInsert[];
  /** Number of distinct models accumulated. */
  size(): number;
}

export interface ModelContribution {
  sections: readonly OsmSection[];
}

export function createModelBundles(): ModelBundles {
  const bundles = new Map<string, { sections: OsmSection[] }>();

  return {
    add(model: string, contribution: ModelContribution): void {
      const name = model.toLowerCase();
      const bundle = bundles.get(name) ?? { sections: [] };
      for (const section of contribution.sections) {
        if (bundle.sections.some((existing) => existing.tag === section.tag)) {
          // Two classes writing the same section for one model means they disagree about its content —
          // silently keeping either one is how a model ends up with the wrong geometry.
          throw new Error(`${name}: duplicate .osm section contributed twice`);
        }
        bundle.sections.push(section);
      }
      bundles.set(name, bundle);
    },
    hasSection(model: string, tag: number): boolean {
      return bundles.get(model.toLowerCase())?.sections.some((section) => section.tag === tag) ?? false;
    },
    inserts(): ArchiveInsert[] {
      const out: ArchiveInsert[] = [];
      for (const [name, bundle] of bundles) {
        out.push({ bytes: encodeOsm(bundle.sections), name: `${name}.osm`, near: `${name}.dff` });
      }

      return out;
    },
    size(): number {
      return bundles.size;
    },
  };
}
