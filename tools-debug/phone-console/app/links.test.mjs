import { describe, expect, it } from 'vitest';

import { consoleUrls, LINK_NAMES, portsFor } from './links.mjs';

/** What the panel's `/api/state` hands over, in the shape both readers take it in. */
const SERVED = {
  district: 'los-santos-centre',
  out: './build/phone',
  ports: { app: 5173, static: 3001 },
  webapp: true,
};

describe('the panel links', () => {
  describe('negative cases', () => {
    it('never hands out a link without agent=1 — a page that cannot be read is the whole point', () => {
      const links = consoleUrls(SERVED);

      for (const name of LINK_NAMES) {
        expect(links[name], name).toContain('agent=1');
      }
    });

    it('does not aim the app at the vite port when a prebuilt copy is what is served', () => {
      const links = consoleUrls({ ...SERVED, webapp: true });

      expect(links.field).not.toContain(':5173');
    });

    it('needs the static port even when the app is served from vite — the pak comes from it', () => {
      expect(portsFor({ ...SERVED, webapp: false })).toEqual([3001, 5173]);
    });

    it('encodes a district so a name with a space or an & cannot cut the query short', () => {
      const links = consoleUrls({ ...SERVED, district: 'los santos & centre' });

      expect(links.map).toContain('district=los%20santos%20%26%20centre&agent=1');
    });
  });

  describe('positive cases', () => {
    it('builds THE FIELD RUN as the MAP — no board on it at all', () => {
      // The user's call, 2026-08-31: the map and its optimisation come first, so the field run stopped
      // meaning 150 units. Every window the map's own work is judged in is taken here.
      expect(consoleUrls(SERVED).field).toBe(
        'http://localhost:3001/build/webapp/dispatch.html?src=http://localhost:3001/build/phone' +
          '&district=los-santos-centre&agent=1&units=0&calls=0&inventory=1&surface=720x640',
      );
    });

    it('keeps the declared worst case reachable, as its own link', () => {
      expect(consoleUrls(SERVED).board).toBe(
        'http://localhost:3001/build/webapp/dispatch.html?src=http://localhost:3001/build/phone' +
          '&district=los-santos-centre&agent=1&units=150&calls=40&inventory=1&surface=720x640',
      );
    });

    it('strips the leading ./ an operator types into the output field', () => {
      expect(consoleUrls({ ...SERVED, out: './build/phone-map3d' }).map).toContain('/build/phone-map3d&');
    });

    it('serves the share artifact out of the repo rather than out of the app', () => {
      expect(consoleUrls(SERVED).share).toContain('/dist-share/dispatch.html?');
    });

    it('asks only for the static port when the app is served beside the pak', () => {
      expect(portsFor(SERVED)).toEqual([3001]);
    });
  });
});

describe('the engine link (201/2)', () => {
  describe('negative cases', () => {
    it('does not let the field run carry the overlay switch — it is the half that DRAWS the symbology', () => {
      expect(consoleUrls(SERVED).field).not.toContain('overlay=0');
    });
  });

  describe('positive cases', () => {
    it('is the field run with the overlay off and nothing else changed', () => {
      const links = consoleUrls(SERVED);

      // The pair only measures the overlay if that is the ONLY difference between its halves.
      expect(links.engine).toBe(`${links.field}&overlay=0`);
    });
  });
});

describe('the cleared link (201/9-01)', () => {
  describe('negative cases', () => {
    it('is not the engine arm — the whole point is that one skips the clearRect and this one does not', () => {
      const links = consoleUrls(SERVED);

      expect(links.cleared).not.toBe(links.engine);
      expect(links.cleared).not.toContain('overlay=0');
    });

    it('carries no board, like every arm of the map circuit', () => {
      const links = consoleUrls(SERVED);

      for (const arm of [links.field, links.cleared, links.engine]) {
        expect(arm).toContain('units=0&calls=0');
        expect(arm).not.toContain('units=150');
      }
    });
  });

  describe('positive cases', () => {
    it('is the third arm of ONE circuit — the field run, differing only in the overlay switch', () => {
      const links = consoleUrls(SERVED);

      // Cleared − engine is the layer, and neither subtraction means anything unless the overlay switch is
      // the only thing that moved between the three.
      expect(links.cleared).toBe(`${links.field}&overlay=clear`);
      expect(links.engine).toBe(`${links.field}&overlay=0`);
    });
  });
});

describe('the board link (201/5-02)', () => {
  describe('negative cases', () => {
    it('is not an arm of the map circuit — it is what the map circuit is compared against', () => {
      const links = consoleUrls(SERVED);

      expect(links.board).not.toContain('units=0');
      expect(links.board).not.toContain('overlay=');
    });
  });

  describe('positive cases', () => {
    it('differs from the field run by the BOARD and nothing else', () => {
      const links = consoleUrls(SERVED);

      // `board` − `field` is the content the symbology draws, so the two must agree on the pak, the
      // district, the collector and the app — everything except how many units are on the board.
      expect(links.board.replace('units=150&calls=40', 'units=0&calls=0')).toBe(links.field);
    });
  });
});

