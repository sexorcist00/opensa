import type { LodConfig } from './core/types';

/**
 * Curated HD models that ship with **no LOD** and hole the far view when they unload (plan 003). Auto-detection
 * over-generates ~1000×, so this is an opt-in list, lowercased — extend it as more holes are spotted in the viewer.
 * Entries that turn out to already have a LOD (or lack a def/DFF) are skipped with a warning.
 */
const holeFillModels = [
  'lae2_landhub02',
  'lanalley1_lan',
  'vegassedge29b',
  'vgssspagjun09b',
  'miragebuild09',
  'miragebuild04',
  'vegasnroad242',
  'vegaswrailroad01',
  'pier69_models06',
  'churchgr_sfe',
  'lowbox_sfe',
  'lombardsteps',
  'tempsf_3_sfe',
  'gg_split1_sfw',
  'park3a_sfw',
  'roadssfse34',
  'bbgroundbitc_sfs',
  'traintrax01b_sfs',
  'nuroad_sfse',
  // Downtown LA Bonaventure tower (glass shell + body) — placed in lan_stream2 with lod=-1, holes the skyline.
  'bonaventuragl_lan',
  'bonaventura_lan',
  'bventuraENV_LAn',
  // Roadsign
  'lamotsig2_LA',
  // GTA V Vinewood Sign
  'CE_radarmast3',
  'VineSign1_cunte01',
];

/**
 * Default run config. `texScale` 0.25 = quarter each side for the clone LODs (plan 006): the clones render only
 * from ≥ the HD draw distance (~300 u), where 0.25 still oversamples the screen ~2×; `encodeHalvedTxd` floors
 * small sources at 32 px so they don't turn to mush.
 */
export const config: LodConfig = {
  decimateBudget: 0.01,
  holeFillModels,
  holeLodDraw: 1500,
  minLodPixels: 2,
  texScale: 0.25,
};
