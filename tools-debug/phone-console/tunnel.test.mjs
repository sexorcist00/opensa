import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { chooseProviders, PROVIDERS, readToken, summary, tunnelUrl } from './tunnel.mjs';

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

    it('offers nothing when no provider is installed, rather than spawning a command that is not there', () => {
      expect(chooseProviders(undefined, () => false)).toEqual([]);
    });

    it('does not fall back past a provider the operator named', () => {
      expect(chooseProviders('ngrok', () => true).map((provider) => provider.name)).toEqual(['ngrok']);
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

    it('reads the address each provider actually prints', () => {
      // ngrok logs key=value; serveo writes a sentence; cloudflared draws a box. One pattern, three shapes.
      expect(
        tunnelUrl('t=2026-08-28T14:30:02+0000 lvl=info msg="started tunnel" url=https://a1b2-c3.ngrok-free.app'),
      ).toBe('https://a1b2-c3.ngrok-free.app');
      expect(tunnelUrl('Forwarding HTTP traffic from https://frosty-lake.serveo.net')).toBe(
        'https://frosty-lake.serveo.net',
      );
      expect(tunnelUrl('INF |  https://tidy-pine-mango-ab12.trycloudflare.com   |')).toBe(
        'https://tidy-pine-mango-ab12.trycloudflare.com',
      );
    });

    it('tries the ones that reach their edge over 443 BEFORE the one that needs 7844', () => {
      // The order is the finding, not a preference: this phone's carrier blocks 7844 both ways while 443
      // passes, so cloudflared cannot connect here however long it retries.
      expect(chooseProviders(undefined, () => true).map((provider) => provider.name)).toEqual([
        'ngrok',
        'serveo',
        'cloudflared',
      ]);
      expect(PROVIDERS.at(-1).name).toBe('cloudflared');
    });

    it('prints both values under the names the settings page asks for', () => {
      const printed = summary('https://x.trycloudflare.com/mcp', 'abc123');

      expect(printed).toContain('OPENSA_PHONE_URL    https://x.trycloudflare.com/mcp');
      expect(printed).toContain('OPENSA_PHONE_TOKEN  abc123');
      expect(printed).toContain('START A NEW SESSION');
    });
  });
});
