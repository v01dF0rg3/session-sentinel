import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupOrigins } from '../src/core/cleanup-scope.js';
import { wipeSite, removeCookiesForDomain, snapshotCleanupScope, verifyCleared } from '../src/platform/sessions.js';
import { COOKIE_TEST_DOMAIN, testCookieCleanup } from '../src/platform/cookie-selftest.js';

function fakeChrome({ cookies = [], removeFails = false, noOp = false, readFails = false } = {}) {
  const calls = { removals: [], queries: [], scopes: [], storeEnumerations: 0 };
  globalThis.chrome = {
    permissions: { contains: async () => true },
    extension: { inIncognitoContext: false },
    tabs: { query: async () => [{ url: 'https://app.example.com:8443/work', incognito: false }] },
    cookies: {
      getAll: async (query) => { calls.queries.push(query); if (readFails) throw new Error('denied'); return [...cookies]; },
      getAllCookieStores: async () => { calls.storeEnumerations++; return [{ id: '0' }, { id: '1' }]; },
      remove: async (query) => {
        calls.removals.push(query);
        if (removeFails) throw new Error('denied');
        if (noOp) return null;
        const index = cookies.findIndex((c) => c.name === query.name);
        if (index < 0) return null;
        cookies.splice(index, 1);
        return { name: query.name };
      }
    },
    browsingData: { remove: async (scope, types) => {
      calls.scopes.push({ scope, types });
      if (removeFails) throw new Error('denied');
      if (!noOp && types.cookies) cookies.splice(0);
    } }
  };
  return calls;
}
const cookie = (extra = {}) => ({ domain: '.example.com', name: 'opaque', path: '/', secure: true, storeId: '0', ...extra });

test('storage scope includes cookie subdomains and exact open-tab ports, never unrelated tenants', () => {
  const origins = cleanupOrigins('alice.blogspot.com', ['api.alice.blogspot.com', 'bob.blogspot.com'], ['https://app.alice.blogspot.com:8443/a', 'https://bob.blogspot.com/b']);
  assert.ok(origins.includes('https://api.alice.blogspot.com'));
  assert.ok(origins.includes('https://app.alice.blogspot.com:8443'));
  assert.ok(!origins.some((o) => o.includes('bob.blogspot')));
  assert.deepEqual(cleanupOrigins('blogspot.com'), []);
});

test('destructive APIs refuse public suffixes, subdomain aliases, and non-scoped data types', async () => {
  const calls = fakeChrome();
  for (const domain of ['com', 'blogspot.com', 'www.example.com', 'example.com/path']) {
    assert.equal((await wipeSite(domain, ['cookies'])).ok, false);
    assert.equal((await removeCookiesForDomain(domain)).ok, false);
  }
  assert.equal((await wipeSite('example.com', ['cookies', 'history'])).ok, false);
  assert.equal((await wipeSite('example.com', [])).ok, false);
  assert.equal(calls.scopes.length, 0);
  assert.equal(calls.removals.length, 0);
});

test('verification counts opaque and partitioned cookies, not just auth-looking names', async () => {
  const calls = fakeChrome({ cookies: [cookie({ partitionKey: { topLevelSite: 'https://embedder.test' } })] });
  assert.equal(await verifyCleared('example.com'), false);
  assert.deepEqual(calls.queries.at(-1).partitionKey, {});
});

test('a fulfilled no-op cookie deletion is not a successful cleanup', async () => {
  fakeChrome({ cookies: [cookie()], noOp: true });
  const result = await wipeSite('example.com', ['cookies']);
  assert.equal(result.ok, false);
  assert.ok(result.failed.includes('cookies'));
});

test('origin hints survive a successful site sign-out that erased all cookies', async () => {
  const cookies = [cookie({ domain: 'api.example.com' })];
  const calls = fakeChrome({ cookies });
  const snapshot = await snapshotCleanupScope('example.com');
  cookies.splice(0); // The website's own sign-out removes its cookies before local cleanup.
  const result = await wipeSite('example.com', ['cookies', 'localStorage'], snapshot);
  assert.equal(result.ok, true);
  assert.ok(calls.scopes[0].scope.origins.includes('https://api.example.com'));
});

