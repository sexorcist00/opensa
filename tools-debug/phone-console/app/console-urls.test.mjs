import { describe, expect, it } from 'vitest';

import { CONSOLE_VIEWS, consoleUrls } from './console-urls.mjs';

const PORTS = { app: 5173, static: 3001 };

describe('consoleUrls', () => {
  describe('negative cases', () => {
    it('never hands out a link without agent=1 — a console that cannot phone the panel is unreadable', () => {
      const links = consoleUrls({ district: 'ganton', ports: PORTS });

      for (const view of CONSOLE_VIEWS) {
        expect(links[view]).toContain('&agent=1');
      }
    });

    it('encodes a district so a name with a space cannot cut the query short', () => {
      const links = consoleUrls({ district: 'los santos & centre', ports: PORTS });

      expect(links.map).toContain('district=los%20santos%20%26%20centre&agent=1');
    });
  });

  describe('positive cases', () => {
    it('serves the app off the static port when a prebuilt copy exists, and off vite when it does not', () => {
      const built = consoleUrls({ ports: PORTS, webapp: true });
      const vite = consoleUrls({ ports: PORTS, webapp: false });

      expect(built.map.startsWith('http://localhost:3001/build/webapp/dispatch.html?')).toBe(true);
      expect(vite.map.startsWith('http://localhost:5173/dispatch.html?')).toBe(true);
    });

    it('points the pak at the out folder with its leading ./ dropped', () => {
      const links = consoleUrls({ out: './build/phone-1916', ports: PORTS });

      expect(links.map).toContain('src=http://localhost:3001/build/phone-1916&');
    });

    it('carries the declared worst case on the field link', () => {
      expect(consoleUrls({ ports: PORTS }).field).toContain('&units=150&calls=40&inventory=1');
    });
  });
});
