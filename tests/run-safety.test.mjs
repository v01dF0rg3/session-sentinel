import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDefaults } from '../src/core/policy.js';
import { localEvidenceText, outcomeColor, retryDomains, summarize } from '../src/engine/report.js';

function fakeChrome({ reissue = false, alarmFails = false, domain = 'example.com' } = {}) {
  const local = { settings: withDefaults({ onboarded: true, serverLogout: { enabled: false } }) };
  const session = {};
  let cookies = [{ domain, name: 'sessionid', storeId: '0' }];
  let onRemove = null;
  const storage = (data) => ({
    get: async (key) => structuredClone({ [key]: data[key] }),
    set: async (value) => Object.assign(data, structuredClone(value)),
    remove: async (key) => { delete data[key]; }
  });
  globalThis.chrome = {
    permissions: { contains: async () => true },
    storage: { local: storage(local), session: storage(session) },
    alarms: { create: async () => { if (alarmFails) throw new Error('no alarms'); }, clear: async () => { if (alarmFails) throw new Error('no alarms'); } },
    cookies: { getAll: async () => cookies, remove: async () => { cookies = []; return { name: 'sessionid' }; } },
    tabs: { query: async () => [{ id: 1, url: `https://${domain}/` }], reload: async () => { if (reissue) cookies = [{ domain, name: 'opaque' }]; } },
    browsingData: { remove: async () => { if (onRemove) await onRemove(); } }
  };
  return { local, hold: (handler) => { onRemove = handler; } };
}
const load = () => import('../src/engine/run.js?' + Math.random());

test('simultaneous local and full runs share one atomic gate, even beyond five minutes', async () => {
  const state = fakeChrome();
  const engine = await load();
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  state.hold(() => hold);
  state.local.settings.sites['example.com'] = { mode: 'protected' };
  const first = engine.runLocalWipe('manualSite', ['example.com']);
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 10 * 60 * 1000;
    assert.equal(await engine.isRunInProgress(), true);
    const second = await engine.runLogout('manualSite', ['example.com']);
    assert.equal(second.sites.length, 0);
    assert.match(summarize(second), /already running/);
  } finally { Date.now = originalNow; release(); }
  await first;
  assert.equal(await engine.isRunInProgress(), false);
});

test('alarm failures cannot strand the run gate', async () => {
  fakeChrome({ alarmFails: true });
  const engine = await load();
  for (let i = 0; i < 2; i++) {
    const report = await engine.runLocalWipe('manualSite', ['example.com']);
    assert.equal(report.sites.length, 1);
    assert.equal(await engine.isRunInProgress(), false);
  }
});

test('cookies recreated by an open tab turn the final result into needs attention', async () => {
  const state = fakeChrome({ reissue: true });
  const engine = await load();
  const report = await engine.runLogout('manualSite', ['example.com']);
  const site = report.sites[0];
  assert.equal(site.outcome, 'failed');
  assert.equal(site.verified, false);
  assert.equal(site.localCleanup.cookies, 'remaining');
  assert.match(localEvidenceText(site.localCleanup), /remained or returned/);
  assert.equal(state.local.runtimeState.lastReport.status, 'complete');
  assert.match(summarize(report), /needs attention/);
});

test('an in-flight journal identifies unfinished sites before the destructive operation', async () => {
  const state = fakeChrome();
  const engine = await load();
  state.local.settings.sites['example.com'] = { mode: 'protected' };
  state.hold(async () => {
    const progress = state.local.runtimeState.lastReport;
    assert.equal(progress.status, 'running');
    assert.deepEqual(progress.pending, ['example.com']);
    assert.deepEqual(progress.sites, []);
  });
  await engine.runLocalWipe('manualSite', ['example.com']);
  assert.deepEqual(state.local.runtimeState.lastReport.pending, []);
  assert.equal(state.local.runtimeState.lastReport.sites.length, 1);
});