test('untrusted saved origin hints cannot widen a cleanup', async () => {
  const calls = fakeChrome();
  await wipeSite('example.com', ['cookies', 'localStorage'], { origins: ['https://other.example/', 'file:///C:/private'], warnings: [] });
  assert.ok(calls.scopes.every(({ scope }) => scope.origins.every((origin) => origin.includes('example.com'))));
});

test('unavailable origin enumeration is reported as incomplete for a storage cleanup', async () => {
  fakeChrome();
  chrome.tabs.query = async () => { throw new Error('denied'); };
  const result = await wipeSite('example.com', ['cookies', 'localStorage']);
  assert.equal(result.ok, false);
  assert.match(result.error, /origin evidence/);
  assert.equal(result.warnings.length, 1);
});

test('missing site access cannot turn an empty visible cookie list into a verified wipe', async () => {
  const calls = fakeChrome();
  chrome.permissions.contains = async () => false;
  assert.equal(await verifyCleared('example.com'), false);
  assert.equal((await wipeSite('example.com', ['cookies', 'localStorage'])).ok, false);
  assert.equal(calls.scopes.length, 0);
  assert.equal(calls.removals.length, 0);
});

test('fallback failures and null removal results are not counted as removed', async () => {
  for (const flags of [{ removeFails: true }, { noOp: true }]) {
    fakeChrome({ cookies: [cookie()], ...flags });
    const result = await removeCookiesForDomain('example.com');
    assert.equal(result.ok, false);
    assert.equal(result.removed, 0);
  }
});

test('cookie fallback keeps store and partition identity and never sweeps Incognito', async () => {
  const partitionKey = { topLevelSite: 'https://embedder.test', hasCrossSiteAncestor: true };
  const calls = fakeChrome({ cookies: [cookie({ partitionKey })] });
  const result = await removeCookiesForDomain('example.com');
  assert.equal(result.ok, true);
  assert.equal(result.removed, 1);
  assert.equal(calls.removals[0].storeId, '0');
  assert.deepEqual(calls.removals[0].partitionKey, partitionKey);
  assert.equal(calls.storeEnumerations, 0, 'never widen to another cookie store');
});

test('origin evidence is captured before cookie deletion erases it', async () => {
  const calls = fakeChrome({ cookies: [cookie({ domain: 'api.example.com' })] });
  const result = await wipeSite('example.com', ['cookies', 'localStorage']);
  assert.equal(result.ok, true);
  assert.ok(calls.scopes[0].scope.origins.includes('https://api.example.com'));
  assert.ok(calls.scopes[0].scope.origins.includes('https://app.example.com:8443'));
  assert.equal(calls.scopes[0].scope.originTypes.unprotectedWeb, true);
  assert.equal(calls.scopes[0].scope.originTypes.extension, undefined);
  assert.equal(calls.scopes[0].types.cookies, undefined, 'never let browsingData widen the cookie target');
});

test('missing read permission means unknown, never verified clear', async () => {
  fakeChrome({ readFails: true });
  assert.equal(await verifyCleared('example.com'), false);
  assert.equal((await wipeSite('example.com', ['cookies'])).ok, false);
});

test('a partial storage failure is reported even when cookies were removed', async () => {
  fakeChrome();
  chrome.browsingData.remove = async (_scope, types) => {
    if (types.indexedDB) throw new Error('cannot clear indexedDB');
  };
  const result = await wipeSite('example.com', ['cookies', 'indexedDB']);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed, ['indexedDB']);
  assert.deepEqual(result.cleared, ['cookies']);
});

test('the installed cookie self-test only removes its reserved-domain canaries', async () => {
  const jar = [cookie()];
  const calls = fakeChrome({ cookies: jar });
  chrome.cookies.set = async (details) => { jar.push(cookie({ ...details, domain: COOKIE_TEST_DOMAIN })); return {}; };
  const result = await testCookieCleanup();
  assert.equal(result.ok, true);
  assert.equal(jar.length, 1);
  assert.equal(jar[0].domain, '.example.com');
  assert.equal(calls.removals.length, 2);
  assert.ok(calls.removals.every((call) => new URL(call.url).hostname === COOKIE_TEST_DOMAIN));
});
