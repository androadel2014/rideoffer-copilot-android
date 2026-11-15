import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGate, setSyncPolicyProvider, isUrlAllowed, NetworkBlockedError, gateStats } from '../src/net/networkGate';

function fakeGlobal() {
  const calls: string[] = [];
  class XHR {
    open(_m: string, url: string) {
      calls.push(`xhr:${url}`);
    }
  }
  class WS {
    constructor(url: string) {
      calls.push(`ws:${url}`);
    }
  }
  const g: any = {
    fetch: (url: string) => {
      calls.push(`fetch:${url}`);
      return Promise.resolve({ status: 200 });
    },
    XMLHttpRequest: XHR,
    WebSocket: WS,
  };
  return { g, calls };
}

test('sync OFF: every request is refused before reaching the network', async () => {
  setSyncPolicyProvider(() => ({ enabled: false, baseUrl: 'https://example.org' }));
  const { g, calls } = fakeGlobal();
  installNetworkGate(g);
  await assert.rejects(g.fetch('https://example.org/api/rideoffer/v1/ingest'), NetworkBlockedError);
  await assert.rejects(g.fetch('https://analytics.example.com/collect'), NetworkBlockedError);
  assert.throws(() => new g.XMLHttpRequest().open('GET', 'https://x.y'), NetworkBlockedError);
  assert.throws(() => new g.WebSocket('wss://x.y'), NetworkBlockedError);
  assert.deepEqual(calls, []);
  assert.ok(gateStats.blocked >= 4);
});

test('sync ON: only the exact https ingest URL is allowed', async () => {
  setSyncPolicyProvider(() => ({ enabled: true, baseUrl: 'https://fleet.example.org/' }));
  const { g, calls } = fakeGlobal();
  installNetworkGate(g);
  await g.fetch('https://fleet.example.org/api/rideoffer/v1/ingest');
  await assert.rejects(g.fetch('https://fleet.example.org/other'), NetworkBlockedError);
  assert.deepEqual(calls, ['fetch:https://fleet.example.org/api/rideoffer/v1/ingest']);
  setSyncPolicyProvider(() => ({ enabled: true, baseUrl: 'http://insecure.example.org' }));
  assert.equal(isUrlAllowed('http://insecure.example.org/api/rideoffer/v1/ingest'), false);
});

test('a throwing policy provider fails closed', () => {
  setSyncPolicyProvider(() => {
    throw new Error('boom');
  });
  assert.equal(isUrlAllowed('https://a.b/api/rideoffer/v1/ingest'), false);
});