test('old persisted revocation labels are never green or presented as verified revocation', () => {
  assert.equal(outcomeColor('revoked'), 'amber');
  assert.equal(summarize({ sites: [{ outcome: 'revoked' }] }), '1 site: 1 site sign-out attempted.');
});

test('failed storage-only work and busy runs preserve their retry domains', () => {
  assert.deepEqual(retryDomains({ sites: [{ domain: 'example.com', outcome: 'failed' }], pending: ['other.example'] }), ['example.com', 'other.example']);
  assert.deepEqual(retryDomains({ sites: [], skipped: [{ why: 'a run is already in progress' }] }, ['example.com']), ['example.com']);
  assert.match(summarize({ status: 'running', sites: [], pending: ['example.com'] }), /1 unfinished/);
});

test('a recipe-store failure cannot abort the requested local cleanup', async () => {
  const state = fakeChrome();
  state.local.settings.serverLogout.enabled = true;
  chrome.windows = { getAll: async () => [{ id: 2, focused: true }] };
  const get = chrome.storage.local.get;
  chrome.storage.local.get = async (key) => {
    if (key === 'recipeBundle') throw new Error('recipe storage unavailable');
    return get(key);
  };
  const engine = await load();
  const report = await engine.runLogout('manualSite', ['example.com']);
  assert.equal(report.sites[0].outcome, 'cleared');
  assert.equal(report.sites[0].serverAction, 'notAttempted');
  assert.match(report.sites[0].detail, /sign-out was unavailable/);
});

test('GitHub closes its work tab then cleans locally and refreshes the original tab automatically', async () => {
  const state = fakeChrome({ domain: 'github.com' });
  state.local.settings.serverLogout.enabled = true;
  state.local.settings.serverLogout.timeoutMs = 5000;
  const events = [];
  chrome.windows = { getAll: async () => [{ id: 1 }, { id: 2 }] };
  chrome.tabs.create = async () => ({ id: 900 });
  chrome.tabs.get = async () => ({ id: 900, status: 'complete', url: 'https://github.com/' });
  chrome.tabs.remove = async (id) => { events.push(`close:${id}`); };
  chrome.tabs.reload = async (id) => { events.push(`reload:${id}`); };
  chrome.scripting = { executeScript: async ({ args }) => {
    events.push(args[0].op);
    return [{ result: { ok: true, detail: 'activated' } }];
  } };
  state.hold(async () => { events.push('wipe'); });
  const engine = await load();
  const report = await engine.runLogout('manualSite', ['github.com']);
  assert.deepEqual(events, ['waitFor', 'clickText', 'close:900', 'wipe', 'reload:1']);
  assert.equal(report.sites[0].outcome, 'logoutAttempted');
  assert.equal(report.sites[0].verified, true);
  assert.equal(await engine.isRunInProgress(), false);
});

test('a hung GitHub page action still releases the work tab and reaches local cleanup', { timeout: 3000 }, async () => {
  const state = fakeChrome({ domain: 'github.com' });
  state.local.settings.serverLogout.enabled = true;
  state.local.settings.serverLogout.timeoutMs = 700;
  const events = [];
  chrome.windows = { getAll: async () => [{ id: 1 }, { id: 2 }] };
  chrome.tabs.create = async () => ({ id: 900 });
  chrome.tabs.get = async () => ({ id: 900, status: 'complete', url: 'https://github.com/' });
  chrome.tabs.remove = async (id) => { events.push(`close:${id}`); };
  chrome.tabs.reload = async (id) => { events.push(`reload:${id}`); };
  chrome.scripting = { executeScript: () => new Promise(() => {}) };
  state.hold(async () => { events.push('wipe'); });
  const engine = await load();
  const report = await engine.runLogout('manualSite', ['github.com']);
  assert.deepEqual(events, ['close:900', 'wipe', 'reload:1']);
  assert.match(report.sites[0].detail, /timed out/);
  assert.equal(report.sites[0].verified, true);
  assert.equal(await engine.isRunInProgress(), false);
});
