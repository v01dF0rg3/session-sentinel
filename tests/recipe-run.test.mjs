/**
 * Tests for recipe execution, against a fake page.
 *
 * These reproduce a real reported failure. The GitHub recipe reported that it had revoked
 * every session on the account; the user checked their phone and every session was still
 * live. Three separate holes let that through, and each one is pinned here.
 *
 * The rule these enforce: a recipe may only claim what it can demonstrate.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executePageStep } from '../src/engine/page-execution.js';

/**
 * @param {(step: any) => boolean} matches Whether a given step succeeds on this fake page.
 */
function fakePage(matches) {
  const executed = [];
  globalThis.chrome = {
    storage: {
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} }
    },
    windows: { getAll: async () => [{ id: 1 }, { id: 2 }] },
    tabs: {
      create: async () => ({ id: 5, status: 'complete' }),
      get: async () => ({ id: 5, status: 'complete', windowId: 1, url: 'https://example.com/' }),
      update: async () => ({ id: 5 }),
      query: async () => [{ id: 5 }, { id: 6 }],
      remove: async () => {}
    },
    scripting: {
      executeScript: async ({ args }) => {
        const step = args[0];
        executed.push(step.op);
        return [{ result: { ok: matches(step), detail: matches(step) ? 'ok' : 'not found' } }];
      }
    }
  };
  return { executed };
}

const load = () => import('../src/engine/logout.js?' + Math.random().toString(36).slice(2));

const base = (steps, extra = {}) => ({
  domain: 'example.com',
  capability: 'global',
  steps: [{ op: 'navigate', url: 'https://example.com/settings/sessions' }, ...steps],
  ...extra
});

test('post-click sleep stays in the worker instead of injecting into the navigating page', async () => {
  const { executed } = fakePage(() => true);
  const removed = [];
  chrome.tabs.remove = async (id) => { removed.push(id); };
  const { runRecipe } = await load();
  const result = await runRecipe(base([
    { op: 'clickText', selector: 'button', text: 'sign out' },
    { op: 'sleep', ms: 20 }
  ], { capability: 'local' }), 1, 3000);
  assert.equal(result.result, 'attempted');
  assert.deepEqual(executed, ['clickText'], 'navigation settling must not wait on a page promise');
  assert.deepEqual(removed, [5], 'the owned tab closes without the user touching it');
});

test('a page injection that never settles cannot hold the work tab open indefinitely', async () => {
  fakePage(() => true);
  const removed = [];
  chrome.tabs.remove = async (id) => { removed.push(id); };
  let release;
  chrome.scripting.executeScript = () => new Promise((resolve) => { release = resolve; });
  const { runRecipe } = await load();
  const running = runRecipe(base([
    { op: 'clickText', selector: 'button', text: 'sign out' }
  ], { capability: 'local' }), 1, 700);
  let escape;
  try {
    const result = await Promise.race([running, new Promise((resolve) => { escape = setTimeout(() => resolve(null), 1600); })]);
    assert.ok(result, 'the worker deadline must finish without manual tab closure');
    assert.equal(result.result, 'none', 'a missing click result is not an observed action');
    assert.match(result.detail, /timed out/i);
    assert.deepEqual(removed, [5]);
  } finally {
    clearTimeout(escape);
    release?.([{ result: { ok: true, detail: 'late page response' } }]);
    await running;
  }
});

test('page execution requests immediate injection with an absolute deadline inside the site budget', async () => {
  fakePage(() => true);
  const deadline = Date.now() + 3000;
  chrome.scripting.executeScript = async (input) => {
    assert.equal(input.injectImmediately, true);
    assert.deepEqual(input.target, { tabId: 5 });
    assert.equal(input.args[1], 'https://example.com');
    assert.ok(input.args[2] > Date.now() && input.args[2] <= deadline);
    assert.ok(input.args[0].timeoutMs <= 1000);
    return [{ result: { ok: true, detail: 'found' } }];
  };
  const result = await executePageStep(5, { op: 'waitFor', selector: 'body', timeoutMs: 1000 }, 'https://example.com', deadline);
  assert.equal(result[0].result.ok, true);
});

test('missing or expired deadlines and worker-only sleeps never dispatch a page action', async () => {
  fakePage(() => true);
  chrome.scripting.executeScript = async () => { assert.fail('expired or worker-only work must not be dispatched'); };
  for (const deadline of [undefined, NaN, Date.now() - 1]) {
    await assert.rejects(executePageStep(5, { op: 'click', selector: 'button' }, 'https://example.com', deadline), /timed out/);
  }
  await assert.rejects(executePageStep(5, { op: 'sleep', ms: 10 }, 'https://example.com', Date.now() + 1000), /worker/);
});

test('asserting the absence of something never seen is refused', async () => {
  // The exact GitHub failure. The assert selector was never on the page, so "absent" was
  // trivially true and the recipe reported a revocation that never happened.
  fakePage((step) => step.op !== 'assertAbsent'); // everything else "succeeds"
  const { runRecipe } = await load();

  const result = await runRecipe(
    base([
      { op: 'waitFor', selector: 'main' },
      { op: 'clickText', selector: 'button', text: 'revoke all' },
      { op: 'assertAbsent', selector: 'form[action*="revoke"] button' }
    ], { verified: '2026-01-01' }),
    1,
    10000
  );

  assert.notEqual(result.result, 'revoked', 'must not claim revocation it cannot demonstrate');
  assert.match(result.detail, /never seen on the page/);
});