describe('the pinned capture surface (201/9-01)', () => {
  describe('negative cases', () => {
    it('does not pin the buffer on the links an operator opens', () => {
      const links = consoleUrls(SERVED);

      // A pinned buffer is stretched into whatever room the layout gives it — right for an arm, wrong for
      // somebody working the map.
      for (const operator of [links.map, links.inventory, links.flat, links.bake, links.share]) {
        expect(operator).not.toContain('surface=');
      }
    });
  });

  describe('positive cases', () => {
    it('pins the same buffer on all four measurement links', () => {
      const links = consoleUrls(SERVED);

      // Two arms taken at two viewport sizes cannot be subtracted, and nothing in either capture complains
      // — which is exactly what happened to the 2026-08-31 circuit.
      for (const arm of [links.field, links.cleared, links.engine, links.board]) {
        expect(arm).toContain('surface=720x640');
      }
    });
  });
});

describe('the attachment ladder (201/9-04)', () => {
  describe('negative cases', () => {
    it('never moves two things at once — an arm differs from the field run by ONE parameter', () => {
      const links = consoleUrls(SERVED);

      // The whole ladder is a subtraction against `field`. An arm that also changed the overlay, the board
      // or the buffer would be a measurement of something nobody wrote down, which is the defect the map
      // circuit was rebuilt to avoid.
      for (const [arm, added] of [
        [links.msaa1, 'msaa=1'],
        [links.rgb10a2, 'scene=rgb10a2unorm'],
        [links.scale75, 'scale=0.75'],
        [links.scale50, 'scale=0.5'],
      ]) {
        expect(arm.replace(`&${added}`, '')).toBe(links.field);
      }
    });

    it('leaves the attachment knobs off every link that is not an arm', () => {
      const links = consoleUrls(SERVED);

      for (const other of [links.map, links.inventory, links.flat, links.bake, links.share, links.field]) {
        expect(other).not.toContain('msaa=');
        expect(other).not.toContain('scene=');
        expect(other).not.toContain('scale=');
      }
    });
  });

  describe('positive cases', () => {
    it('carries no board and the pinned buffer, like every arm of the map circuit', () => {
      const links = consoleUrls(SERVED);

      for (const arm of [links.msaa1, links.rgb10a2, links.scale75, links.scale50]) {
        expect(arm).toContain('units=0&calls=0');
        expect(arm).toContain('surface=720x640');
        expect(arm).toContain('inventory=1');
      }
    });
  });
});

describe('the ablation arms (201/9)', () => {
  describe('negative cases', () => {
    // Same rule as the ladder above, and it matters more here: with no `timestamp-query` on the device
    // there is no second signal that would catch an arm which moved two things at once.
    it('differs from the field run by ONE parameter, exactly like a ladder arm', () => {
      const links = consoleUrls(SERVED);

      for (const [arm, added] of [
        [links.nocells, 'ablate=cells'],
        [links.nocloud, 'ablate=cloud'],
        [links.nobloom, 'ablate=bloom'],
        [links.noprobe, 'ablate=probe'],
        [links.noskylut, 'ablate=skylut'],
        [links.bloom4, 'bloomlevels=4'],
      ]) {
        expect(arm.replace(`&${added}`, '')).toBe(links.field);
      }
    });

    it('leaves the ablation knobs off every link that is not an ablation arm', () => {
      const links = consoleUrls(SERVED);

      for (const other of [links.map, links.inventory, links.field, links.board, links.msaa1, links.share]) {
        expect(other).not.toContain('ablate=');
        expect(other).not.toContain('bloomlevels=');
      }
    });
  });

  describe('positive cases', () => {
    it('is offered by name, so `phone_run open LINK=` and `map_open view=` both reach it', () => {
      for (const name of ['nocells', 'nocloud', 'nobloom', 'bloom4', 'noprobe', 'noskylut']) {
        expect(LINK_NAMES).toContain(name);
        expect(consoleUrls(SERVED)[name]).toBeTypeOf('string');
      }
    });
  });
});

describe('the bloom arms and the night look pair (201/9-05)', () => {
  describe('negative cases', () => {
    it('never lets the look pair differ by anything but the arm — otherwise the A/B is about something else', () => {
      const links = consoleUrls(SERVED);

      expect(links.nighthalf).toBe(`${links.night}&bloomscale=0.5`);
    });

    it('does not judge the half-res prefilter in daylight, where there is no lit emitter to lose', () => {
      const links = consoleUrls(SERVED);

      expect(links.night).toContain('hour=22');
      expect(links.nighthalf).toContain('hour=22');
      expect(links.bloomhalf).not.toContain('hour=');
    });
  });

  describe('positive cases', () => {
    it('is the field run with one budget field moved, for each measurement arm', () => {
      const links = consoleUrls(SERVED);

      expect(links.bloomrg11).toBe(`${links.field}&bloomformat=rg11b10ufloat`);
      expect(links.bloomhalf).toBe(`${links.field}&bloomscale=0.5`);
      expect(links.bloomboth).toBe(`${links.field}&bloomformat=rg11b10ufloat&bloomscale=0.5`);
    });

    it('carries no board on any of them, like every arm of the map circuit', () => {
      const links = consoleUrls(SERVED);

      for (const arm of [links.bloomrg11, links.bloomhalf, links.bloomboth, links.night, links.nighthalf]) {
        expect(arm).toContain('units=0&calls=0');
      }
    });
  });
});
