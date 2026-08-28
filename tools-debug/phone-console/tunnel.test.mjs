import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readToken, summary, tunnelUrl } from './tunnel.mjs';

const tempFile = () => join(mkdtempSync(join(tmpdir(), 'opensa-token-')), 'mcp-token');

describe('panel tunnel', () => {
  describe('negative cases', () => {
    it('does not read a token out of an empty file — it makes one', () => {
      const file = tempFile();
      writeFileSync(file, '   \n', 'utf8');

      expect(readToken(file, () => 'fresh')).toBe('fresh');
    });

    it('finds no address in a line that is not the tunnel announcing one', () => {
      expect(tunnelUrl('2026-08-28T14:02:11Z INF Requesting new quick Tunnel...')).toBeNull();
      expect(tunnelUrl('https://example.com/mcp')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('keeps the token it made, so only the address has to be pasted again', () => {
      const file = tempFile();
      const first = readToken(file, () => 'once');

      expect(readToken(file, () => 'twice')).toBe(first);
      expect(readFileSync(file, 'utf8').trim()).toBe('once');
      expect(existsSync(file)).toBe(true);
    });

    it('reads the address out of the line cloudflared actually prints', () => {
      const line = '2026-08-28T14:02:14Z INF |  https://tidy-pine-mango-ab12.trycloudflare.com   |';

      expect(tunnelUrl(line)).toBe('https://tidy-pine-mango-ab12.trycloudflare.com');
    });

    it('prints both values under the names the settings page asks for', () => {
      const printed = summary('https://x.trycloudflare.com/mcp', 'abc123');

      expect(printed).toContain('OPENSA_PHONE_URL    https://x.trycloudflare.com/mcp');
      expect(printed).toContain('OPENSA_PHONE_TOKEN  abc123');
      expect(printed).toContain('START A NEW SESSION');
    });
  });
});