test('asserting absence IS accepted once the selector was seen present', async () => {
  // waitFor sees it, the click removes it, the assert then means something. Simulated by
  // failing only the assertAbsent lookup after it has been observed by waitFor.
  const seen = new Set();
  fakePage((step) => {
    if (step.op === 'waitFor') { seen.add(step.selector); return true; }
    if (step.op === 'assertAbsent') return seen.has(step.selector); // it went away
    return true;
  });
  const { runRecipe } = await load();

  const result = await runRecipe(
    base([
      { op: 'waitFor', selector: '#revoke-form' },
      { op: 'clickText', selector: 'button', text: 'revoke all' },
      { op: 'assertAbsent', selector: '#revoke-form' }
    ], { verified: '2026-01-01' }),
    1,
    10000
  );

  assert.equal(result.result, 'attempted');
});

test('an all-optional global recipe is rejected before it can run', async () => {
  // Every action optional, every action missing: the old code ran to the end and called
  // that success. Validation now refuses the recipe outright, so the runtime guard below
  // never even gets a turn on a `global` recipe.
  fakePage((step) => step.op === 'waitFor');
  const { runRecipe } = await load();

  const result = await runRecipe(
    base([
      { op: 'waitFor', selector: 'main' },
      { op: 'clickText', selector: 'button', text: 'revoke all', optional: true },
      { op: 'clickText', selector: 'button', text: 'revoke', optional: true }
    ], { verified: '2026-01-01' }),
    1,
    10000
  );

  assert.equal(result.result, 'none');
  assert.match(result.detail, /malformed recipe/);
});

test('a recipe that clicks nothing reports nothing', async () => {
  // The runtime backstop, on a `local` recipe where all-optional steps are permitted.
  // Clean steps are not the same as work done.
  fakePage((step) => step.op === 'waitFor'); // every click misses
  const { runRecipe } = await load();

  const result = await runRecipe(
    base([
      { op: 'waitFor', selector: 'main' },
      { op: 'clickText', selector: 'button', text: 'log out', optional: true }
    ], { capability: 'local' }),
    1,
    10000
  );

  assert.equal(result.result, 'none');
  assert.match(result.detail, /without activating any control/);
});

test('an unverified global recipe is reported only as an attempt', async () => {
  // "Revoked" promises copied tokens and other sessions were invalidated. Until that is
  // checked independently, reaching the site's control is only an attempt.
  fakePage(() => true);
  const { runRecipe } = await load();

  const result = await runRecipe(
    base([
      { op: 'waitFor', selector: 'main' },
      { op: 'clickText', selector: 'button', text: 'revoke all' }
    ]),
    1,
    10000
  );

  assert.equal(result.result, 'attempted', 'not revoked');
  assert.match(result.detail, /unverified/);
});

test('a historical verification date cannot prove this run revoked a copied token', async () => {
  fakePage(() => true);
  const { runRecipe } = await load();

  const result = await runRecipe(
    base([
      { op: 'waitFor', selector: 'main' },
      { op: 'clickText', selector: 'button', text: 'revoke all' }
    ], { verified: '2026-08-30' }),
    1,
    10000
  );

  assert.equal(result.result, 'attempted');
  assert.match(result.detail, /unverified for this run/);
});

test('a failed non-optional step stops the recipe claiming success', async () => {
  fakePage((step) => step.op === 'waitFor');
  const { runRecipe } = await load();

  const result = await runRecipe(
    base([
      { op: 'waitFor', selector: 'main' },
      { op: 'clickText', selector: 'button', text: 'revoke all' }
    ], { verified: '2026-08-30' }),
    1,
    10000
  );

  assert.notEqual(result.result, 'revoked');
  assert.match(result.detail, /failed/);
});

test('a recipe redirect to an unrelated site stops before any injection', async () => {
  const { executed } = fakePage(() => true);
  chrome.tabs.get = async () => ({ id: 5, status: 'complete', windowId: 1, url: 'https://attacker.test/' });
  const { runRecipe } = await load();
  const result = await runRecipe(base([{ op: 'clickText', selector: 'button', text: 'sign out' }]), 1, 10000);
  assert.equal(result.result, 'none');
  assert.match(result.detail, /untrusted destination/);
  assert.equal(executed.length, 0);
});

test('a redirect caused by a click is checked before the next action', async () => {
  const { executed } = fakePage(() => true);
  const realExecute = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async (input) => {
    assert.equal(input.args[1], 'https://example.com', 'injected code must receive the authorized origin');
    const result = await realExecute(input);
    chrome.tabs.get = async () => ({ id: 5, status: 'complete', windowId: 1, url: 'https://attacker.test/' });
    return result;
  };
  const { runRecipe } = await load();
  const result = await runRecipe(base([
    { op: 'clickText', selector: 'button', text: 'sign out' },
    { op: 'clickText', selector: 'button', text: 'confirm' }
  ]), 1, 10000);
  assert.deepEqual(executed, ['clickText']);
  assert.equal(result.result, 'attempted');
  assert.match(result.detail, /untrusted destination/);
});

test('OIDC refuses an off-site endpoint before opening a tab', async () => {
  fakePage(() => true);
  chrome.tabs.create = async () => { assert.fail('untrusted endpoint must never be opened'); };
  const { runOidcLogout } = await load();
  assert.equal((await runOidcLogout('https://accounts.google.com/Logout', 'attacker.example', 1, 1000)).result, 'none');
});

test('OIDC discovery is bounded and cannot opt into credentials or redirects', async () => {
  const originalFetch = globalThis.fetch;
  const { discoverOidcLogout } = await load();
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal);
      return new Response(JSON.stringify({ end_session_endpoint: 'https://example.com/logout' }));
    };
    assert.equal(await discoverOidcLogout('example.com'), 'https://example.com/logout');
    globalThis.fetch = async () => new Response('x'.repeat(128 * 1024 + 1));
    assert.equal(await discoverOidcLogout('example.com'), null);
  } finally { globalThis.fetch = originalFetch; }
});
