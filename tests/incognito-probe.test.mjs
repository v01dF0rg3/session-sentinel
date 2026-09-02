import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  authCookieNames,
  normalizeProbeDomain,
  probeAnonymousCookies,
  selectIncognitoStore
} from '../src/platform/incognito-probe.js';

test('probe input is reduced to a registrable public domain', () => {
  assert.equal(normalizeProbeDomain('https://www.bloomberg.com/news'), 'bloomberg.com');
  assert.equal(normalizeProbeDomain('accounts.example.co.uk'), 'example.co.uk');
  assert.throws(() => normalizeProbeDomain('about:blank'), /valid website domain/);
  assert.throws(() => normalizeProbeDomain('localhost'), /public website domain/);
});

test('incognito store is identified by returned tab membership, never a guessed ID', () => {
  const windows = [
    { id: 1, incognito: false, tabs: [{ id: 10 }] },
    { id: 2, incognito: true, tabs: [{ id: 20 }] }
  ];
  const stores = [
    { id: 'unexpected-private-id', tabIds: [20] },
    { id: 'unexpected-normal-id', tabIds: [10] }
  ];

  assert.equal(selectIncognitoStore(windows, stores)?.id, 'unexpected-private-id');
});

test('only strong and moderate cookie names leave the probe', () => {
  const result = authCookieNames([
    { name: '_session_id_backup', value: 'x'.repeat(36), httpOnly: true, secure: true },
    { name: 'legacy_auth', value: 'short', httpOnly: true, secure: false },
    { name: '_ga', value: 'GA1.2.123.456', httpOnly: false, secure: false },
    { name: 'plain_session', value: 'x'.repeat(36), httpOnly: false, secure: true }
  ]);

  assert.deepEqual(result.strong, ['_session_id_backup']);
  assert.deepEqual(result.moderate, ['legacy_auth']);
  assert.deepEqual(result.authNames, ['_session_id_backup', 'legacy_auth']);
});

function fakeChrome({ privateCookies = [], privateTabUrl = 'chrome://newtab/', allowIncognito = true } = {}) {
  const removed = [];
  let cookieReads = 0;
  globalThis.chrome = {
    // Incognito access is off by default and, while it is off, Chrome hides private
    // windows from the extension entirely. The fake grants it so these tests exercise the
    // probe rather than the precheck; the precheck has its own test below.
    extension: { isAllowedIncognitoAccess: async () => allowIncognito },
    windows: {
      getAll: async () => [
        { id: 1, incognito: false, focused: true, tabs: [{ id: 10, url: 'chrome-extension://test' }] },
        { id: 2, incognito: true, focused: false, tabs: [{ id: 20, url: privateTabUrl }] }
      ]
    },
    cookies: {
      getAllCookieStores: async () => [
        { id: 'normal-store', tabIds: [10] },
        { id: 'private-store', tabIds: [20, 21] }
      ],
      getAll: async ({ storeId }) => {
        cookieReads += 1;
        if (cookieReads === 1) return privateCookies;
        assert.equal(storeId, 'private-store');
        return [
          {
            name: '_session_id_backup',
            value: 'secret-that-must-not-be-returned',
            domain: '.bloomberg.com',
            httpOnly: true,
            secure: true
          },
          { name: '_ga', value: 'analytics', domain: '.bloomberg.com' }
        ];
      }
    },
    tabs: {
      create: async ({ windowId, url, active }) => {
        assert.deepEqual({ windowId, url, active }, { windowId: 2, url: 'https://bloomberg.com/', active: false });
        return { id: 21, incognito: true };
      },
      get: async () => ({ id: 21, windowId: 2, status: 'complete', url: 'https://www.bloomberg.com/' }),
      remove: async (tabId) => { removed.push(tabId); },
      query: async () => [{ id: 20 }, { id: 21 }],
      update: async () => {}
    },
    scripting: {
      executeScript: async () => [{ result: { url: 'https://www.bloomberg.com/', readyState: 'complete' } }]
    }
  };
  return removed;
}

test('a clean private store yields names and counts, never cookie values', async () => {
  const removed = fakeChrome();
  const result = await probeAnonymousCookies('bloomberg.com', { timeoutMs: 100 });

  assert.equal(result.storeId, 'private-store');
  assert.equal(result.siteCookieCount, 2);
  assert.deepEqual(result.authNames, ['_session_id_backup']);
  assert.equal(JSON.stringify(result).includes('secret-that-must-not-be-returned'), false);
  assert.deepEqual(removed, [21], 'temporary private tab is closed');
});

test('a used private store is refused before any site is contacted', async () => {
  fakeChrome({
    privateCookies: [{ name: 'sid', domain: '.example.com' }]
  });
  let created = false;
  globalThis.chrome.tabs.create = async () => {
    created = true;
    throw new Error('must not run');
  };

  await assert.rejects(
    probeAnonymousCookies('bloomberg.com', { timeoutMs: 100 }),
    /cookie store is not empty/
  );
  assert.equal(created, false);
});

test('a private web tab is refused even when the cookie jar happens to be empty', async () => {
  fakeChrome({ privateTabUrl: 'https://example.com/' });
  await assert.rejects(
    probeAnonymousCookies('bloomberg.com', { timeoutMs: 100 }),
    /Incognito window is not blank/
  );
});

test('missing Incognito access is named, not reported as a missing window', async () => {
  // Without this, the failure is a dead end. Incognito access is off by default, and while
  // it is off Chrome hides private windows from the extension — so the probe said "open an
  // Incognito window", the user opened one, and got the identical message forever, with
  // nothing pointing at the checkbox that actually governs it.
  fakeChrome({ allowIncognito: false });
  const { probeAnonymousCookies } = await import('../src/platform/incognito-probe.js');

  await assert.rejects(
    () => probeAnonymousCookies('bloomberg.com'),
    (error) => {
      assert.match(error.message, /chrome:\/\/extensions/);
      assert.match(error.message, /Allow in Incognito/);
      return true;
    }
  );
});
