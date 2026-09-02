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

  assert.equal(result.result, 'revoked');
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

test('a verified global recipe that does its work may claim revoked', async () => {
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

  assert.equal(result.result, 'revoked');
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
