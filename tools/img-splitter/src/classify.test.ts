import { describe, expect, it } from 'vitest';

import { claimsFromIde, classifyEntries, vehiclePartsFromCarmods } from './classify';

/** An IDE with one car, one ped and one map object — the three buckets, in the sections the game authors them in. */
const IDE = `
objs
1700, kb_bar, kb_stuff, 299, 0
end

cars
400, landstal, landstal, car, LANDSTAL, LANDSTK, null, richfamily, 10, 0, 0, -1, 0.7, 0.7, 0
end

peds
7, cop, cop, COP, CIVMALE, PED_TYPE_COP, 0, 0, 0, 0, 0, 0
end
`;

describe('claimsFromIde', () => {
  describe('negative cases', () => {
    it('claims nothing from sections that declare no model', () => {
      // txdp is a texture PARENT pair and 2dfx attaches to a model declared elsewhere — neither owns an entry.
      const claims = claimsFromIde(`
txdp
vehicleold1, vehicle
end

2dfx
1700, 0, 0, 0, 0, 200, 200, 200, 100
end
`);
      expect(claims).toEqual([]);
    });

    it('ignores a row missing the model or txd cell instead of claiming an empty name', () => {
      const claims = claimsFromIde('cars\n400\nend\n');
      expect(claims).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('claims the dff and the txd of every model-declaring section, by that section', () => {
      expect(claimsFromIde(IDE)).toEqual([
        { bucket: 'map', name: 'kb_bar.dff' },
        { bucket: 'map', name: 'kb_stuff.txd' },
        { bucket: 'vehicles', name: 'landstal.dff' },
        { bucket: 'vehicles', name: 'landstal.txd' },
        { bucket: 'peds', name: 'cop.dff' },
        { bucket: 'peds', name: 'cop.txd' },
      ]);
    });

    it('lowercases names, so an IDE written in any case still matches the archive', () => {
      expect(claimsFromIde('cars\n400, LandStal, LANDSTAL, car\nend\n')).toEqual([
        { bucket: 'vehicles', name: 'landstal.dff' },
        { bucket: 'vehicles', name: 'landstal.txd' },
      ]);
    });
  });
});

describe('classifyEntries', () => {
  describe('negative cases', () => {
    it('keeps an entry no IDE declares in map, and REPORTS it', () => {
      // .col/.ipl/.ifp/.dat live in gta3.img and belong to no model row — they stay where they are today.
      const { bucketOf, unclaimed } = classifyEntries(
        ['countn2.col', 'vegas.ipl', 'ped.ifp', 'orphan.dff'],
        claimsFromIde(IDE),
      );

      expect([...bucketOf.values()]).toEqual(['map', 'map', 'map', 'map']);
      expect(unclaimed).toEqual(['countn2.col', 'vegas.ipl', 'ped.ifp', 'orphan.dff']);
    });

    it('sends an entry two buckets claim to map, and REPORTS it as contested', () => {
      // A dictionary shared between a car and a map object: safe in map, because the game resolves an entry
      // by name across every registered archive — the split decides size and ownership, never visibility.
      const shared = claimsFromIde(`
cars
400, landstal, shared, car
end

objs
1700, kb_bar, shared, 299, 0
end
`);
      const { bucketOf, contested } = classifyEntries(['shared.txd', 'landstal.dff'], shared);

      expect(contested).toEqual(['shared.txd']);
      expect(bucketOf.get('shared.txd')).toBe('map');
      expect(bucketOf.get('landstal.dff')).toBe('vehicles');
    });

    it('claims no part from a carmods row that names only a car or only a group index', () => {
      expect([...vehiclePartsFromCarmods('mods\nadmiral\nend\n')]).toEqual([]);
      expect([...vehiclePartsFromCarmods('wheel\n0\nend\n')]).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('places every entry exactly once, by the section that declared it', () => {
      const entries = ['landstal.dff', 'landstal.txd', 'cop.dff', 'cop.txd', 'kb_bar.dff', 'kb_stuff.txd'];
      const { bucketOf, contested, unclaimed } = classifyEntries(entries, claimsFromIde(IDE));

      expect(bucketOf.size).toBe(entries.length);
      expect([...bucketOf]).toEqual([
        ['landstal.dff', 'vehicles'],
        ['landstal.txd', 'vehicles'],
        ['cop.dff', 'peds'],
        ['cop.txd', 'peds'],
        ['kb_bar.dff', 'map'],
        ['kb_stuff.txd', 'map'],
      ]);
      expect(contested).toEqual([]);
      expect(unclaimed).toEqual([]);
    });

    it('matches an archive entry written in a different case from its IDE row', () => {
      const { bucketOf } = classifyEntries(['LANDSTAL.DFF'], claimsFromIde(IDE));
      expect(bucketOf.get('landstal.dff')).toBe('vehicles');
    });

    it('buckets a weapon by its own IDE section, not through weapon.dat', () => {
      // weapon.dat is the stats table and addresses a weapon by numeric modelId, so it could only ever
      // point back here.
      expect(claimsFromIde('weap\n321, gun_dildo1, gun_dildo1, null, 1, 50, 0\nend\n')).toEqual([
        { bucket: 'weapons', name: 'gun_dildo1.dff' },
        { bucket: 'weapons', name: 'gun_dildo1.txd' },
      ]);
    });

    it('reads every mod-shop part out of carmods.dat, whatever section hides it', () => {
      const parts = vehiclePartsFromCarmods(`
link
bntl_b_ov, bntr_b_ov
end

mods
admiral, nto_b_l, nto_b_s
end

wheel
0, wheel_gn1, wheel_sr3
end
`);
      // link: both cells are parts. mods: the leading cell is the CAR. wheel: the leading cell is a group index.
      expect([...parts].sort()).toEqual(['bntl_b_ov', 'bntr_b_ov', 'nto_b_l', 'nto_b_s', 'wheel_gn1', 'wheel_sr3']);
      expect(parts.has('admiral')).toBe(false);
      expect(parts.has('0')).toBe(false);
    });

    it('puts a mod-shop part and the car dictionary it shares in the VEHICLE bucket', () => {
      // veh_mods.ide authors the parts as plain objs rows, so without carmods.dat the car's own txd ends up
      // contested and the parts stream from a different archive than the car wearing them.
      const parts = vehiclePartsFromCarmods('mods\nblade, nto_b_l\nend\n');
      const claims = [
        ...claimsFromIde('cars\n575, blade, blade, car\nend\n', parts),
        ...claimsFromIde('objs\n1010, nto_b_l, blade, 200, 0\nend\n', parts),
      ];
      const { bucketOf, contested } = classifyEntries(['blade.dff', 'blade.txd', 'nto_b_l.dff'], claims);

      expect(contested).toEqual([]);
      expect(bucketOf.get('blade.txd')).toBe('vehicles');
      expect(bucketOf.get('nto_b_l.dff')).toBe('vehicles');
    });

    it('does not treat a repeated claim from the same bucket as contested', () => {
      // Two cars sharing one txd is ordinary (vehicle liveries), and both claims agree.
      const claims = claimsFromIde('cars\n400, landstal, shared, car\n401, bravura, shared, car\nend\n');
      const { bucketOf, contested } = classifyEntries(['shared.txd'], claims);

      expect(contested).toEqual([]);
      expect(bucketOf.get('shared.txd')).toBe('vehicles');
    });
  });
});
