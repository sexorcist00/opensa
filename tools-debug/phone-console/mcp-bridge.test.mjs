import { describe, expect, it } from 'vitest';

import { bridgeRpc } from './mcp-bridge.mjs';

const failing = () => {
  throw new Error('connect ECONNREFUSED');
};

describe('bridgeRpc', () => {
  describe('negative cases', () => {
    it('answers a tool call with what to set when the address is missing', async () => {
      const answer = await bridgeRpc({ id: 3, jsonrpc: '2.0', method: 'tools/call' }, { env: {}, post: failing });

      expect(answer.error.code).toBe(-32_001);
      expect(answer.error.message).toContain('panel:tunnel');
    });

    it('treats a blank address as unset', async () => {
      const answer = await bridgeRpc(
        { id: 4, jsonrpc: '2.0', method: 'tools/list' },
        { env: { OPENSA_PHONE_URL: '  ' }, post: failing },
      );

      expect(answer.result.tools).toEqual([]);
    });

    it('still initializes without a phone, so the session loads', async () => {
      const answer = await bridgeRpc({ id: 1, jsonrpc: '2.0', method: 'initialize' }, { env: {}, post: failing });

      expect(answer.result.protocolVersion).toBe('2024-11-05');
    });

    it('names the stale tunnel when the phone does not answer', async () => {
      const answer = await bridgeRpc(
        { id: 5, jsonrpc: '2.0', method: 'tools/list' },
        { env: { OPENSA_PHONE_URL: 'https://gone.example/mcp' }, post: failing },
      );

      expect(answer.error.message).toContain('https://gone.example/mcp');
      expect(answer.error.message).toContain('ECONNREFUSED');
    });

    it('reports a rejected token as itself, not as a stale address', async () => {
      const answer = await bridgeRpc(
        { id: 6, jsonrpc: '2.0', method: 'tools/list' },
        {
          env: { OPENSA_PHONE_URL: 'https://phone.example/mcp' },
          post: () => {
            throw Object.assign(new Error('the phone rejected the token'), { plain: true });
          },
        },
      );

      expect(answer.error.message).toBe('the phone rejected the token');
    });

    it('says nothing back to a notification it cannot forward', async () => {
      const answer = await bridgeRpc(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { env: {}, post: failing },
      );

      expect(answer).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('forwards the message unchanged, with the token', async () => {
      const seen = [];
      const answer = await bridgeRpc(
        { id: 7, jsonrpc: '2.0', method: 'tools/call', params: { name: 'map_state' } },
        {
          env: { OPENSA_PHONE_TOKEN: ' abc ', OPENSA_PHONE_URL: 'https://phone.example/mcp' },
          post: (url, token, request) => {
            seen.push([url, token, request]);

            return Promise.resolve({ id: 7, jsonrpc: '2.0', result: { ok: true } });
          },
        },
      );

      expect(seen).toEqual([
        [
          'https://phone.example/mcp',
          'abc',
          { id: 7, jsonrpc: '2.0', method: 'tools/call', params: { name: 'map_state' } },
        ],
      ]);
      expect(answer.result).toEqual({ ok: true });
    });
  });
});
